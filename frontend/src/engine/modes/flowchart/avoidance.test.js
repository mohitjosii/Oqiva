import { describe, expect, it } from "vitest"
import { tidyLayout } from "./layout"
import { STUB, routeAll } from "./routing"
import {
	chartOf,
	clearRouteExists,
	flowNode,
	graphOf,
	measure,
	placed,
	randomGraph,
	seeded,
	routeCrossings,
} from "./layoutTestUtils"

const route = (g, direction = "TB") => routeAll(chartOf(direction), g.nodes, g.edges, measure)
const tidied = (g, direction = "TB") => ({
	nodes: placed(g.nodes, tidyLayout(chartOf(direction), g.nodes, g.edges, measure)),
	edges: g.edges,
})
const edgeOf = (g, from, to) => g.edges.find((e) => e.from === from && e.to === to)

describe("routeAll: arrows keep clear of other steps", () => {
	it("a step between a decision's side exit and its target", () => {
		const g = graphOf(
			[
				["D", "decision", 0, 0],
				["S", "process", 320, 0],
				["T", "process", 640, 0],
				["E", "process", 0, 200],
			],
			[
				["D", "E", 0],
				["D", "T", 1],
			],
		)
		const rs = route(g)
		expect(routeCrossings(g.nodes, g.edges, rs, 6)).toEqual([])
	})
	it("a long arrow that skips two rows", () => {
		const g = graphOf(
			["A", "B", "C", "D"].map((id, i) => [id, "process", 0, i * 150]),
			[
				["A", "B"],
				["B", "C"],
				["C", "D"],
				["A", "D", 1],
			],
		)
		const rs = route(g)
		expect(routeCrossings(g.nodes, g.edges, rs, 6)).toEqual([])
		const r = rs.get(edgeOf(g, "A", "D").id)
		expect(r.startDir).toEqual({ x: 0, y: 1 })
		expect(r.endDir).toEqual({ x: 0, y: 1 })
		const last = r.points.at(-1)
		const before = r.points.at(-2)
		expect(Math.abs(last.y - before.y)).toBeGreaterThanOrEqual(STUB - 1e-6)
		expect(last.x).toBe(before.x)
	})
	it("keeps about 12 units from the steps it goes past", () => {
		const g = graphOf(
			["A", "B", "C", "D"].map((id, i) => [id, "process", 0, i * 150]),
			[
				["A", "B"],
				["B", "C"],
				["C", "D"],
				["A", "D", 1],
			],
		)
		const rs = route(g)
		expect(routeCrossings(g.nodes, g.edges, rs, 11.9)).toEqual([])
	})
	it("a back edge, with a step in the way of the plain route", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 0, 150],
				["C", "process", 0, 300],
				["X", "process", 150, 150],
			],
			[
				["A", "B"],
				["B", "C"],
				["C", "A", 0],
			],
		)
		const rs = route(g)
		expect(routeCrossings(g.nodes, g.edges, rs, 6)).toEqual([])
		const r = rs.get(edgeOf(g, "C", "A").id)
		expect(r.fromSide).toBe("right")
		expect(r.toSide).toBe("right")
	})
	it("LR charts", () => {
		const g = graphOf(
			["A", "B", "C", "D"].map((id, i) => [id, "process", i * 300, 0]),
			[
				["A", "B"],
				["B", "C"],
				["C", "D"],
				["A", "D", 1],
				["A", "C", 2],
			],
		)
		const rs = route(g, "LR")
		expect(routeCrossings(g.nodes, g.edges, rs, 6)).toEqual([])
		for (const e of g.edges) expect(rs.get(e.id).endDir).toEqual({ x: 1, y: 0 })
	})
	it("a hand-placed step on a straight arrow", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 0, 300],
				["M", "process", 0, 150, { manual: true }],
			],
			[["A", "B"]],
		)
		const rs = route(g)
		expect(routeCrossings(g.nodes, g.edges, rs, 6)).toEqual([])
		const r = rs.get(g.edges[0].id)
		expect(r.points.length).toBeGreaterThan(2)
	})
	it("a hand-placed step on the arrows of a tidied chart", () => {
		const base = graphOf(
			["A", "B", "C", "D", "E"],
			[
				["A", "B"],
				["B", "C"],
				["C", "D"],
				["D", "E"],
				["A", "E", 1],
			],
		)
		const g = tidied(base)
		const at = (id) => g.nodes.find((n) => n.id === id)
		at("C").x += 40
		// a small hand-placed step right in the gap between B and C, on their arrow: the gap is
		// tight, so the route can only keep a couple of units clear
		g.nodes.push(
			flowNode("M", "junction", at("B").x, (at("B").y + at("C").y) / 2, { manual: true }),
		)
		const rs = route(g)
		expect(routeCrossings(g.nodes, g.edges, rs, 2)).toEqual([])
	})
	it("leaves a straight arrow alone when nothing is in the way", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 0, 200],
				["X", "process", 300, 100],
			],
			[["A", "B"]],
		)
		const r = route(g).get(g.edges[0].id)
		expect(r.points).toEqual([
			{ x: 0, y: 32 },
			{ x: 0, y: 168 },
		])
	})
	it("is deterministic", () => {
		const g = randomGraph(60, 3, { back: 6, spread: 1500 })
		const a = route(g)
		const b = route(g)
		for (const [id, r] of a) expect(b.get(id)).toEqual(r)
	})
})

// The nodes of a graph put on a loose lattice in a shuffled order (no two overlap), the way a person
// leaves steps after dragging them around.
function scattered(graph, seed) {
	const rand = seeded(seed)
	const count = graph.nodes.length
	const cols = Math.ceil(Math.sqrt(count * 1.3))
	const cells = Array.from({ length: cols * cols }, (_, i) => i)
	for (let i = cells.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1))
		;[cells[i], cells[j]] = [cells[j], cells[i]]
	}
	const nodes = graph.nodes.map((n, i) => ({
		...n,
		x: (cells[i] % cols) * 480 + Math.round((rand() - 0.5) * 40),
		y: Math.floor(cells[i] / cols) * 300 + Math.round((rand() - 0.5) * 40),
	}))
	return { nodes, edges: graph.edges }
}

describe("routeAll: random charts", () => {
	const cases = [
		["tidy, DAG", randomGraph(60, 61), true],
		["tidy, cycles", randomGraph(60, 62, { back: 10, loops: 2 }), true],
		["scattered, DAG", scattered(randomGraph(40, 63), 1), false],
		["scattered, cycles", scattered(randomGraph(40, 64, { back: 8, loops: 2 }), 2), false],
	]
	for (const direction of ["TB", "LR"]) {
		for (const [name, graph, useTidy] of cases) {
			it(`${name} (${direction}): an arrow crosses a step only when no clear route exists`, () => {
				const g = useTidy ? tidied(graph, direction) : graph
				const rs = route(g, direction)
				let crossing = 0
				for (const { edge: id } of routeCrossings(g.nodes, g.edges, rs, 0)) {
					const edge = g.edges.find((e) => e.id === id)
					crossing++
					expect(
						clearRouteExists(g.nodes, edge, rs.get(id)),
						`${id} has a clear route`,
					).toBe(false)
				}
				// and most arrows are clear of every step
				expect(crossing).toBeLessThan(g.edges.length / 4)
			})
		}
	}
})
