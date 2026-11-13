import { describe, expect, it } from "vitest"
import { tidyLayout } from "./layout"
import { routeAll } from "./routing"
import {
	chartOf,
	firstOverlap,
	graphOf,
	measure,
	placed,
	randomGraph,
	routeCrossings,
} from "./layoutTestUtils"

const tidy = (g, direction = "TB") => tidyLayout(chartOf(direction), g.nodes, g.edges, measure)

describe("tidyLayout: long arrows get a lane", () => {
	const chain = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i))
	const withSkip = (n, extra) => {
		const ids = chain(n)
		return graphOf(ids, [
			...ids.slice(1).map((id, i) => [ids[i], id]),
			...extra.map((e) => [...e, 5]),
		])
	}
	for (const direction of ["TB", "LR"]) {
		it(`keeps a chain in line and clear of its skipping arrow (${direction})`, () => {
			const g = withSkip(5, [
				["A", "D"],
				["B", "E"],
			])
			const nodes = placed(g.nodes, tidy(g, direction))
			expect(firstOverlap(nodes)).toBeNull()
			const across = nodes.map((n) => (direction === "TB" ? n.x : n.y))
			expect(Math.max(...across) - Math.min(...across)).toBeLessThan(40)
			const rs = routeAll(chartOf(direction), nodes, g.edges, measure)
			expect(routeCrossings(nodes, g.edges, rs, 6)).toEqual([])
		})
	}
	it("stores positions of the steps only", () => {
		const g = withSkip(5, [["A", "D"]])
		const result = tidy(g)
		expect([...result.keys()].sort()).toEqual(g.nodes.map((n) => n.id).sort())
		for (const p of result.values()) {
			expect(Number.isFinite(p.x)).toBe(true)
			expect(Number.isFinite(p.y)).toBe(true)
		}
	})
	it("a decision whose branch skips ranks", () => {
		const g = graphOf(
			["S", ["D", "decision"], "A", "B", "C", "E"],
			[
				["S", "D"],
				["D", "A", 0],
				["D", "E", 1],
				["A", "B"],
				["B", "C"],
				["C", "E"],
			],
		)
		const nodes = placed(g.nodes, tidy(g))
		expect(firstOverlap(nodes)).toBeNull()
		const rs = routeAll(chartOf(), nodes, g.edges, measure)
		expect(routeCrossings(nodes, g.edges, rs, 6)).toEqual([])
	})
	it("leaves a chart without long arrows exactly as it was", () => {
		const g = withSkip(4, [])
		const nodes = placed(g.nodes, tidy(g))
		expect(new Set(nodes.map((n) => n.x)).size).toBe(1)
	})
	it("random charts: no overlaps, and arrows keep clear of the steps", () => {
		for (const [seed, direction] of [
			[71, "TB"],
			[72, "TB"],
			[73, "LR"],
		]) {
			const g = randomGraph(50, seed, { extra: 0.5, back: 4 })
			const nodes = placed(g.nodes, tidy(g, direction))
			expect(firstOverlap(nodes)).toBeNull()
			const rs = routeAll(chartOf(direction), nodes, g.edges, measure)
			expect(routeCrossings(nodes, g.edges, rs, 0).length).toBeLessThanOrEqual(2)
		}
	})
	it("is deterministic", () => {
		const g = randomGraph(80, 74, { extra: 0.5, back: 6 })
		const a = tidy(g)
		const b = tidyLayout(chartOf(), [...g.nodes].reverse(), [...g.edges].reverse(), measure)
		for (const [id, p] of a) expect(b.get(id)).toEqual(p)
	})
})
