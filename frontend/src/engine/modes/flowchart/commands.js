// The keyboard and button commands of a flowchart. They act on the selected steps or arrow: the pure
// functions in ops.js decide what changes, storeOps.js makes it one undoable step, and this picks
// what to select (and edit) next.

import { newChartChange } from "./ops"
import * as ops from "./ops"
import { addChartOps, applyFlowChange, removeChart } from "./storeOps"
import { chartBounds } from "./layout"

// True when what is selected is only flowchart steps and arrows, so the flowchart owns Enter, D, T, I...
export function flowOwnsKeys(store) {
	const ids = store.state.selection
	return (
		ids.length > 0 &&
		store.selectedFlowNodes().length + store.selectedFlowEdges().length === ids.length
	)
}

const only = (store) => {
	const n = store.selectedFlowNodes()
	return n.length === 1 && !store.selectedFlowEdges().length ? n[0] : null
}
const onlyEdge = (store) => {
	const e = store.selectedFlowEdges()
	return e.length === 1 && !store.selectedFlowNodes().length ? e[0] : null
}

function edit(store, id, { fresh = false } = {}) {
	store.state.editingFlowNew = fresh
	store.state.editingFlowId = id
}

// What a command knows about the chart of a node or edge.
function chartOf(store, chartId) {
	return {
		chart: store.getChart(chartId),
		nodes: store.nodesOfChart(chartId),
		edges: store.edgesOfChart(chartId),
	}
}

// The bounds of everything on the board, to put a new chart below it.
function boardBounds(store, measure) {
	let box = null
	const merge = (b) => {
		if (!b) return
		if (!box) box = { ...b }
		else {
			const x = Math.min(box.x, b.x)
			const y = Math.min(box.y, b.y)
			box = {
				x,
				y,
				w: Math.max(box.x + box.w, b.x + b.w) - x,
				h: Math.max(box.y + box.h, b.y + b.h) - y,
			}
		}
	}
	for (const o of store.objects.value) merge({ x: o.x, y: o.y, w: o.w, h: o.h })
	for (const c of store.charts.value) merge(chartBounds(c, store.nodesOfChart(c.id), measure))
	return box
}

// ``host``: {measure(text, size), ask(message), viewCenter()}.
export async function runFlowCommand(store, command, host = {}) {
	const { state } = store
	if (state.readonly && command.name !== "fl.nav") return false
	const measure = host.measure
	switch (command.name) {
		case "fl.new": {
			const { chart, change } = newChartChange({
				origin: command.origin || null,
				bounds: command.origin ? null : boardBounds(store, measure),
				direction: command.direction || "TB",
				measure,
			})
			const second = change.add.nodes.find((n) => n.type === "process") || change.add.nodes[0]
			const ok = store.applyOps(addChartOps(chart, change), {
				label: "Add flowchart",
				select: [second.id],
				selectUndo: [],
			})
			if (ok) {
				host.reveal?.({ x: second.x, y: second.y })
				edit(store, second.id)
			}
			return ok
		}
		case "fl.key": {
			// Enter, D, T, I on a step add one after it; on an arrow they insert one in the middle of it.
			const edge = onlyEdge(store)
			if (edge)
				return runFlowCommand(
					store,
					{ name: "fl.insert", edge: edge.id, type: command.type },
					host,
				)
			return runFlowCommand(store, { name: "fl.add", type: command.type }, host)
		}
		case "fl.add": {
			const from = command.from ? store.getFlowNode(command.from) : only(store)
			if (!from) return false
			const { chart, nodes, edges } = chartOf(store, from.chartId)
			const change = command.point
				? ops.addNodeAt(chart, nodes, edges, from.id, command.type, command.point, {
						measure,
					})
				: ops.addNodeFrom(chart, nodes, edges, from.id, command.type, { measure })
			const ok = applyFlowChange(store, chart.id, change, {
				label: "Add step",
				select: (c) => c.add.nodes[0].id,
				selectUndo: [from.id],
			})
			if (ok) {
				const made = change.add.nodes[0]
				host.reveal?.({ x: made.x, y: made.y })
				if (made.type !== "junction") edit(store, made.id, { fresh: true })
			}
			return ok
		}
		case "fl.branch": {
			const node = only(store)
			if (!node) return false
			const { chart, nodes, edges } = chartOf(store, node.chartId)
			const change = ops.addDecisionBranch(chart, nodes, edges, node.id, { measure })
			const ok = applyFlowChange(store, chart.id, change, {
				label: "Add an output",
				select: (c) => c.add.nodes[0].id,
				selectUndo: [node.id],
			})
			if (ok) edit(store, change.add.nodes[0].id, { fresh: true })
			return ok
		}
		case "fl.swap": {
			let did = false
			const picked = store.selectedFlowNodes().map((n) => n.id)
			for (const node of store.selectedFlowNodes()) {
				const { chart, nodes, edges } = chartOf(store, node.chartId)
				did =
					applyFlowChange(
						store,
						chart.id,
						ops.swapType(nodes, edges, node.id, command.type),
						{
							label: "Change step type",
							select: picked,
							selectUndo: picked,
						},
					) || did
			}
			return did
		}
		case "fl.edit": {
			const node = only(store)
			const edge = onlyEdge(store)
			if (node) edit(store, node.id)
			else if (edge) edit(store, edge.id)
			else return false
			return true
		}
		case "fl.tidy": {
			const anyId = store.state.selection[0]
			const chartId =
				store.getFlowNode(anyId)?.chartId ||
				store.getFlowEdge(anyId)?.chartId ||
				(store.charts.value.length === 1 ? store.charts.value[0].id : null)
			if (!chartId) return false
			const { chart, nodes, edges } = chartOf(store, chartId)
			return applyFlowChange(store, chartId, ops.tidyChange(chart, nodes, edges, measure), {
				label: "Tidy up",
				select: store.state.selection,
				selectUndo: [...store.state.selection],
			})
		}
		case "fl.direction": {
			const anyId = store.state.selection[0]
			const chartId = store.getFlowNode(anyId)?.chartId || store.getFlowEdge(anyId)?.chartId
			if (!chartId) return false
			const { chart, nodes, edges } = chartOf(store, chartId)
			const next = command.direction || (chart.direction === "TB" ? "LR" : "TB")
			return applyFlowChange(
				store,
				chartId,
				ops.setDirection(chart, nodes, edges, next, measure),
				{
					label: "Change direction",
					select: store.state.selection,
					selectUndo: [...store.state.selection],
				},
			)
		}
		case "fl.numbered": {
			const anyId = store.state.selection[0]
			const chartId = store.getFlowNode(anyId)?.chartId || store.getFlowEdge(anyId)?.chartId
			if (!chartId) return false
			const chart = store.getChart(chartId)
			return applyFlowChange(
				store,
				chartId,
				ops.setNumbered(chart, command.value ?? !chart.numbered),
				{
					label: chart.numbered ? "Hide step numbers" : "Number the steps",
					select: store.state.selection,
					selectUndo: [...store.state.selection],
				},
			)
		}
		case "fl.fontSize": {
			// the selected steps, or every step of their chart; null puts the size back to the default
			const picked = store.selectedFlowNodes()
			if (!picked.length) return false
			const ids = picked.map((n) => n.id)
			let did = false
			for (const chartId of new Set(picked.map((n) => n.chartId))) {
				const { nodes } = chartOf(store, chartId)
				const change = command.whole
					? ops.setAllFontSize(nodes, command.size)
					: ops.setFontSize(
							nodes,
							ids.filter((id) => store.getFlowNode(id)?.chartId === chartId),
							command.size,
						)
				did =
					applyFlowChange(store, chartId, change, {
						label: command.whole ? "Text size of the whole chart" : "Text size",
						select: ids,
						selectUndo: ids,
					}) || did
			}
			return did
		}
		case "fl.label": {
			const edge = store.getFlowEdge(command.edge)
			if (!edge) return false
			const { edges } = chartOf(store, edge.chartId)
			return applyFlowChange(
				store,
				edge.chartId,
				ops.setEdgeLabel(edges, edge.id, command.label),
				{
					label: "Edit label",
					select: edge.id,
					selectUndo: [edge.id],
				},
			)
		}
		case "fl.insert": {
			const edge = store.getFlowEdge(command.edge)
			if (!edge) return false
			const { chart, nodes, edges } = chartOf(store, edge.chartId)
			const change = ops.insertOnEdge(chart, nodes, edges, edge.id, command.type, { measure })
			const ok = applyFlowChange(store, chart.id, change, {
				label: "Insert step",
				select: (c) => c.add.nodes[0].id,
				selectUndo: [edge.id],
			})
			if (ok) edit(store, change.add.nodes[0].id, { fresh: true })
			return ok
		}
		case "fl.connect": {
			const from = store.getFlowNode(command.from)
			const to = store.getFlowNode(command.to)
			if (!from || !to || from.chartId !== to.chartId) return false
			const { chart, nodes, edges } = chartOf(store, from.chartId)
			return applyFlowChange(
				store,
				chart.id,
				ops.connect(chart, nodes, edges, from.id, to.id),
				{
					label: "Connect steps",
					select: to.id,
					selectUndo: [from.id],
				},
			)
		}
		case "fl.nav": {
			const node = only(store)
			if (!node) return false
			const { chart, nodes, edges } = chartOf(store, node.chartId)
			const forward = chart.direction === "LR" ? "right" : "down"
			const back = chart.direction === "LR" ? "left" : "up"
			const outs = ops.outEdges(edges, node.id)
			let next = null
			if (command.direction === forward) next = outs[0]?.to
			else if (command.direction === back) next = ops.inEdges(edges, node.id)[0]?.from
			else {
				// across the flow: the next or previous step that shares this step's predecessor
				const parent = ops.inEdges(edges, node.id)[0]?.from
				if (parent) {
					const sibs = ops.outEdges(edges, parent).map((e) => e.to)
					const at = sibs.indexOf(node.id)
					const step = command.direction === "left" || command.direction === "up" ? -1 : 1
					next = sibs[at + step] ?? null
				}
			}
			if (next) store.select([next])
			return Boolean(next)
		}
		case "fl.delete":
			return deleteSelected(store, host, measure)
		default:
			return false
	}
}

async function deleteSelected(store, host) {
	const nodes = store.selectedFlowNodes()
	const lines = store.selectedFlowEdges()
	if (!nodes.length && !lines.length) return false
	// Deleting every step of a chart removes the chart.
	const byChart = new Map()
	for (const n of nodes) byChart.set(n.chartId, [...(byChart.get(n.chartId) || []), n.id])
	for (const [chartId, ids] of byChart) {
		if (ids.length === store.nodesOfChart(chartId).length) {
			if (host.ask && !(await host.ask("Delete this whole flowchart?"))) return false
			return removeChart(store, chartId)
		}
	}
	let ok = false
	const picked = [...store.state.selection]
	let working = new Map()
	for (const n of nodes) {
		const { chart, nodes: all, edges } = working.get(n.chartId) || chartOf(store, n.chartId)
		const change = ops.removeNode(all, edges, n.id, { reconnect: true })
		if (!change) continue
		const next = ops.applyFlowChange(all, edges, change)
		working.set(n.chartId, { chart, nodes: next.nodes, edges: next.edges })
		ok =
			applyFlowChange(store, chart.id, change, {
				label: "Delete step",
				selectUndo: picked,
			}) || ok
	}
	for (const e of lines) {
		if (!store.getFlowEdge(e.id)) continue
		const { edges } = chartOf(store, e.chartId)
		ok =
			applyFlowChange(store, e.chartId, ops.removeEdge(edges, e.id), {
				label: "Delete arrow",
				selectUndo: picked,
			}) || ok
	}
	if (ok) store.select([])
	return ok
}
