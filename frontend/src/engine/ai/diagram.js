// Turns the description an AI model sent back (a title, nodes and edges) into the records the editor
// already knows: a mind map, a flowchart, or an architecture diagram made of ordinary shapes and
// connectors. Nothing here draws anything and nothing here talks to a server: these are pure functions
// that return records, and ``insertDiagram`` (insert.js) puts them on the board as ONE undoable step.
//
// The description has been checked on the server, but it is read defensively here too: a record that
// does not fit is dropped rather than trusted.

import { createConnector, createFrame, createObject, emptyText } from "../model/factories"
import { createChart, createFlowEdge, createFlowNode, nodeSize } from "../modes/flowchart/model"
import { branchLabel } from "../modes/flowchart/ops"
import { tidyLayout } from "../modes/flowchart/layout"
import { createCrosslink, createMap, createNode } from "../modes/mindmap/model"

export const AI_KINDS = ["flowchart", "architecture", "mindmap"]
export const AI_LIMITS = { maxNodes: 60, maxEdges: 120, maxLabel: 120 }

const text = (value, max) =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : ""

// A description cleaned for drawing: bounded, with every edge naming two nodes that exist, no loops
// on one node and no repeated edge.
export function cleanSpec(raw) {
	const nodes = []
	const ids = new Set()
	for (const n of Array.isArray(raw?.nodes) ? raw.nodes : []) {
		if (nodes.length >= AI_LIMITS.maxNodes) break
		const id = typeof n?.id === "string" ? n.id : ""
		if (!id || ids.has(id)) continue
		ids.add(id)
		nodes.push({
			id,
			label: text(n.label, AI_LIMITS.maxLabel) || id,
			shape: typeof n.shape === "string" ? n.shape : "process",
			lane: text(n.lane, 64) || null,
		})
	}
	const edges = []
	const seen = new Set()
	for (const e of Array.isArray(raw?.edges) ? raw.edges : []) {
		if (edges.length >= AI_LIMITS.maxEdges) break
		if (!ids.has(e?.from) || !ids.has(e?.to) || e.from === e.to) continue
		const key = `${e.from}\u0001${e.to}`
		if (seen.has(key)) continue
		seen.add(key)
		edges.push({
			from: e.from,
			to: e.to,
			label: text(e.label, AI_LIMITS.maxLabel),
			style: e.style === "dashed" ? "dashed" : "solid",
		})
	}
	return { title: text(raw?.title, AI_LIMITS.maxLabel) || null, nodes, edges }
}

const bounds = (boxes) => {
	let x1 = Infinity
	let y1 = Infinity
	let x2 = -Infinity
	let y2 = -Infinity
	for (const b of boxes) {
		x1 = Math.min(x1, b.x)
		y1 = Math.min(y1, b.y)
		x2 = Math.max(x2, b.x + b.w)
		y2 = Math.max(y2, b.y + b.h)
	}
	return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

// ----- mind map -----

// The first node is the central idea. A tree is grown from it along the edges (an edge's own
// direction first, then against it), a node nothing reaches hangs from the centre, and an edge that
// is not part of the tree becomes a cross-link.
export function buildMindMap(spec, { origin }) {
	const { nodes, edges } = cleanSpec(spec)
	if (!nodes.length) return null
	const { map, root } = createMap({ origin })
	const records = new Map([[nodes[0].id, { ...root, text: nodes[0].label }]])
	const position = new Map(nodes.map((n, i) => [n.id, i]))
	const neighbours = (id) => {
		const near = []
		for (const e of edges) if (e.from === id) near.push(e.to)
		for (const e of edges) if (e.to === id) near.push(e.from)
		return [...new Set(near)].sort((a, b) => position.get(a) - position.get(b))
	}
	const label = new Map(nodes.map((n) => [n.id, n.label]))
	const orders = new Map()
	const attach = (id, parentId) => {
		const order = orders.get(parentId) ?? 0
		orders.set(parentId, order + 1)
		records.set(
			id,
			createNode({
				mapId: map.id,
				parentId: records.get(parentId).id,
				order,
				text: label.get(id),
			}),
		)
	}
	const tree = new Set()
	const queue = [nodes[0].id]
	while (queue.length) {
		const id = queue.shift()
		for (const next of neighbours(id)) {
			if (records.has(next)) continue
			attach(next, id)
			tree.add(`${id}\u0001${next}`)
			tree.add(`${next}\u0001${id}`)
			queue.push(next)
		}
	}
	for (const n of nodes) if (!records.has(n.id)) attach(n.id, nodes[0].id)
	const links = []
	const linked = new Set()
	for (const e of edges) {
		const pair = [e.from, e.to].sort().join("\u0001")
		if (tree.has(`${e.from}\u0001${e.to}`) || linked.has(pair) || links.length >= 40) continue
		linked.add(pair)
		links.push(
			createCrosslink({
				mapId: map.id,
				from: records.get(e.from).id,
				to: records.get(e.to).id,
				label: e.label,
			}),
		)
	}
	const rootNode = records.get(nodes[0].id)
	return { map, nodes: [...records.values()], links, selectId: rootNode.id }
}

// ----- flowchart -----

const FLOW_TYPE = { terminator: "terminator", decision: "decision", document: "io" }

export function buildFlowchart(spec, { origin, measure, direction = "TB" }) {
	const { nodes, edges } = cleanSpec(spec)
	if (!nodes.length) return null
	const chart = createChart({ direction })
	const made = new Map(
		nodes.map((n) => [
			n.id,
			createFlowNode({
				chartId: chart.id,
				type: FLOW_TYPE[n.shape] || "process",
				text: n.label,
			}),
		]),
	)
	const flowNodes = [...made.values()]
	const used = new Map()
	const flowEdges = edges.map((e) => {
		const from = made.get(e.from)
		const order = used.get(from.id) ?? 0
		used.set(from.id, order + 1)
		return createFlowEdge({
			chartId: chart.id,
			from: from.id,
			to: made.get(e.to).id,
			// a branch the model left unnamed still reads as Yes / No
			label: e.label || (from.type === "decision" ? branchLabel(order) : ""),
			order,
		})
	})
	const positions = tidyLayout(chart, flowNodes, flowEdges, measure)
	const boxes = flowNodes.map((n) => {
		const at = positions.get(n.id) ?? { x: 0, y: 0 }
		const size = nodeSize(n, measure)
		return { x: at.x - size.w / 2, y: at.y - size.h / 2, w: size.w, h: size.h }
	})
	const box = bounds(boxes)
	const dx = origin.x - (box.x + box.w / 2)
	const dy = origin.y - (box.y + box.h / 2)
	for (const n of flowNodes) {
		const at = positions.get(n.id) ?? { x: 0, y: 0 }
		n.x = Math.round(at.x + dx)
		n.y = Math.round(at.y + dy)
	}
	return {
		chart,
		nodes: flowNodes,
		edges: flowEdges,
		box: { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h },
		selectId: flowNodes[0].id,
	}
}

// ----- architecture -----

// What each shape in the description is drawn as: the editor's shape, and a starting size.
const ARCH_SHAPE = {
	process: ["rectangle", 200, 90],
	service: ["rectangle", 200, 90],
	server: ["rectangle", 200, 90],
	storage: ["rectangle", 200, 90],
	note: ["rectangle", 200, 90],
	database: ["cylinder", 170, 120],
	cloud: ["cloud", 210, 110],
	document: ["document", 190, 100],
	decision: ["diamond", 210, 120],
	terminator: ["ellipse", 180, 70],
	user: ["ellipse", 150, 100],
	queue: ["hexagon", 210, 80],
}
const GAP = { x: 60, y: 70, lane: 70, frame: 28, title: 30 }

// How deep each node sits: the longest path to it, ignoring the edges that close a cycle.
export function depths(nodes, edges) {
	const out = new Map(nodes.map((n) => [n.id, []]))
	for (const e of edges) out.get(e.from).push(e.to)
	const state = new Map()
	const back = new Set()
	for (const root of nodes) {
		if (state.has(root.id)) continue
		const stack = [[root.id, 0]]
		state.set(root.id, 1)
		while (stack.length) {
			const top = stack[stack.length - 1]
			const next = out.get(top[0])[top[1]++]
			if (next === undefined) {
				state.set(top[0], 2)
				stack.pop()
			} else if (state.get(next) === 1) back.add(`${top[0]}\u0001${next}`)
			else if (!state.has(next)) {
				state.set(next, 1)
				stack.push([next, 0])
			}
		}
	}
	const forward = edges.filter((e) => !back.has(`${e.from}\u0001${e.to}`))
	const depth = new Map(nodes.map((n) => [n.id, 0]))
	for (let pass = 0; pass < nodes.length; pass++) {
		let changed = false
		for (const e of forward)
			if (depth.get(e.to) < depth.get(e.from) + 1) {
				depth.set(e.to, depth.get(e.from) + 1)
				changed = true
			}
		if (!changed) break
	}
	return depth
}

const labelText = (label, theme) => ({
	...emptyText(theme),
	paragraphs: [{ runs: [{ t: label }] }],
})

// Shapes in a grid: one column group for each lane (when there is more than one) and one row for each
// depth. A lane is drawn as a named frame behind its shapes.
export function buildArchitecture(spec, { origin, measure, theme, z = 1 }) {
	const { nodes, edges } = cleanSpec(spec)
	if (!nodes.length) return null
	const depth = depths(nodes, edges)
	const lanes = [...new Set(nodes.map((n) => n.lane ?? ""))]
	const multi = lanes.length > 1
	const laneOf = (n) => (multi ? lanes.indexOf(n.lane ?? "") : 0)

	const sizes = new Map()
	for (const n of nodes) {
		const [shape, w, h] = ARCH_SHAPE[n.shape] || ARCH_SHAPE.process
		const room = w - 28
		const lines = Math.max(1, Math.ceil((measure(n.label, 16) * 1.15) / room))
		sizes.set(n.id, { shape, w, h: Math.max(h, lines * 22 + 36) })
	}
	// cells: lane x depth -> the nodes in it, in the order they were given
	const cells = new Map()
	for (const n of nodes) {
		const key = `${laneOf(n)}:${depth.get(n.id)}`
		cells.set(key, [...(cells.get(key) ?? []), n])
	}
	const rowCount = Math.max(...depth.values()) + 1
	const rowHeight = Array.from({ length: rowCount }, (_, r) => {
		let tallest = 0
		for (const [key, list] of cells)
			if (Number(key.split(":")[1]) === r)
				tallest = Math.max(tallest, ...list.map((n) => sizes.get(n.id).h))
		return tallest
	})
	const laneWidth = lanes.map((_, l) => {
		let widest = 0
		for (const [key, list] of cells)
			if (Number(key.split(":")[0]) === l)
				widest = Math.max(
					widest,
					list.reduce((sum, n) => sum + sizes.get(n.id).w, 0) + GAP.x * (list.length - 1),
				)
		return widest
	})
	const laneLeft = []
	let x = 0
	for (const w of laneWidth) {
		laneLeft.push(x)
		x += w + (multi ? GAP.lane + GAP.frame * 2 : 0)
	}
	const rowTop = []
	let y = multi ? GAP.title : 0
	for (const h of rowHeight) {
		rowTop.push(y)
		y += h + GAP.y
	}

	const rects = new Map()
	for (const [key, list] of cells) {
		const [l, r] = key.split(":").map(Number)
		const total = list.reduce((s, n) => s + sizes.get(n.id).w, 0) + GAP.x * (list.length - 1)
		let at = laneLeft[l] + (multi ? GAP.frame : 0) + (laneWidth[l] - total) / 2
		for (const n of list) {
			const s = sizes.get(n.id)
			rects.set(n.id, {
				x: at,
				y: rowTop[r] + (rowHeight[r] - s.h) / 2,
				w: s.w,
				h: s.h,
			})
			at += s.w + GAP.x
		}
	}
	const frameRects = multi
		? lanes.map((name, l) => ({
				name: name || "Other",
				x: laneLeft[l],
				y: 0,
				w: laneWidth[l] + GAP.frame * 2,
				h: y - GAP.y + GAP.frame,
			}))
		: []
	const box = bounds([...rects.values(), ...frameRects])
	const dx = Math.round(origin.x - (box.x + box.w / 2))
	const dy = Math.round(origin.y - (box.y + box.h / 2))
	const shift = (r) => ({ x: Math.round(r.x + dx), y: Math.round(r.y + dy), w: r.w, h: r.h })

	let nextZ = z
	const frames = frameRects.map((r) => createFrame(shift(r), { name: r.name, z: nextZ++ }))
	const objects = new Map()
	for (const n of nodes) {
		const object = createObject(sizes.get(n.id).shape, shift(rects.get(n.id)), {
			theme,
			z: nextZ++,
			text: labelText(n.label, theme),
		})
		objects.set(n.id, object)
	}
	const rowOf = new Map(nodes.map((n) => [n.id, depth.get(n.id)]))
	const connectors = edges.map((e) => {
		const a = rects.get(e.from)
		const b = rects.get(e.to)
		let anchors
		if (rowOf.get(e.to) > rowOf.get(e.from)) anchors = ["s", "n"]
		else if (rowOf.get(e.to) < rowOf.get(e.from)) anchors = ["n", "s"]
		else anchors = a.x <= b.x ? ["e", "w"] : ["w", "e"]
		const connector = createConnector({
			from: { objectId: objects.get(e.from).id, anchor: anchors[0] },
			to: { objectId: objects.get(e.to).id, anchor: anchors[1] },
			geometry: "elbow",
			theme,
			z: nextZ++,
		})
		if (e.label) connector.label = { text: e.label }
		if (e.style === "dashed") connector.style = { ...connector.style, dash: "dashed" }
		return connector
	})
	return {
		frames,
		objects: nodes.map((n) => objects.get(n.id)),
		connectors,
		box: shift(box),
	}
}
