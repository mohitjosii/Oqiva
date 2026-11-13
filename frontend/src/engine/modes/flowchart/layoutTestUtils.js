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

// Every (edge, node) pair where the edge's route runs through the inside of the node's box (grown
// by ``clearance``), the node being neither end of the edge. ``routes`` is the Map that routeAll
// returns. The two end nodes are not checked: an arrow starts and stops on their border.
export function routeCrossings(nodes, edges, routes, clearance = 0) {
	const box = boxes(nodes)
	const result = []
	for (const edge of edges) {
		const route = routes.get(edge.id)
		if (!route) continue
		for (const [id, b] of box) {
			if (id === edge.from || id === edge.to) continue
			const x0 = b.x - clearance
			const x1 = b.x + b.w + clearance
			const y0 = b.y - clearance
			const y1 = b.y + b.h + clearance
			const eps = 1e-6
			for (let i = 1; i < route.points.length; i++) {
				const p = route.points[i - 1]
				const q = route.points[i]
				if (
					Math.max(p.x, q.x) > x0 + eps &&
					Math.min(p.x, q.x) < x1 - eps &&
					Math.max(p.y, q.y) > y0 + eps &&
					Math.min(p.y, q.y) < y1 - eps
				) {
					result.push({ edge: edge.id, node: id })
					break
				}
			}
		}
	}
	return result
}

// An independent check of whether ANY orthogonal route between the two ends of ``edge`` keeps
// ``margin`` clear of every step (the ends included, past their stubs). It floods the grid made of
// the lines through the steps' grown sides and the two stub ends; slow (use it on small charts).
export function clearRouteExists(nodes, edge, route, margin = 1) {
	const box = [...boxes(nodes).values()].map((b) => ({
		x0: b.x - margin,
		x1: b.x + b.w + margin,
		y0: b.y - margin,
		y1: b.y + b.h + margin,
	}))
	const ends = [boxes(nodes).get(edge.from), boxes(nodes).get(edge.to)]
	const stub = (p, d, b) => {
		// along d from the port until the step's box is cleared, but at least 18 units
		let k = 18
		while (k < 400) {
			const q = { x: p.x + d.x * k, y: p.y + d.y * k }
			if (
				q.x < b.x - margin ||
				q.x > b.x + b.w + margin ||
				q.y < b.y - margin ||
				q.y > b.y + b.h + margin
			)
				return q
			k++
		}
		return { x: p.x + d.x * k, y: p.y + d.y * k }
	}
	const n = route.points.length
	const unit = (a, b) => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) })
	const s = stub(route.points[0], unit(route.points[0], route.points[1]), ends[0])
	const last = route.points[n - 1]
	const e = stub(last, unit(last, route.points[n - 2]), ends[1])
	// the two stubs themselves must be clear of the other steps
	const others = [...boxes(nodes).entries()].filter(([id]) => id !== edge.from && id !== edge.to)
	for (const [a, b] of [
		[route.points[0], s],
		[last, e],
	])
		for (const [, o] of others)
			if (
				Math.max(a.x, b.x) > o.x - margin &&
				Math.min(a.x, b.x) < o.x + o.w + margin &&
				Math.max(a.y, b.y) > o.y - margin &&
				Math.min(a.y, b.y) < o.y + o.h + margin
			)
				return false
	const xs = [...new Set([s.x, e.x, ...box.flatMap((b) => [b.x0, b.x1])])].sort((a, b) => a - b)
	const ys = [...new Set([s.y, e.y, ...box.flatMap((b) => [b.y0, b.y1])])].sort((a, b) => a - b)
	const inside = (x, y) =>
		box.some((b) => x > b.x0 + 1e-6 && x < b.x1 - 1e-6 && y > b.y0 + 1e-6 && y < b.y1 - 1e-6)
	const free = (ax, ay, bx, by) => !inside((ax + bx) / 2, (ay + by) / 2)
	const key = (i, j) => i * ys.length + j
	const seen = new Set([key(xs.indexOf(s.x), ys.indexOf(s.y))])
	const stack = [[xs.indexOf(s.x), ys.indexOf(s.y)]]
	const goal = key(xs.indexOf(e.x), ys.indexOf(e.y))
	while (stack.length) {
		const [i, j] = stack.pop()
		if (key(i, j) === goal) return true
		for (const [di, dj] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		]) {
			const a = i + di
			const b = j + dj
			if (a < 0 || b < 0 || a >= xs.length || b >= ys.length || seen.has(key(a, b))) continue
			if (!free(xs[i], ys[j], xs[a], ys[b])) continue
			seen.add(key(a, b))
			stack.push([a, b])
		}
	}
	return false
}
