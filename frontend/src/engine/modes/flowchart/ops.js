// Flowchart operations. Every function takes the records of ONE chart (the chart, its nodes, its
// edges) and returns a change set (what to add, update and remove, and an optional chart patch),
// or null when the operation is not allowed or changes nothing. Inputs are never mutated, so a
// whole operation is one undo step and the store can apply it atomically.

import {
	backEdgeIds,
	placeAt,
	placeChild,
	positionBelow,
	shiftDownstream,
	tidyLayout,
} from "./layout"
import {
	createChart,
	createFlowEdge,
	createFlowNode,
	DIRECTIONS,
	FLOW_FONT_RANGE,
	FLOW_LABEL_LIMIT,
	FLOW_TEXT_LIMIT,
	GAPS,
	MAX_EDGES,
	MAX_NODES,
	NODE_TYPES,
	nodeSize,
	TYPE_INFO,
} from "./model"

const NEW_CHART_GAP = 80

// ----- change sets -----

export const emptyChange = () => ({
	add: { nodes: [], edges: [] },
	update: { nodes: [], edges: [] },
	remove: { nodes: [], edges: [] },
})

export function isEmptyChange(change) {
	if (!change) return true
	const { add, update, remove } = change
	return (
		!add?.nodes?.length &&
		!add?.edges?.length &&
		!update?.nodes?.length &&
		!update?.edges?.length &&
		!remove?.nodes?.length &&
		!remove?.edges?.length &&
		!(change.chart && Object.keys(change.chart).length)
	)
}

// The records after a change: removed ones dropped, patches applied, added ones appended.
export function applyFlowChange(nodes, edges, change) {
	if (!change) return { nodes: [...nodes], edges: [...edges] }
	const apply = (list, add, update, remove) => {
		const gone = new Set(remove || [])
		const patches = new Map()
		for (const { id, patch } of update || [])
			patches.set(id, { ...(patches.get(id) || {}), ...patch })
		return [
			...list
				.filter((item) => !gone.has(item.id))
				.map((item) =>
					patches.has(item.id) ? { ...item, ...patches.get(item.id) } : item,
				),
			...(add || []),
		]
	}
	return {
		nodes: apply(nodes, change.add?.nodes, change.update?.nodes, change.remove?.nodes),
		edges: apply(edges, change.add?.edges, change.update?.edges, change.remove?.edges),
	}
}

export const applyChartPatch = (chart, change) =>
	change?.chart ? { ...chart, ...change.chart } : chart

const finish = (change) => (isEmptyChange(change) ? null : change)

// ----- reading the graph -----

const byOrder = (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export const outEdges = (edges, id) => edges.filter((e) => e.from === id).sort(byOrder)
export const inEdges = (edges, id) => edges.filter((e) => e.to === id)
export const successors = (edges, id) => outEdges(edges, id).map((e) => e.to)
export const predecessors = (edges, id) => inEdges(edges, id).map((e) => e.from)

// Nodes nothing points to: where the flow starts.
export function sourcesOf(nodes, edges) {
	const targets = new Set(edges.map((e) => e.to))
	return nodes.filter((n) => !targets.has(n.id))
}

// "Yes", "No", then "Option 3", "Option 4" ... for the outputs of a decision (0-based index).
export const branchLabel = (index) =>
	index === 0 ? "Yes" : index === 1 ? "No" : `Option ${index + 1}`

// The order for a new output: one past the last, never clashing with what is there.
const nextOrder = (outs) =>
	outs.length ? Math.max(outs.length, Math.max(...outs.map((e) => e.order)) + 1) : 0

const byId = (list) => new Map(list.map((item) => [item.id, item]))
const cutLabel = (value) => (typeof value === "string" ? value.slice(0, FLOW_LABEL_LIMIT) : "")
const cutText = (value) => (typeof value === "string" ? value.slice(0, FLOW_TEXT_LIMIT) : "")

// ----- adding nodes -----

function attachNode(chart, nodes, edges, from, node, label) {
	const outs = outEdges(edges, from.id)
	const edge = createFlowEdge({
		chartId: chart.id,
		from: from.id,
		to: node.id,
		label: label ?? (from.type === "decision" ? branchLabel(outs.length) : ""),
		order: nextOrder(outs),
	})
	return { ...emptyChange(), add: { nodes: [node], edges: [edge] } }
}

// May this node get one more output?
const canHaveOutput = (node, edges) =>
	node.type !== "terminator" || !edges.some((e) => e.from === node.id)

const hasRoom = (nodes, edges, extraNodes = 1, extraEdges = 1) =>
	nodes.length + extraNodes <= MAX_NODES && edges.length + extraEdges <= MAX_EDGES

// A new node of ``type`` one rank on from ``fromId``, joined to it.
export function addNodeFrom(chart, nodes, edges, fromId, type, options = {}) {
	const { text, measure, branch } = options
	const from = nodes.find((n) => n.id === fromId)
	if (!from || !NODE_TYPES.includes(type) || !hasRoom(nodes, edges)) return null
	if (!canHaveOutput(from, edges)) return null
	const outs = outEdges(edges, fromId)
	const node = createFlowNode({ chartId: chart.id, type, text })
	const point = placeChild(chart, nodes, edges, fromId, type, measure, {
		branch: branch ?? outs.length,
	})
	node.x = point.x
	node.y = point.y
	return attachNode(chart, nodes, edges, from, node)
}

// The same, placed where a connector was dropped on empty canvas: the node is manual.
export function addNodeAt(chart, nodes, edges, fromId, type, point, options = {}) {
	const { text, measure } = options
	const from = nodes.find((n) => n.id === fromId)
	if (!from || !NODE_TYPES.includes(type) || !hasRoom(nodes, edges)) return null
	if (!canHaveOutput(from, edges)) return null
	const at = placeAt(nodes, point, type, measure)
	const node = createFlowNode({ chartId: chart.id, type, text, x: at.x, y: at.y, manual: true })
	return attachNode(chart, nodes, edges, from, node)
}

// ----- decision branches -----

export function addDecisionBranch(chart, nodes, edges, decisionId, { measure } = {}) {
	const decision = nodes.find((n) => n.id === decisionId)
	if (!decision || decision.type !== "decision" || !hasRoom(nodes, edges)) return null
	const outs = outEdges(edges, decisionId)
	const node = createFlowNode({ chartId: chart.id, type: "process" })
	const point = placeChild(chart, nodes, edges, decisionId, "process", measure, {
		branch: outs.length,
	})
	node.x = point.x
	node.y = point.y
	return attachNode(chart, nodes, edges, decision, node, branchLabel(outs.length))
}

// Removes one output of a decision, as long as it keeps at least two.
export function removeBranch(nodes, edges, edgeId) {
	const edge = edges.find((e) => e.id === edgeId)
	if (!edge) return null
	const from = nodes.find((n) => n.id === edge.from)
	if (!from || from.type !== "decision" || outEdges(edges, from.id).length < 3) return null
	return { ...emptyChange(), remove: { nodes: [], edges: [edgeId] } }
}

// ----- changing a node -----

// Another type for the same node: every edge stays. The text follows only while it is still the
// old type's default, and a node that becomes a decision labels its unlabelled outputs.
export function swapType(nodes, edges, id, type) {
	const node = nodes.find((n) => n.id === id)
	if (!node || !NODE_TYPES.includes(type) || node.type === type) return null
	const patch = { type }
	if (node.text === TYPE_INFO[node.type].text) patch.text = TYPE_INFO[type].text
	const change = emptyChange()
	change.update.nodes.push({ id, patch })
	if (type === "decision") {
		outEdges(edges, id).forEach((edge, i) => {
			if (!edge.label)
				change.update.edges.push({ id: edge.id, patch: { label: branchLabel(i) } })
		})
	}
	return change
}

export function setNodeText(nodes, id, text) {
	const node = nodes.find((n) => n.id === id)
	const next = cutText(text)
	if (!node || node.text === next) return null
	const change = emptyChange()
	change.update.nodes.push({ id, patch: { text: next } })
	return change
}

// A text size (8 to 200) for the given steps, or null to put them back to the default.
export function setFontSize(nodes, ids, size) {
	const next = size === null ? null : Math.round(Number(size))
	if (next !== null && !(next >= FLOW_FONT_RANGE.min && next <= FLOW_FONT_RANGE.max)) return null
	const wanted = new Set(ids)
	const change = emptyChange()
	for (const node of nodes) {
		if (!wanted.has(node.id) || node.type === "junction") continue
		if ((node.fontSize || null) === next) continue
		change.update.nodes.push({ id: node.id, patch: { fontSize: next } })
	}
	return finish(change)
}

export const setAllFontSize = (nodes, size) =>
	setFontSize(
		nodes,
		nodes.map((n) => n.id),
		size,
	)

export function setEdgeLabel(edges, edgeId, label) {
	const edge = edges.find((e) => e.id === edgeId)
	const next = cutLabel(label)
	if (!edge || edge.label === next) return null
	const change = emptyChange()
	change.update.edges.push({ id: edgeId, patch: { label: next } })
	return change
}

// ----- inserting in the middle of an edge -----

const sameValue = (a, b) => Math.abs(a - b) < 1e-9

// Splices the node ``node`` (new or existing, at any position) into the edge. When there is room
// it sits midway between the two nodes' facing borders; otherwise everything from the edge's end
// on moves forward by exactly the shortfall.
function spliceInto(chart, nodes, edges, edge, node, isNew, measure) {
	const from = nodes.find((n) => n.id === edge.from)
	const to = nodes.find((n) => n.id === edge.to)
	if (!from || !to) return null
	const change = emptyChange()
	const horizontal = chart.direction === "LR"
	let point
	if (backEdgeIds(chart, nodes, edges).has(edge.id)) {
		point = placeChild(chart, nodes, edges, from.id, node.type, measure, { branch: 0 })
	} else {
		const along = (size) => (horizontal ? size.w : size.h)
		const pos = (n) => (horizontal ? n.x : n.y)
		const fromFar = pos(from) + along(nodeSize(from, measure)) / 2
		const toNear = pos(to) - along(nodeSize(to, measure)) / 2
		const gap = toNear - fromFar
		const need = along(nodeSize(node, measure)) + 2 * GAPS.along
		let centre
		if (gap >= need) centre = (fromFar + toNear) / 2
		else {
			const moved = shiftDownstream(chart, nodes, edges, [to.id], need - gap)
			for (const move of moved) change.update.nodes.push(move)
			centre = fromFar + need / 2
		}
		point = horizontal ? { x: centre, y: from.y } : { x: from.x, y: centre }
	}
	if (isNew) {
		node.x = point.x
		node.y = point.y
		change.add.nodes.push(node)
	} else {
		const same = sameValue(node.x, point.x) && sameValue(node.y, point.y)
		if (!same || node.manual) {
			change.update.nodes.push({
				id: node.id,
				patch: { x: point.x, y: point.y, manual: false },
			})
		}
	}
	change.update.edges.push({ id: edge.id, patch: { to: node.id } })
	change.add.edges.push(
		createFlowEdge({ chartId: chart.id, from: node.id, to: to.id, label: "", order: 0 }),
	)
	return change
}

export function insertOnEdge(chart, nodes, edges, edgeId, type, { measure } = {}) {
	const edge = edges.find((e) => e.id === edgeId)
	if (!edge || !NODE_TYPES.includes(type) || !hasRoom(nodes, edges)) return null
	const node = createFlowNode({ chartId: chart.id, type })
	return spliceInto(chart, nodes, edges, edge, node, true, measure)
}

// A node dropped onto an edge: it must have no edges of its own and not be one end of that edge.
export function spliceNodeOnEdge(chart, nodes, edges, nodeId, edgeId, { measure } = {}) {
	const edge = edges.find((e) => e.id === edgeId)
	const node = nodes.find((n) => n.id === nodeId)
	if (!edge || !node || edge.from === nodeId || edge.to === nodeId) return null
	if (edges.some((e) => e.from === nodeId || e.to === nodeId)) return null
	if (edges.length + 1 > MAX_EDGES) return null
	return spliceInto(chart, nodes, edges, edge, node, false, measure)
}

// ----- removing -----

// Removes a node and its edges. With ``reconnect``, a node with exactly one way in and one way out
// is bridged: a new edge joins the two neighbours, keeping the label (and, when the neighbour has
// other outputs, its place among them).
export function removeNode(nodes, edges, id, { reconnect = true } = {}) {
	const node = nodes.find((n) => n.id === id)
	if (!node) return null
	const change = emptyChange()
	change.remove.nodes.push(id)
	for (const edge of edges)
		if (edge.from === id || edge.to === id) change.remove.edges.push(edge.id)
	const ins = inEdges(edges, id)
	const outs = outEdges(edges, id)
	if (reconnect && ins.length === 1 && outs.length === 1) {
		const [into] = ins
		const [out] = outs
		const taken = edges.some(
			(e) => e.from === into.from && e.to === out.to && e.id !== into.id && e.id !== out.id,
		)
		if (into.from !== out.to && !taken) {
			const siblings = outEdges(edges, into.from).length > 1
			change.add.edges.push(
				createFlowEdge({
					chartId: node.chartId,
					from: into.from,
					to: out.to,
					label: siblings ? into.label || out.label : out.label || into.label,
					order: siblings ? into.order : out.order,
				}),
			)
		}
	}
	return change
}

export function removeEdge(edges, edgeId) {
	if (!edges.some((e) => e.id === edgeId)) return null
	return { ...emptyChange(), remove: { nodes: [], edges: [edgeId] } }
}

export function deleteChartChange(chart, nodes, edges) {
	const change = emptyChange()
	change.remove.nodes = nodes.map((n) => n.id)
	change.remove.edges = edges.map((e) => e.id)
	return change
}

// ----- edges -----

export function connect(chart, nodes, edges, fromId, toId, { label } = {}) {
	const nodeById = byId(nodes)
	const from = nodeById.get(fromId)
	if (!from || !nodeById.has(toId) || fromId === toId) return null
	if (edges.some((e) => e.from === fromId && e.to === toId)) return null
	if (!canHaveOutput(from, edges) || edges.length + 1 > MAX_EDGES) return null
	const outs = outEdges(edges, fromId)
	const edge = createFlowEdge({
		chartId: chart.id,
		from: fromId,
		to: toId,
		label:
			label !== undefined && label !== null
				? cutLabel(label)
				: from.type === "decision"
					? branchLabel(outs.length)
					: "",
		order: nextOrder(outs),
	})
	return { ...emptyChange(), add: { nodes: [], edges: [edge] } }
}

// Moves an output up or down among the node's outputs by swapping ``order`` values; null at the ends.
export function reorderBranches(edges, nodeId, edgeId, delta) {
	const outs = outEdges(edges, nodeId)
	const from = outs.findIndex((e) => e.id === edgeId)
	const to = from + delta
	if (from < 0 || !Number.isInteger(delta) || !delta || to < 0 || to >= outs.length) return null
	const slots = outs.map((e) => e.order)
	const distinct = new Set(slots).size === slots.length
	const arranged = [...outs]
	const [moved] = arranged.splice(from, 1)
	arranged.splice(to, 0, moved)
	const change = emptyChange()
	arranged.forEach((edge, i) => {
		const order = distinct ? slots[i] : i
		if (edge.order !== order) change.update.edges.push({ id: edge.id, patch: { order } })
	})
	return finish(change)
}

// ----- positions -----

export function moveNodes(nodes, ids, dx, dy) {
	const wanted = new Set(ids)
	const change = emptyChange()
	for (const node of nodes) {
		if (!wanted.has(node.id)) continue
		if (!dx && !dy && node.manual) continue
		change.update.nodes.push({
			id: node.id,
			patch: { x: node.x + dx, y: node.y + dy, manual: true },
		})
	}
	return finish(change)
}

export function setNodePosition(nodes, id, x, y) {
	const node = nodes.find((n) => n.id === id)
	if (!node || !Number.isFinite(x) || !Number.isFinite(y)) return null
	if (node.x === x && node.y === y && node.manual) return null
	const change = emptyChange()
	change.update.nodes.push({ id, patch: { x, y, manual: true } })
	return change
}

// Re-flows the whole chart: one change, so one undo step. Moved nodes become automatic again.
export function tidyChange(chart, nodes, edges, measure) {
	const positions = tidyLayout(chart, nodes, edges, measure)
	const change = emptyChange()
	for (const node of nodes) {
		const at = positions.get(node.id)
		if (!at) continue
		if (sameValue(at.x, node.x) && sameValue(at.y, node.y) && !node.manual) continue
		change.update.nodes.push({ id: node.id, patch: { x: at.x, y: at.y, manual: false } })
	}
	return finish(change)
}

// TB or LR: the chart patch plus the tidy positions for the new direction.
export function setDirection(chart, nodes, edges, direction, measure) {
	if (!DIRECTIONS.includes(direction) || direction === chart.direction) return null
	const change = tidyChange({ ...chart, direction }, nodes, edges, measure) ?? emptyChange()
	change.chart = { direction }
	return change
}

export function setNumbered(chart, value) {
	const numbered = Boolean(value)
	if (numbered === Boolean(chart.numbered)) return null
	return { ...emptyChange(), chart: { numbered } }
}

// ----- a new chart -----

// A new, separate chart: a Start terminator and one Step, joined. Its Start is centred on
// ``origin``; without one the chart goes below ``bounds`` (everything already on the board).
export function newChartChange({ origin = null, bounds = null, direction = "TB", measure } = {}) {
	const chart = createChart({ direction })
	const start = createFlowNode({ chartId: chart.id, type: "terminator" })
	const step = createFlowNode({ chartId: chart.id, type: "process" })
	const a = nodeSize(start, measure)
	const b = nodeSize(step, measure)
	const horizontal = chart.direction === "LR"
	const size = horizontal
		? { w: a.w + GAPS.along + b.w, h: Math.max(a.h, b.h) }
		: { w: Math.max(a.w, b.w), h: a.h + GAPS.along + b.h }
	let centre = origin
	if (!centre) {
		// positionBelow gives the centre of the whole chart's box; Start sits at its leading end.
		const middle = positionBelow(bounds, size, NEW_CHART_GAP)
		centre = horizontal
			? { x: middle.x - size.w / 2 + a.w / 2, y: middle.y }
			: { x: middle.x, y: middle.y - size.h / 2 + a.h / 2 }
	}
	start.x = centre.x
	start.y = centre.y
	if (horizontal) {
		step.x = centre.x + a.w / 2 + GAPS.along + b.w / 2
		step.y = centre.y
	} else {
		step.x = centre.x
		step.y = centre.y + a.h / 2 + GAPS.along + b.h / 2
	}
	const edge = createFlowEdge({ chartId: chart.id, from: start.id, to: step.id })
	return { chart, change: { ...emptyChange(), add: { nodes: [start, step], edges: [edge] } } }
}
