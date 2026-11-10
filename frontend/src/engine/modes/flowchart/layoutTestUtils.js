// Test helpers for the flowchart layout and routing: small graph builders, a seeded random graph
// and overlap checks. Ids are the names given, so tests read like the pictures they describe.

import { createFlowEdge, createFlowNode, nodeSize } from "./model"

export const measure = (text, size) => text.length * size * 0.5

export const chartOf = (direction = "TB") => ({ id: "c", direction, numbered: false })

export const flowNode = (id, type = "process", x = 0, y = 0, extra = {}) =>
	createFlowNode({ id, chartId: "c", type, text: id, x, y, ...extra })

let counter = 0
export const flowEdge = (from, to, order = 0, extra = {}) =>
	createFlowEdge({ id: `${from}>${to}#${counter++}`, chartId: "c", from, to, order, ...extra })

// graphOf(["A", ["D", "decision"], "B"], [["A", "D"], ["D", "B", 1]]): node entries are an id or
// [id, type, x, y]; edge entries are [from, to, order?].
export function graphOf(nodeSpecs, edgeSpecs) {
	return {
		nodes: nodeSpecs.map((s) => (Array.isArray(s) ? flowNode(...s) : flowNode(s))),
		edges: edgeSpecs.map(([from, to, order = 0]) => flowEdge(from, to, order)),
	}
}

export function seeded(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const TYPES = ["process", "process", "process", "decision", "io", "terminator", "junction"]

// A seeded random graph: every node after the first hangs off an earlier one (so it is one
// piece), plus extra forward edges, ``back`` edges to earlier nodes (cycles) and ``loops`` self
// references. ``spread`` scatters the positions at random instead of leaving them at 0.
export function randomGraph(
	count,
	seed = 1,
	{ back = 0, loops = 0, extra = 0.3, spread = 0 } = {},
) {
	const rand = seeded(seed)
	const nodes = []
	const edges = []
	const orders = new Map()
	const connect = (from, to) => {
		const order = orders.get(from) ?? 0
		orders.set(from, order + 1)
		edges.push(flowEdge(from, to, order))
	}
	for (let i = 0; i < count; i++) {
		const id = `n${String(i).padStart(4, "0")}`
		const type = TYPES[Math.floor(rand() * TYPES.length)]
		const word = "w".repeat(1 + Math.floor(rand() * 18))
		nodes.push(
			createFlowNode({
				id,
				chartId: "c",
				type,
				text: type === "junction" ? "" : word,
				x: spread ? Math.round((rand() - 0.5) * spread) : 0,
				y: spread ? Math.round((rand() - 0.5) * spread) : 0,
			}),
		)
		if (i > 0) connect(nodes[Math.floor(rand() * i)].id, id)
		if (i > 1 && rand() < extra) connect(nodes[Math.floor(rand() * i)].id, id)
	}
	for (let i = 0; i < back && count > 2; i++) {
		const to = Math.floor(rand() * (count - 1))
		const from = to + 1 + Math.floor(rand() * (count - to - 1))
		connect(nodes[from].id, nodes[to].id)
	}
	for (let i = 0; i < loops; i++) {
		const id = nodes[Math.floor(rand() * count)].id
		connect(id, id)
	}
	return { nodes, edges }
}

// Nodes moved to the centres of a layout result.
export const placed = (nodes, positions) =>
	nodes.map((n) => ({ ...n, x: positions.get(n.id).x, y: positions.get(n.id).y }))

export const boxes = (nodes) =>
	new Map(
		nodes.map((n) => {
			const s = nodeSize(n, measure)
			return [n.id, { x: n.x - s.w / 2, y: n.y - s.h / 2, w: s.w, h: s.h }]
		}),
	)

export const overlaps = (a, b, tolerance = 1e-6) =>
	a.x < b.x + b.w - tolerance &&
	b.x < a.x + a.w - tolerance &&
	a.y < b.y + b.h - tolerance &&
	b.y < a.y + a.h - tolerance

// Ids of the first pair of node boxes that overlap, or null.
export function firstOverlap(nodes) {
	const list = [...boxes(nodes).entries()]
	for (let i = 0; i < list.length; i++)
		for (let j = i + 1; j < list.length; j++)
			if (overlaps(list[i][1], list[j][1])) return [list[i][0], list[j][0]]
	return null
}
