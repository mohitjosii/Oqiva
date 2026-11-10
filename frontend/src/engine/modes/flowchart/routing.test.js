import { describe, expect, it } from "vitest"
import { backEdgeIds, tidyLayout } from "./layout"
import { nodeSize } from "./model"
import {
	STUB,
	distanceToRoute,
	hitRoute,
	inSide,
	outSides,
	portPoint,
	routeAll,
	routeBounds,
	routeMid,
} from "./routing"
import {
	chartOf,
	flowEdge,
	flowNode,
	graphOf,
	measure,
	placed,
	randomGraph,
} from "./layoutTestUtils"

const route = (g, direction = "TB") => routeAll(chartOf(direction), g.nodes, g.edges, measure)
const sizeOf = (node) => nodeSize(node, measure)
const nodeById = (g, id) => g.nodes.find((n) => n.id === id)
const close = (a, b, d = 1e-6) => Math.abs(a - b) <= d

// True when ``p`` lies on the outline of the node's shape (a diamond for a decision).
function onBorder(node, p) {
	const { w, h } = sizeOf(node)
	const dx = Math.abs(p.x - node.x)
	const dy = Math.abs(p.y - node.y)
	if (node.type === "decision") return close(dx / (w / 2) + dy / (h / 2), 1, 1e-6)
	const inside = dx <= w / 2 + 1e-6 && dy <= h / 2 + 1e-6
	return inside && (close(dx, w / 2) || close(dy, h / 2))
}

// True when the segment a-b passes through the inside of the node's box.
function crossesBox(a, b, node, margin = 1) {
	const { w, h } = sizeOf(node)
	const x0 = node.x - w / 2 + margin
	const x1 = node.x + w / 2 - margin
	const y0 = node.y - h / 2 + margin
	const y1 = node.y + h / 2 - margin
	return (
		Math.max(a.x, b.x) > x0 &&
		Math.min(a.x, b.x) < x1 &&
		Math.max(a.y, b.y) > y0 &&
		Math.min(a.y, b.y) < y1
	)
}

const segments = (r) => r.points.slice(1).map((p, i) => [r.points[i], p])
const length = (r) =>
	segments(r).reduce((sum, [a, b]) => sum + Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 0)

describe("outSides", () => {
	const side = (g, direction, id) => {
		const node = nodeById(g, id)
		const map = outSides(chartOf(direction), g.nodes, g.edges, node)
		return [...g.edges.filter((e) => e.from === id)]
			.sort((a, b) => a.order - b.order)
			.map((e) => map.get(e.id))
	}
	it("uses the forward side for a plain node", () => {
		const g = graphOf(["A", "B"], [["A", "B"]])
		expect(side(g, "TB", "A")).toEqual(["bottom"])
		expect(side(g, "LR", "A")).toEqual(["right"])
	})
	it("sends a decision's outputs bottom, right, left, bottom, right (TB)", () => {
		const g = graphOf(
			[["D", "decision"], "a", "b", "c", "d", "e"],
			[
				["D", "a", 0],
				["D", "b", 1],
				["D", "c", 2],
				["D", "d", 3],
				["D", "e", 4],
			],
		)
		expect(side(g, "TB", "D")).toEqual(["bottom", "right", "left", "bottom", "right"])
		expect(side(g, "LR", "D")).toEqual(["right", "bottom", "top", "right", "bottom"])
	})
	it("sorts the outputs by order and then id", () => {
		const g = graphOf(
			[["D", "decision"], "a", "b"],
			[
				["D", "b", 0],
				["D", "a", 0],
			],
		)
		const map = outSides(chartOf(), g.nodes, g.edges, g.nodes[0])
		expect(map.get(g.edges[1].id)).toBe("bottom") // a comes first
		expect(map.get(g.edges[0].id)).toBe("right")
	})
	it("treats a junction like a plain node", () => {
		const g = graphOf(
			[["J", "junction"], "a", "b"],
			[
				["J", "a", 0],
				["J", "b", 1],
			],
		)
		expect(side(g, "TB", "J")).toEqual(["bottom", "bottom"])
	})
	it("sends a back-edge out by the side away from the flow", () => {
		const g = graphOf(
			["T", "S", ["D", "decision"], "A", "B"],
			[
				["T", "S"],
				["S", "D"],
				["D", "A", 0],
				["A", "B"],
				["B", "S", 0],
				["D", "S", 1],
			],
		)
		expect(backEdgeIds(chartOf(), g.nodes, g.edges).size).toBe(2)
		const backFromB = outSides(chartOf(), g.nodes, g.edges, nodeById(g, "B"))
		expect([...backFromB.values()]).toEqual(["right"])
		const lr = outSides(chartOf("LR"), g.nodes, g.edges, nodeById(g, "B"))
		expect([...lr.values()]).toEqual(["bottom"])
	})
	it("does not use up a decision slot for a back-edge", () => {
		const g = graphOf(
			["T", "S", ["D", "decision"], "A", "B"],
			[
				["T", "S"],
				["S", "D"],
				["D", "S", 0],
				["D", "A", 1],
				["D", "B", 2],
			],
		)
		const map = outSides(chartOf(), g.nodes, g.edges, nodeById(g, "D"))
		const byTarget = Object.fromEntries(
			g.edges.filter((e) => e.from === "D").map((e) => [e.to, map.get(e.id)]),
		)
		expect(byTarget).toEqual({ S: "right", A: "bottom", B: "right" })
	})
})

describe("inSide", () => {
	it("is top for TB and left for LR; a back-edge returns by its out side", () => {
		const edge = flowEdge("A", "B")
		expect(inSide(chartOf("TB"), edge, new Set())).toBe("top")
		expect(inSide(chartOf("LR"), edge, new Set())).toBe("left")
		expect(inSide(chartOf("TB"), edge, new Set([edge.id]))).toBe("right")
		expect(inSide(chartOf("LR"), edge, new Set([edge.id]))).toBe("bottom")
		expect(inSide(chartOf("LR"), edge)).toBe("left")
	})
})

describe("portPoint", () => {
	const process = flowNode("P", "process", 100, 200)
	const size = { w: 170, h: 64 }
	it("is the middle of the side", () => {
		expect(portPoint(process, size, "top")).toEqual({ x: 100, y: 168 })
		expect(portPoint(process, size, "bottom")).toEqual({ x: 100, y: 232 })
		expect(portPoint(process, size, "left")).toEqual({ x: 15, y: 200 })
		expect(portPoint(process, size, "right")).toEqual({ x: 185, y: 200 })
	})
	it("spreads ports along the side, 14 apart and centred", () => {
		const xs = [0, 1, 2].map((i) => portPoint(process, size, "bottom", i, 3).x)
		expect(xs).toEqual([86, 100, 114])
		const ys = [0, 1].map((i) => portPoint(process, size, "right", i, 2).y)
		expect(ys).toEqual([193, 207])
	})
	it("never spreads beyond 80% of the side", () => {
		const ys = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
			(i) => portPoint(process, size, "left", i, 10).y,
		)
		expect(ys[9] - ys[0]).toBeCloseTo(64 * 0.8)
		const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
			(i) => portPoint(process, size, "top", i, 10).x,
		)
		expect(xs[9] - xs[0]).toBeCloseTo(Math.min(14 * 9, 170 * 0.8))
	})
	it("puts a decision's ports on the diamond, tips in the middle", () => {
		const d = flowNode("D", "decision", 0, 0)
		const s = { w: 190, h: 120 }
		expect(portPoint(d, s, "top")).toEqual({ x: 0, y: -60 })
		expect(portPoint(d, s, "bottom")).toEqual({ x: 0, y: 60 })
		expect(portPoint(d, s, "left")).toEqual({ x: -95, y: 0 })
		expect(portPoint(d, s, "right")).toEqual({ x: 95, y: 0 })
		for (const side of ["top", "right", "bottom", "left"]) {
			for (const [i, n] of [
				[0, 3],
				[1, 3],
				[2, 3],
				[0, 2],
				[1, 2],
			]) {
				expect(onBorder(d, portPoint(d, s, side, i, n))).toBe(true)
			}
		}
	})
	it("uses the middle of a junction's side whatever the count", () => {
		const j = flowNode("J", "junction", 10, 10)
		expect(portPoint(j, { w: 24, h: 24 }, "bottom", 1, 3)).toEqual({ x: 10, y: 22 })
		expect(portPoint(j, { w: 24, h: 24 }, "left", 0, 2)).toEqual({ x: -2, y: 10 })
	})
	it("lies on the border for every type and side", () => {
		for (const type of ["terminator", "process", "decision", "io", "junction"]) {
			const node = flowNode("N", type, 33, -12)
			for (const side of ["top", "right", "bottom", "left"])
				for (const [i, n] of [
					[0, 1],
					[0, 4],
					[3, 4],
				])
					expect(onBorder(node, portPoint(node, sizeOf(node), side, i, n))).toBe(true)
		}
	})
})

describe("routeAll: shapes", () => {
	it("is a straight line when the two nodes are aligned (TB)", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 0, 200],
			],
			[["A", "B"]],
		)
		const r = route(g).get(g.edges[0].id)
		expect(r.points).toEqual([
			{ x: 0, y: 32 },
			{ x: 0, y: 168 },
		])
		expect(r).toMatchObject({ fromSide: "bottom", toSide: "top" })
		expect(r.startDir).toEqual({ x: 0, y: 1 })
		expect(r.endDir).toEqual({ x: 0, y: 1 })
	})
	it("is a straight line when aligned (LR)", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 300, 0],
			],
			[["A", "B"]],
		)
		const r = route(g, "LR").get(g.edges[0].id)
		expect(r.points).toEqual([
			{ x: 85, y: 0 },
			{ x: 215, y: 0 },
		])
		expect(r).toMatchObject({ fromSide: "right", toSide: "left" })
		expect(r.endDir).toEqual({ x: 1, y: 0 })
	})
	it("counts two units of misalignment as aligned, and keeps the line orthogonal", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 1.5, 200],
			],
			[["A", "B"]],
		)
		const r = route(g).get(g.edges[0].id)
		expect(r.points).toHaveLength(2)
		expect(r.points[0].x).toBe(r.points[1].x)
		expect(onBorder(nodeById(g, "B"), r.points[1])).toBe(true)
		const wide = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 5, 200],
			],
			[["A", "B"]],
		)
		expect(route(wide).get(wide.edges[0].id).points).toHaveLength(4)
	})
	it("snaps the end that is not a diamond, so a diamond keeps its tip", () => {
		const g = graphOf(
			[
				["D", "decision", 0, 0],
				["B", "process", 1, 200],
			],
			[["D", "B"]],
		)
		const r = route(g).get(g.edges[0].id)
		expect(r.points[0]).toEqual({ x: 0, y: 60 })
		expect(r.points).toHaveLength(2)
	})
	it("takes three segments with the lane midway when the nodes are offset", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 200, 200],
			],
			[["A", "B"]],
		)
		const r = route(g).get(g.edges[0].id)
		expect(r.points).toEqual([
			{ x: 0, y: 32 },
			{ x: 0, y: 100 },
			{ x: 200, y: 100 },
			{ x: 200, y: 168 },
		])
		const lr = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 400, 100],
			],
			[["A", "B"]],
		)
		const r2 = route(lr, "LR").get(lr.edges[0].id)
		expect(r2.points).toEqual([
			{ x: 85, y: 0 },
			{ x: 200, y: 0 },
			{ x: 200, y: 100 },
			{ x: 315, y: 100 },
		])
	})
	it("takes the decision's second output out of its right tip to the top of the target", () => {
		const g = graphOf(
			[
				["D", "decision", 0, 0],
				["Y", "process", 0, 200],
				["N", "process", 250, 200],
			],
			[
				["D", "Y", 0],
				["D", "N", 1],
			],
		)
		const rs = route(g)
		expect(rs.get(g.edges[0].id).points).toHaveLength(2)
		const n = rs.get(g.edges[1].id)
		expect(n.fromSide).toBe("right")
		expect(n.points).toEqual([
			{ x: 95, y: 0 },
			{ x: 250, y: 0 },
			{ x: 250, y: 168 },
		])
		expect(n.startDir).toEqual({ x: 1, y: 0 })
		expect(n.endDir).toEqual({ x: 0, y: 1 })
	})
	it("goes round the side for an edge whose target lies above the source", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 0, -200],
			],
			[["A", "B"]],
		)
		const r = route(g).get(g.edges[0].id)
		for (const [a, b] of segments(r)) expect(a.x === b.x || a.y === b.y).toBe(true)
		expect(r.points[0]).toEqual({ x: 0, y: 32 })
		expect(r.points.at(-1)).toEqual({ x: 0, y: -232 })
		expect(Math.max(...r.points.map((p) => p.x))).toBe(85 + 36)
		expect(r.startDir).toEqual({ x: 0, y: 1 })
		expect(r.endDir).toEqual({ x: 0, y: 1 })
		for (const id of ["A", "B"])
			for (const [a, b] of segments(r)) expect(crossesBox(a, b, nodeById(g, id))).toBe(false)
	})
	it("goes round for a target that is only beside the source", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 300, 20],
			],
			[["A", "B"]],
		)
		const r = route(g).get(g.edges[0].id)
		for (const [a, b] of segments(r)) expect(a.x === b.x || a.y === b.y).toBe(true)
		expect(r.points[0].y).toBe(32)
		expect(r.points.at(-1)).toEqual({ x: 300, y: 20 - 32 })
		expect(r.endDir).toEqual({ x: 0, y: 1 })
	})
	it("sends a self loop out of and back into the right side", () => {
		const g = graphOf([["A", "process", 0, 0]], [["A", "A"]])
		const r = route(g).get(g.edges[0].id)
		expect(r).toMatchObject({ fromSide: "right", toSide: "right" })
		expect(Math.max(...r.points.map((p) => p.x))).toBe(85 + 36)
		for (const [a, b] of segments(r)) expect(a.x === b.x || a.y === b.y).toBe(true)
		expect(r.startDir).toEqual({ x: 1, y: 0 })
		expect(r.endDir).toEqual({ x: -1, y: 0 })
	})
	it("skips an edge whose node is missing", () => {
		const g = graphOf([["A", "process", 0, 0]], [["A", "ghost"]])
		expect(route(g).size).toBe(0)
	})
})

describe("routeAll: back-edges", () => {
	const g = graphOf(
		[
			["T", "process", 0, -150],
			["S", "process", 0, 0],
			["A", "process", 0, 150],
			["B", "process", 0, 300],
		],
		[
			["T", "S"],
			["S", "A"],
			["A", "B"],
			["B", "S", 0],
		],
	)
	const back = g.edges[3]
	it("leaves and enters on the outside (TB: right, LR: bottom)", () => {
		const r = route(g).get(back.id)
		expect(r).toMatchObject({ fromSide: "right", toSide: "right" })
		expect(r.startDir).toEqual({ x: 1, y: 0 })
		expect(r.endDir).toEqual({ x: -1, y: 0 })
		expect(r.points[0]).toEqual({ x: 85, y: 300 })
		expect(r.points.at(-1)).toEqual({ x: 85, y: 0 })
		expect(Math.max(...r.points.map((p) => p.x))).toBe(85 + 36)
	})
	it("clears every node", () => {
		const r = route(g).get(back.id)
		for (const n of g.nodes)
			for (const [a, b] of segments(r)) expect(crossesBox(a, b, n)).toBe(false)
	})
	it("runs beyond the farthest box of the two nodes", () => {
		const wide = graphOf(
			[
				["S", "process", 0, 0],
				["B", "process", 200, 300],
			],
			[
				["S", "B"],
				["B", "S"],
			],
		)
		const r = route(wide).get(wide.edges[1].id)
		expect(Math.max(...r.points.map((p) => p.x))).toBe(285 + 36)
	})
	it("mirrors for a rightward chart", () => {
		const lr = graphOf(
			[
				["T", "process", -250, 0],
				["S", "process", 0, 0],
				["A", "process", 250, 0],
				["B", "process", 500, 0],
			],
			[
				["T", "S"],
				["S", "A"],
				["A", "B"],
				["B", "S", 0],
			],
		)
		const r = route(lr, "LR").get(lr.edges[3].id)
		expect(r).toMatchObject({ fromSide: "bottom", toSide: "bottom" })
		expect(r.startDir).toEqual({ x: 0, y: 1 })
		expect(r.endDir).toEqual({ x: 0, y: -1 })
		expect(Math.max(...r.points.map((p) => p.y))).toBe(32 + 36)
		for (const n of lr.nodes)
			for (const [a, b] of segments(r)) expect(crossesBox(a, b, n)).toBe(false)
	})
	it("a loop in a decision comes back round the right of the chart", () => {
		const loop = graphOf(
			[
				["T", "process", 0, -150],
				["S", "process", 0, 0],
				["D", "decision", 0, 150],
				["E", "process", 0, 330],
			],
			[
				["T", "S"],
				["S", "D"],
				["D", "E", 0],
				["D", "S", 1],
			],
		)
		const r = route(loop).get(loop.edges[3].id)
		expect(r.fromSide).toBe("right")
		expect(r.points[0]).toEqual({ x: 95, y: 150 })
		expect(r.points.at(-1)).toEqual({ x: 85, y: 0 })
		for (const [a, b] of segments(r)) expect(a.x === b.x || a.y === b.y).toBe(true)
	})
})

describe("routeAll: spreading", () => {
	it("moves two edges whose lanes would coincide 10 units apart, in order of id", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 300, 0],
				["C", "process", 500, 200],
				["D", "process", 650, 200],
			],
			[
				["A", "C"],
				["B", "D"],
			],
		)
		const rs = route(g)
		const a = rs.get(g.edges[0].id)
		const b = rs.get(g.edges[1].id)
		const laneA = a.points[1].y
		const laneB = b.points[1].y
		expect(Math.abs(laneA - laneB)).toBeCloseTo(10)
		expect(laneA).toBeLessThan(laneB) // the first edge takes the first lane
		expect((laneA + laneB) / 2).toBeCloseTo(100)
	})
	it("fans three lanes out around the middle", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 300, 0],
				["E", "process", 600, 0],
				["C", "process", 700, 200],
				["D", "process", 900, 200],
				["F", "process", 1100, 200],
			],
			[
				["A", "C"],
				["B", "D"],
				["E", "F"],
			],
		)
		const lanes = g.edges.map((e) => route(g).get(e.id).points[1].y)
		expect(lanes[1] - lanes[0]).toBeCloseTo(10)
		expect(lanes[2] - lanes[1]).toBeCloseTo(10)
		expect(lanes[1]).toBeCloseTo(100)
	})
	it("leaves lanes alone when their extents do not overlap", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 500, 0],
				["C", "process", -100, 200],
				["D", "process", 600, 200],
			],
			[
				["A", "C"],
				["B", "D"],
			],
		)
		const rs = route(g)
		expect(rs.get(g.edges[0].id).points[1].y).toBe(100)
		expect(rs.get(g.edges[1].id).points[1].y).toBe(100)
	})
	it("steps coinciding outer lanes outward", () => {
		const g = graphOf(
			[
				["T", "process", 0, -150],
				["S", "process", 0, 0],
				["A", "process", 0, 150],
				["B", "process", 0, 300],
			],
			[
				["T", "S"],
				["S", "A"],
				["A", "B"],
				["B", "S", 0],
				["B", "A", 1],
			],
		)
		const back = g.edges.filter((e) => e.from === "B")
		const rs = route(g)
		const x = (e) => Math.max(...rs.get(e.id).points.map((p) => p.x))
		expect(Math.abs(x(back[0]) - x(back[1]))).toBeCloseTo(10)
		expect(Math.min(x(back[0]), x(back[1]))).toBeGreaterThanOrEqual(85 + 36)
	})
	it("spreads edges that share a port by portPoint's index and count", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", -300, 200],
				["C", "process", 0, 200],
				["D", "process", 300, 200],
			],
			[
				["A", "D", 2],
				["A", "B", 0],
				["A", "C", 1],
			],
		)
		const rs = route(g)
		const startX = (to) => rs.get(g.edges.find((e) => e.to === to).id).points[0].x
		// the ports follow the position of the targets, left to right
		expect([startX("B"), startX("C"), startX("D")]).toEqual([-14, 0, 14])
		for (const e of g.edges) expect(rs.get(e.id).points[0].y).toBe(32)
	})
	it("spreads the arrivals at one in-port", () => {
		const g = graphOf(
			[
				["A", "process", -300, 0],
				["B", "process", 300, 0],
				["C", "process", 0, 200],
			],
			[
				["A", "C"],
				["B", "C"],
			],
		)
		const rs = route(g)
		expect(rs.get(g.edges[0].id).points.at(-1)).toEqual({ x: -7, y: 168 })
		expect(rs.get(g.edges[1].id).points.at(-1)).toEqual({ x: 7, y: 168 })
		expect(rs.get(g.edges[0].id).endDir).toEqual({ x: 0, y: 1 })
	})
	it("shares a side between an output and an arriving back-edge", () => {
		const g = graphOf(
			[
				["S", "process", 0, 0],
				["D", "decision", 0, 150],
				["E", "process", 0, 300],
				["N", "process", 250, 150],
			],
			[
				["S", "D"],
				["D", "E", 0],
				["D", "N", 1],
				["N", "D", 2],
			],
		)
		// N -> D is a back-edge: it comes into D's right side where D's own second output leaves
		const rs = route(g)
		const ys = [g.edges[2], g.edges[3]].map((e) => rs.get(e.id))
		expect(ys[0].points[0].y).not.toBe(ys[1].points.at(-1).y)
	})
})

describe("routeAll: invariants", () => {
	const cases = [
		["tidy, DAG", randomGraph(100, 41), true],
		["tidy, cycles", randomGraph(100, 42, { back: 20, loops: 4 }), true],
		["scattered, DAG", randomGraph(100, 43, { spread: 1500 }), false],
		["scattered, cycles", randomGraph(100, 44, { back: 20, loops: 4, spread: 1500 }), false],
	]
	for (const direction of ["TB", "LR"]) {
		for (const [name, graph, useTidy] of cases) {
			it(`${name} (${direction}): orthogonal, ports on borders, stubs at both ends`, () => {
				let g = graph
				if (useTidy)
					g = {
						nodes: placed(
							graph.nodes,
							tidyLayout(chartOf(direction), graph.nodes, graph.edges, measure),
						),
						edges: graph.edges,
					}
				const rs = route(g, direction)
				expect(rs.size).toBe(g.edges.length)
				for (const e of g.edges) {
					const r = rs.get(e.id)
					expect(r.points.length).toBeGreaterThanOrEqual(2)
					for (const [a, b] of segments(r))
						expect(close(a.x, b.x) || close(a.y, b.y)).toBe(true)
					for (const [a, b] of segments(r))
						expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(0)
					expect(onBorder(nodeById(g, e.from), r.points[0])).toBe(true)
					expect(onBorder(nodeById(g, e.to), r.points.at(-1))).toBe(true)
					const [p0, p1] = r.points
					const out = { x: Math.sign(p1.x - p0.x), y: Math.sign(p1.y - p0.y) }
					expect(out).toEqual(r.startDir)
					expect(Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y)).toBeGreaterThanOrEqual(
						STUB - 1e-6,
					)
					const n = r.points.length
					const q0 = r.points[n - 2]
					const q1 = r.points[n - 1]
					expect({ x: Math.sign(q1.x - q0.x), y: Math.sign(q1.y - q0.y) }).toEqual(
						r.endDir,
					)
					expect(Math.abs(q1.x - q0.x) + Math.abs(q1.y - q0.y)).toBeGreaterThanOrEqual(
						STUB - 1e-6,
					)
				}
			})
		}
	}
	it("never turns back on itself", () => {
		const g = randomGraph(120, 45, { back: 30, loops: 5, spread: 1200 })
		for (const direction of ["TB", "LR"]) {
			for (const r of route(g, direction).values()) {
				for (let i = 2; i < r.points.length; i++) {
					const a = {
						x: r.points[i - 1].x - r.points[i - 2].x,
						y: r.points[i - 1].y - r.points[i - 2].y,
					}
					const b = {
						x: r.points[i].x - r.points[i - 1].x,
						y: r.points[i].y - r.points[i - 1].y,
					}
					expect(a.x * b.x + a.y * b.y).toBeGreaterThanOrEqual(0)
				}
			}
		}
	})
	it("never runs through the nodes it connects when the chart is tidy and the edges are forward", () => {
		const base = randomGraph(80, 46)
		const nodes = placed(base.nodes, tidyLayout(chartOf(), base.nodes, base.edges, measure))
		const rs = routeAll(chartOf(), nodes, base.edges, measure)
		for (const e of base.edges) {
			const ends = [nodes.find((n) => n.id === e.from), nodes.find((n) => n.id === e.to)]
			// the first and last pieces are stubs that start on the border (a diamond's corners
			// are inside its box), so only the pieces in between are checked
			const middle = segments(rs.get(e.id)).slice(1, -1)
			for (const n of ends)
				for (const [a, b] of middle) expect(crossesBox(a, b, n, 2)).toBe(false)
		}
	})
	it("does not change its input", () => {
		const g = randomGraph(40, 47, { back: 5 })
		const copy = structuredClone(g)
		route(g)
		expect(g).toEqual(copy)
	})
	it("is deterministic whatever the order of the records", () => {
		const g = randomGraph(60, 48, { back: 8, spread: 900 })
		const a = route(g)
		const b = routeAll(chartOf(), [...g.nodes].reverse(), [...g.edges].reverse(), measure)
		for (const [id, r] of a) expect(b.get(id)).toEqual(r)
	})
	it("routes 500 nodes in under 300 ms", () => {
		const base = randomGraph(500, 49, { back: 25, extra: 0.4 })
		const nodes = placed(base.nodes, tidyLayout(chartOf(), base.nodes, base.edges, measure))
		const t0 = performance.now()
		const rs = routeAll(chartOf(), nodes, base.edges, measure)
		const ms = performance.now() - t0
		expect(rs.size).toBe(base.edges.length)
		expect(ms).toBeLessThan(300)
	})
})

describe("routeAll: LR is the mirror of TB", () => {
	// Junctions are square, so a transposed graph has exactly the same geometry.
	const ids = Array.from({ length: 14 }, (_, i) => `j${String(i).padStart(2, "0")}`)
	const at = (i) => [(i * 137) % 700, (i * 211) % 600]
	const tb = {
		nodes: ids.map((id, i) => flowNode(id, "junction", ...at(i))),
		edges: [],
	}
	const add = (from, to, order = 0) => tb.edges.push(flowEdge(ids[from], ids[to], order))
	add(0, 1)
	add(0, 2, 1)
	add(1, 3)
	add(2, 3)
	add(3, 4)
	add(4, 0)
	add(5, 6)
	add(6, 6)
	add(7, 8)
	add(8, 9)
	add(7, 9, 1)
	add(10, 11)
	add(11, 12)
	add(12, 10)
	add(13, 3)
	const lr = {
		nodes: tb.nodes.map((n) => ({ ...n, x: n.y, y: n.x })),
		edges: tb.edges,
	}
	it("gives the transposed points, mirrored sides and directions", () => {
		const a = route(tb, "TB")
		const b = route(lr, "LR")
		const flip = { top: "left", left: "top", right: "bottom", bottom: "right" }
		for (const e of tb.edges) {
			const r = a.get(e.id)
			const m = b.get(e.id)
			expect(m.points).toEqual(r.points.map((p) => ({ x: p.y, y: p.x })))
			expect(m.fromSide).toBe(flip[r.fromSide])
			expect(m.toSide).toBe(flip[r.toSide])
			expect(m.startDir).toEqual({ x: r.startDir.y, y: r.startDir.x })
			expect(m.endDir).toEqual({ x: r.endDir.y, y: r.endDir.x })
			expect(m.label).toEqual({ x: r.label.y, y: r.label.x })
		}
	})
	it("keeps the same shape for mixed nodes", () => {
		const g = randomGraph(60, 50, { back: 8, loops: 2 })
		const lrNodes = placed(g.nodes, tidyLayout(chartOf("LR"), g.nodes, g.edges, measure))
		const tbNodes = placed(g.nodes, tidyLayout(chartOf("TB"), g.nodes, g.edges, measure))
		const a = routeAll(chartOf("TB"), tbNodes, g.edges, measure)
		const b = routeAll(chartOf("LR"), lrNodes, g.edges, measure)
		const flip = { top: "left", left: "top", right: "bottom", bottom: "right" }
		for (const e of g.edges) {
			expect(b.get(e.id).fromSide).toBe(flip[a.get(e.id).fromSide])
			expect(b.get(e.id).toSide).toBe(flip[a.get(e.id).toSide])
		}
	})
})

describe("labels and helpers", () => {
	it("puts the label on the route, in the middle of the longest segment", () => {
		const g = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 200, 400],
			],
			[["A", "B"]],
		)
		const r = route(g).get(g.edges[0].id)
		// segments: 168 down, 200 across, 168 down
		expect(r.label).toEqual({ x: 100, y: 200 })
		const straight = graphOf(
			[
				["A", "process", 0, 0],
				["B", "process", 0, 200],
			],
			[["A", "B"]],
		)
		expect(route(straight).get(straight.edges[0].id).label).toEqual({ x: 0, y: 100 })
	})
	it("keeps every label on its route and at least half a stub from the ends", () => {
		const g = randomGraph(100, 51, { back: 15, loops: 3, spread: 1200 })
		for (const direction of ["TB", "LR"]) {
			const rs = route(g, direction)
			for (const e of g.edges) {
				const r = rs.get(e.id)
				expect(distanceToRoute(r, r.label)).toBeLessThan(1e-6)
				const ends = [r.points[0], r.points.at(-1)]
				for (const p of ends)
					expect(Math.hypot(p.x - r.label.x, p.y - r.label.y)).toBeGreaterThanOrEqual(
						STUB / 2 - 1e-6,
					)
			}
		}
	})
	const sample = {
		points: [
			{ x: 0, y: 0 },
			{ x: 0, y: 100 },
			{ x: 200, y: 100 },
			{ x: 200, y: 300 },
		],
	}
	it("computes the bounds of a route", () => {
		expect(routeBounds(sample)).toEqual({ x: 0, y: 0, w: 200, h: 300 })
	})
	it("measures the distance to the nearest segment", () => {
		expect(distanceToRoute(sample, { x: 0, y: 50 })).toBe(0)
		expect(distanceToRoute(sample, { x: 10, y: 50 })).toBe(10)
		expect(distanceToRoute(sample, { x: 100, y: 130 })).toBe(30)
		expect(distanceToRoute(sample, { x: -3, y: -4 })).toBe(5) // beyond the first end
		expect(distanceToRoute(sample, { x: 200, y: 340 })).toBe(40)
	})
	it("hits within the tolerance only", () => {
		expect(hitRoute(sample, { x: 100, y: 106 }, 6)).toBe(true)
		expect(hitRoute(sample, { x: 100, y: 107 }, 6)).toBe(false)
		expect(hitRoute(sample, { x: 100, y: 106 })).toBe(true) // default tolerance
		expect(hitRoute(sample, { x: 100, y: 200 }, 6)).toBe(false)
	})
	it("finds the point at half the length", () => {
		expect(length(sample)).toBe(500)
		expect(routeMid(sample)).toEqual({ x: 150, y: 100 })
		expect(
			routeMid({
				points: [
					{ x: 0, y: 0 },
					{ x: 0, y: 80 },
				],
			}),
		).toEqual({ x: 0, y: 40 })
		const g = randomGraph(30, 52, { spread: 800 })
		for (const r of route(g).values()) {
			const m = routeMid(r)
			expect(distanceToRoute(r, m)).toBeLessThan(1e-6)
		}
	})
})

describe("routeAll: a decision's side exit that is blocked", () => {
	// D at the top with a step X on its row to the right, and its second output T below X.
	const blocked = () =>
		graphOf(
			[
				["D", "decision", 0, 0],
				["Y", "process", 0, 220],
				["X", "process", 300, 0],
				["T", "process", 300, 220],
			],
			[
				["D", "Y", 0],
				["D", "T", 1],
			],
		)

	it("leaves by the bottom, like the first output, instead of running through the step", () => {
		const g = blocked()
		const routes = route(g)
		const toT = g.edges.find((e) => e.to === "T")
		expect(routes.get(toT.id).fromSide).toBe("bottom")
		// and no route crosses the step in the way
		const x = nodeById(g, "X")
		const box = { x: x.x - 85, y: x.y - 32, w: 170, h: 64 }
		for (const point of routes.get(toT.id).points)
			expect(
				point.x > box.x &&
					point.x < box.x + box.w &&
					point.y > box.y &&
					point.y < box.y + box.h,
			).toBe(false)
	})

	it("still leaves by the side when nothing is in the way", () => {
		const g = blocked()
		g.nodes = g.nodes.filter((n) => n.id !== "X")
		const routes = route(g)
		const toT = g.edges.find((e) => e.to === "T")
		expect(routes.get(toT.id).fromSide).toBe("right")
	})
})
