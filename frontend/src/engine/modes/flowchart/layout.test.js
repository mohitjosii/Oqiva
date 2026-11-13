import { describe, expect, it } from "vitest"
import {
	backEdgeIds,
	chartBounds,
	placeAt,
	placeChild,
	positionBelow,
	shiftDownstream,
	tidyLayout,
} from "./layout"
import { GAPS, nodeSize } from "./model"
import {
	boxes,
	chartOf,
	firstOverlap,
	flowEdge,
	flowNode,
	graphOf,
	measure,
	overlaps,
	placed,
	randomGraph,
	seeded,
} from "./layoutTestUtils"

const tidy = (g, direction = "TB") => tidyLayout(chartOf(direction), g.nodes, g.edges, measure)
const forwardOf = (g, direction) => (direction === "LR" ? "x" : "y")

describe("backEdgeIds", () => {
	it("finds nothing in a DAG, even with joins and skipped levels", () => {
		const g = graphOf(
			["A", "B", "C", "D"],
			[
				["A", "B"],
				["A", "C"],
				["B", "D"],
				["C", "D"],
				["A", "D"],
			],
		)
		expect(backEdgeIds(chartOf(), g.nodes, g.edges).size).toBe(0)
	})
	it("marks the edge that closes a cycle", () => {
		const g = graphOf(
			["A", "B", "C"],
			[
				["A", "B"],
				["B", "C"],
				["C", "A"],
			],
		)
		// A has an incoming edge too, so the search starts at the first id: the closing edge is C -> A.
		const back = backEdgeIds(chartOf(), g.nodes, g.edges)
		expect([...back]).toEqual([g.edges[2].id])
	})
	it("starts at the sources, so a loop below a source points back", () => {
		const g = graphOf(
			["S", "A", "B"],
			[
				["S", "A"],
				["A", "B"],
				["B", "A"],
			],
		)
		expect([...backEdgeIds(chartOf(), g.nodes, g.edges)]).toEqual([g.edges[2].id])
	})
	it("treats a self reference as a back-edge", () => {
		const g = graphOf(["A"], [["A", "A"]])
		expect(backEdgeIds(chartOf(), g.nodes, g.edges).size).toBe(1)
	})
	it("ignores edges to missing nodes and handles an empty chart", () => {
		const g = graphOf(["A"], [["A", "ghost"]])
		expect(backEdgeIds(chartOf(), g.nodes, g.edges).size).toBe(0)
		expect(backEdgeIds(chartOf(), [], []).size).toBe(0)
	})
	it("is the same whatever the order of the records", () => {
		const g = randomGraph(80, 5, { back: 12, loops: 3 })
		const a = backEdgeIds(chartOf(), g.nodes, g.edges)
		const b = backEdgeIds(chartOf(), [...g.nodes].reverse(), [...g.edges].reverse())
		expect([...a].sort()).toEqual([...b].sort())
	})
})

describe("tidyLayout ranks", () => {
	for (const direction of ["TB", "LR"]) {
		it(`follows the flow for a chain (${direction})`, () => {
			const g = graphOf(
				["A", "B", "C"],
				[
					["A", "B"],
					["B", "C"],
				],
			)
			const out = tidy(g, direction)
			const along = forwardOf(g, direction)
			const across = along === "x" ? "y" : "x"
			expect(out.get("B")[along]).toBeGreaterThan(out.get("A")[along])
			expect(out.get("C")[along]).toBeGreaterThan(out.get("B")[along])
			expect(out.get("A")[across]).toBeCloseTo(out.get("B")[across])
			expect(out.get("B")[across]).toBeCloseTo(out.get("C")[across])
		})
	}
	it("keeps GAPS.along between ranks, measured from the biggest node of each", () => {
		const g = graphOf(
			["A", ["B", "decision"], "C"],
			[
				["A", "B"],
				["B", "C"],
			],
		)
		const out = tidy(g)
		expect(out.get("B").y - out.get("A").y).toBeCloseTo(32 + GAPS.along + 60)
		expect(out.get("C").y - out.get("B").y).toBeCloseTo(60 + GAPS.along + 32)
		const lr = tidy(g, "LR")
		expect(lr.get("B").x - lr.get("A").x).toBeCloseTo(85 + GAPS.along + 95)
	})
	it("uses the longest path, so a join sits below its deepest parent", () => {
		const g = graphOf(
			["A", "B", "C", "J"],
			[
				["A", "B"],
				["B", "C"],
				["A", "J"],
				["C", "J"],
			],
		)
		const out = tidy(g)
		expect(out.get("J").y).toBeGreaterThan(out.get("C").y)
	})
	for (const direction of ["TB", "LR"]) {
		it(`150 random nodes: every forward edge goes forward and nothing overlaps (${direction})`, () => {
			for (const seed of [1, 2, 3]) {
				const g = randomGraph(150, seed)
				const out = tidy(g, direction)
				expect(out.size).toBe(150)
				const along = forwardOf(g, direction)
				for (const e of g.edges)
					expect(out.get(e.to)[along]).toBeGreaterThan(out.get(e.from)[along])
				expect(firstOverlap(placed(g.nodes, out))).toBeNull()
			}
		})
	}
	it("terminates with cycles and self loops, and forward edges still go forward", () => {
		for (const direction of ["TB", "LR"]) {
			for (const seed of [11, 12, 13, 14]) {
				const g = randomGraph(120, seed, { back: 25, loops: 6 })
				const out = tidy(g, direction)
				const back = backEdgeIds(chartOf(direction), g.nodes, g.edges)
				expect(back.size).toBeGreaterThan(0)
				const along = forwardOf(g, direction)
				for (const e of g.edges) {
					if (back.has(e.id)) continue
					expect(out.get(e.to)[along]).toBeGreaterThan(out.get(e.from)[along])
				}
				expect(firstOverlap(placed(g.nodes, out))).toBeNull()
			}
		}
	})
	it("lays out a pure cycle, a single node and no nodes", () => {
		const cycle = graphOf(
			["A", "B", "C"],
			[
				["A", "B"],
				["B", "C"],
				["C", "A"],
			],
		)
		const out = tidy(cycle)
		expect(out.get("A").y).toBeLessThan(out.get("B").y)
		expect(out.get("B").y).toBeLessThan(out.get("C").y)
		expect(tidy(graphOf(["A"], [])).get("A")).toEqual({ x: 0, y: 0 })
		expect(tidy({ nodes: [], edges: [] }).size).toBe(0)
	})
	it("ignores edges to nodes that are not there", () => {
		const g = graphOf(
			["A", "B"],
			[
				["A", "B"],
				["A", "ghost"],
				["ghost", "B"],
			],
		)
		expect(tidy(g).size).toBe(2)
	})
})

describe("tidyLayout components", () => {
	for (const direction of ["TB", "LR"]) {
		it(`puts disconnected components side by side across the flow (${direction})`, () => {
			const g = graphOf(
				["A", "B", "C", "D", "E", "F"],
				[
					["A", "B"],
					["A", "C"],
					["D", "E"],
				],
			)
			const out = tidy(g, direction)
			expect(firstOverlap(placed(g.nodes, out))).toBeNull()
			const across = direction === "LR" ? "y" : "x"
			const size = (id) =>
				nodeSize(
					g.nodes.find((n) => n.id === id),
					measure,
				)
			const half = (id) => (direction === "LR" ? size(id).h : size(id).w) / 2
			const extent = (ids) => [
				Math.min(...ids.map((id) => out.get(id)[across] - half(id))),
				Math.max(...ids.map((id) => out.get(id)[across] + half(id))),
			]
			const one = extent(["A", "B", "C"])
			const two = extent(["D", "E"])
			const three = extent(["F"])
			expect(two[0]).toBeGreaterThanOrEqual(one[1] + GAPS.across)
			expect(three[0]).toBeGreaterThanOrEqual(two[1] + GAPS.across)
			// every component starts at the first rank
			const along = direction === "LR" ? "x" : "y"
			expect(out.get("D")[along]).toBeCloseTo(out.get("A")[along])
		})
	}
	it("keeps random disconnected graphs apart", () => {
		const a = randomGraph(40, 21)
		const b = randomGraph(40, 22)
		const rename = (g, p) => ({
			nodes: g.nodes.map((n) => ({ ...n, id: p + n.id })),
			edges: g.edges.map((e) => ({ ...e, id: p + e.id, from: p + e.from, to: p + e.to })),
		})
		const x = rename(a, "a")
		const y = rename(b, "b")
		const g = { nodes: [...x.nodes, ...y.nodes], edges: [...x.edges, ...y.edges] }
		expect(firstOverlap(placed(g.nodes, tidy(g)))).toBeNull()
	})
})

describe("tidyLayout shape", () => {
	it("centres a parent over its children", () => {
		const g = graphOf(
			["A", "B", "C"],
			[
				["A", "B"],
				["A", "C", 1],
			],
		)
		const out = tidy(g)
		expect(out.get("A").x).toBeCloseTo((out.get("B").x + out.get("C").x) / 2)
		expect(out.get("B").x).toBeLessThan(out.get("C").x)
		expect(out.get("C").x - out.get("B").x).toBeCloseTo(170 + GAPS.across)
	})
	it("orders siblings by edge.order, not by id", () => {
		const g = graphOf(
			["A", "B", "C"],
			[
				["A", "C", 0],
				["A", "B", 1],
			],
		)
		const out = tidy(g)
		expect(out.get("C").x).toBeLessThan(out.get("B").x)
	})
	it("reduces crossings: a crossed pair is untangled", () => {
		const g = graphOf(
			["A1", "A2", "B1", "B2"],
			[
				["A1", "B2"],
				["A2", "B1"],
			],
		)
		const out = tidy(g)
		expect(out.get("B2").x < out.get("B1").x).toBe(out.get("A1").x < out.get("A2").x)
	})
	for (const direction of ["TB", "LR"]) {
		const across = direction === "LR" ? "y" : "x"
		const along = direction === "LR" ? "x" : "y"
		it(`sends a decision's first output straight on and balances the others (${direction})`, () => {
			const two = graphOf(
				["S", ["D", "decision"], "Y", "N"],
				[
					["S", "D"],
					["D", "Y", 0],
					["D", "N", 1],
				],
			)
			let out = tidy(two, direction)
			expect(out.get("Y")[across]).toBeCloseTo(out.get("D")[across])
			expect(out.get("S")[across]).toBeCloseTo(out.get("D")[across])
			expect(out.get("N")[across]).toBeGreaterThan(out.get("D")[across])
			expect(out.get("N")[along]).toBeCloseTo(out.get("Y")[along])

			const three = graphOf(
				["S", ["D", "decision"], "O1", "O2", "O3"],
				[
					["S", "D"],
					["D", "O1", 0],
					["D", "O2", 1],
					["D", "O3", 2],
				],
			)
			out = tidy(three, direction)
			expect(out.get("O1")[across]).toBeCloseTo(out.get("D")[across])
			expect(out.get("O2")[across]).toBeGreaterThan(out.get("D")[across])
			expect(out.get("O3")[across]).toBeLessThan(out.get("D")[across])
			expect(firstOverlap(placed(three.nodes, out))).toBeNull()
		})
	}
	it("keeps a decision's slots with five outputs", () => {
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
		const out = tidy(g)
		const xs = ["e", "c", "a", "b", "d"].map((id) => out.get(id).x)
		expect(xs).toEqual([...xs].sort((p, q) => p - q))
		expect(out.get("a").x).toBeCloseTo(out.get("D").x)
	})
	it("lays out a flowchart with a loop back and a join", () => {
		const g = graphOf(
			[["S", "terminator"], "P", ["D", "decision"], "Q", ["E", "terminator"]],
			[
				["S", "P"],
				["P", "D"],
				["D", "Q", 0],
				["D", "P", 1], // back to P
				["Q", "E"],
			],
		)
		const out = tidy(g)
		expect(out.get("P").y).toBeGreaterThan(out.get("S").y)
		expect(out.get("D").y).toBeGreaterThan(out.get("P").y)
		expect(out.get("Q").x).toBeCloseTo(out.get("D").x)
		expect(firstOverlap(placed(g.nodes, out))).toBeNull()
	})
})

describe("tidyLayout position and purity", () => {
	it("keeps the top-left of the bounding box where it was", () => {
		const rand = seeded(7)
		const g = randomGraph(60, 4, { spread: 3000 })
		const before = chartBounds(chartOf(), g.nodes, measure)
		const out = tidy(g)
		const after = chartBounds(chartOf(), placed(g.nodes, out), measure)
		expect(after.x).toBeCloseTo(before.x, 1)
		expect(after.y).toBeCloseTo(before.y, 1)
		expect(rand()).toBeGreaterThan(0)
	})
	it("lays out a chart whose nodes all sit at the same spot, from that spot", () => {
		const g = graphOf(
			[
				["A", "process", 400, 300],
				["B", "process", 400, 300],
				["C", "process", 400, 300],
			],
			[
				["A", "B"],
				["A", "C", 1],
			],
		)
		const before = chartBounds(chartOf(), g.nodes, measure)
		const after = chartBounds(chartOf(), placed(g.nodes, tidy(g)), measure)
		expect(after.x).toBeCloseTo(before.x, 1)
		expect(after.y).toBeCloseTo(before.y, 1)
		expect(after.w).toBeGreaterThan(before.w)
	})
	it("does the same for a rightward chart", () => {
		const g = randomGraph(30, 8, { spread: 800 })
		const before = chartBounds(chartOf("LR"), g.nodes, measure)
		const after = chartBounds(chartOf("LR"), placed(g.nodes, tidy(g, "LR")), measure)
		expect(after.x).toBeCloseTo(before.x, 1)
		expect(after.y).toBeCloseTo(before.y, 1)
	})
	it("is deterministic, also when the records come in another order", () => {
		const g = randomGraph(100, 9, { back: 8, loops: 2 })
		const a = tidy(g)
		const b = tidy(g)
		const c = tidy({ nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() })
		for (const [id, p] of a) {
			expect(b.get(id)).toEqual(p)
			expect(c.get(id)).toEqual(p)
		}
	})
	it("does not change its input", () => {
		const g = randomGraph(50, 10, { back: 5 })
		const copy = structuredClone(g)
		tidy(g)
		expect(g).toEqual(copy)
	})
	it("lays out 500 nodes in under 400 ms", () => {
		const g = randomGraph(500, 12, { back: 20, extra: 0.4 })
		const t0 = performance.now()
		const out = tidy(g)
		const ms = performance.now() - t0
		expect(out.size).toBe(500)
		expect(ms).toBeLessThan(400)
	})
})

describe("placeChild", () => {
	const spots = {
		terminator: { w: 160, h: 56 },
		process: { w: 170, h: 64 },
		decision: { w: 190, h: 120 },
		io: { w: 180, h: 64 },
		junction: { w: 24, h: 24 },
	}
	const parent = flowNode("P", "process", 100, 50)
	for (const [type, size] of Object.entries(spots)) {
		it(`puts a ${type} one rank down in the parent's column (TB)`, () => {
			const at = placeChild(chartOf(), [parent], [], "P", type, measure)
			expect(at.x).toBe(100)
			expect(at.y).toBeCloseTo(50 + 32 + GAPS.along + size.h / 2)
		})
		it(`puts a ${type} one rank to the right in the parent's row (LR)`, () => {
			const at = placeChild(chartOf("LR"), [parent], [], "P", type, measure)
			expect(at.y).toBe(50)
			expect(at.x).toBeCloseTo(100 + 85 + GAPS.along + size.w / 2)
		})
	}
	it("uses the parent's own size", () => {
		const big = flowNode("D", "decision", 0, 0)
		const at = placeChild(chartOf(), [big], [], "D", "process", measure)
		expect(at).toEqual({ x: 0, y: 60 + GAPS.along + 32 })
	})
	it("grows with the new node's text", () => {
		// the default text of every type is short, so only the base size shows
		expect(placeChild(chartOf(), [parent], [], "P", "io", measure).y).toBeCloseTo(
			50 + 32 + 70 + 32,
		)
	})
	describe("a decision's outputs", () => {
		const d = flowNode("D", "decision", 0, 0)
		const target = (id, x) => flowNode(id, "process", x, 190)
		it("puts the first output straight on", () => {
			expect(placeChild(chartOf(), [d], [], "D", "process", measure)).toEqual({
				x: 0,
				y: 162,
			})
		})
		it("alternates right, left, further right by width plus GAPS.across", () => {
			const step = 170 + GAPS.across
			const at = (branch) =>
				placeChild(chartOf(), [d], [], "D", "process", measure, { branch })
			expect(at(0).x).toBe(0)
			expect(at(1).x).toBe(step)
			expect(at(2).x).toBe(-step)
			expect(at(3).x).toBe(2 * step)
			expect(at(4).x).toBe(-2 * step)
			expect(at(1).y).toBe(at(0).y)
		})
		it("counts the existing outputs when no branch is given", () => {
			const nodes = [d, target("a", 0), target("b", 230)]
			const edges = [flowEdge("D", "a", 0), flowEdge("D", "b", 1)]
			const at = placeChild(chartOf(), nodes, edges, "D", "process", measure)
			expect(at.x).toBe(-230)
		})
		it("does not count a back-edge as an output", () => {
			const nodes = [
				flowNode("T", "process", 0, -300),
				flowNode("S", "process", 0, -150),
				d,
				flowNode("a", "process", 0, 190),
			]
			const edges = [
				flowEdge("T", "S"),
				flowEdge("S", "D"),
				flowEdge("D", "a", 0),
				flowEdge("D", "S", 1),
			]
			const at = placeChild(chartOf(), nodes, edges, "D", "process", measure)
			expect(at.x).toBe(230)
		})
		it("mirrors for a rightward chart: outputs go down, then up", () => {
			const at = (branch) =>
				placeChild(chartOf("LR"), [d], [], "D", "process", measure, { branch })
			expect(at(0).y).toBe(0)
			expect(at(1).y).toBeGreaterThan(0)
			expect(at(2).y).toBeLessThan(0)
			expect(at(1).x).toBe(at(0).x)
			expect(at(1).y).toBe(64 + GAPS.across)
		})
		it("ignores `branch` for other types of parent", () => {
			const at = placeChild(chartOf(), [parent], [], "P", "process", measure, { branch: 3 })
			expect(at.x).toBe(100)
		})
	})
	describe("collisions", () => {
		it("shifts across the flow in whole steps until the spot is free", () => {
			const blocker = flowNode("X", "process", 0, 134)
			const p = flowNode("P", "process", 0, 0)
			const at = placeChild(chartOf(), [p, blocker], [], "P", "process", measure)
			expect(at.y).toBe(134)
			expect(at.x).toBe(230) // the right side first
		})
		it("tries the same side first, then alternates", () => {
			const d = flowNode("D", "decision", 0, 0)
			const y = 60 + 70 + 32
			const right = flowNode("R", "process", 230, y)
			expect(
				placeChild(chartOf(), [d, right], [], "D", "process", measure, { branch: 1 }).x,
			).toBe(460)
			const both = [d, right, flowNode("R2", "process", 460, y)]
			expect(placeChild(chartOf(), both, [], "D", "process", measure, { branch: 1 }).x).toBe(
				0, // the other side is free
			)
			const left = flowNode("L", "process", -230, y)
			expect(
				placeChild(chartOf(), [d, left], [], "D", "process", measure, { branch: 2 }).x,
			).toBe(-460)
		})
		it("works through a wall on both sides when the first is taken by a wall of nodes", () => {
			const p = flowNode("P", "process", 0, 0)
			const wall = [0, 230, -230, 460, -460].map((x, i) =>
				flowNode(`w${i}`, "process", x, 134),
			)
			const at = placeChild(chartOf(), [p, ...wall], [], "P", "process", measure)
			expect(at.x).toBe(690)
		})
		it("works in a rightward chart", () => {
			const p = flowNode("P", "process", 0, 0)
			const blocker = flowNode("X", "process", 85 + 70 + 85, 0)
			const at = placeChild(chartOf("LR"), [p, blocker], [], "P", "process", measure)
			expect(at.x).toBe(240)
			expect(at.y).toBe(64 + GAPS.across)
		})
		it("never lands on another node in a crowded chart", () => {
			const g = randomGraph(60, 3, { spread: 900 })
			for (const n of g.nodes.slice(0, 20)) {
				const at = placeChild(chartOf(), g.nodes, g.edges, n.id, "process", measure)
				const added = flowNode("new", "process", at.x, at.y)
				const added2 = boxes([added]).get("new")
				for (const [id, box] of boxes(g.nodes)) {
					if (id !== n.id) expect(overlaps(added2, box)).toBe(false)
				}
			}
		})
	})
	it("falls back to the origin for an unknown parent", () => {
		expect(placeChild(chartOf(), [], [], "nope", "process", measure)).toEqual({ x: 0, y: 0 })
	})
})

describe("placeAt", () => {
	it("returns the rounded point when the spot is free", () => {
		const nodes = [flowNode("A", "process", 0, 0)]
		expect(placeAt(nodes, { x: 500.4, y: 300.6 }, "process", measure)).toEqual({
			x: 500,
			y: 301,
		})
		expect(placeAt([], { x: 1.5, y: -2.5 }, "decision", measure)).toEqual({ x: 2, y: -2 })
	})
	it("moves clear of anything it would overlap", () => {
		const nodes = [flowNode("A", "process", 0, 0), flowNode("B", "process", 0, 80)]
		const at = placeAt(nodes, { x: 10, y: 10 }, "process", measure)
		const added = flowNode("N", "process", at.x, at.y)
		expect(firstOverlap([added, ...nodes])).toBeNull()
		expect(at.x).toBe(10)
		expect(at.y).toBeGreaterThan(10)
	})
	it("clears a stack of nodes in one go", () => {
		const nodes = Array.from({ length: 6 }, (_, i) => flowNode(`n${i}`, "process", 0, i * 70))
		const at = placeAt(nodes, { x: 0, y: 100 }, "decision", measure)
		expect(firstOverlap([flowNode("N", "decision", at.x, at.y), ...nodes])).toBeNull()
	})
})

describe("shiftDownstream", () => {
	const g = graphOf(
		[
			["A", "process", 0, 0],
			["B", "process", 0, 134],
			["C", "process", 0, 268],
			["D", "process", 230, 268],
			["E", "process", 500, 0],
		],
		[
			["A", "B"],
			["B", "C"],
			["B", "D"],
			["C", "B"], // a loop
		],
	)
	it("moves exactly what is reachable, the start included", () => {
		const patches = shiftDownstream(chartOf(), g.nodes, g.edges, ["B"], 50)
		expect(patches.map((p) => p.id).sort()).toEqual(["B", "C", "D"])
		expect(patches.find((p) => p.id === "B").patch).toEqual({ x: 0, y: 184 })
		expect(patches.find((p) => p.id === "D").patch).toEqual({ x: 230, y: 318 })
	})
	it("does not follow a back-edge up the chart", () => {
		const patches = shiftDownstream(chartOf(), g.nodes, g.edges, ["C"], 10)
		expect(patches.map((p) => p.id)).toEqual(["C"])
	})
	it("moves along x in a rightward chart", () => {
		const patches = shiftDownstream(chartOf("LR"), g.nodes, g.edges, ["B"], 50)
		expect(patches.find((p) => p.id === "B").patch).toEqual({ x: 50, y: 134 })
	})
	it("accepts several start nodes, unknown ids and a self loop", () => {
		const loop = [...g.edges, flowEdge("E", "E")]
		const patches = shiftDownstream(chartOf(), g.nodes, loop, ["E", "C", "ghost"], 5)
		expect(patches.map((p) => p.id).sort()).toEqual(["C", "E"])
		expect(shiftDownstream(chartOf(), g.nodes, g.edges, [], 5)).toEqual([])
	})
	it("terminates on a graph full of cycles", () => {
		const r = randomGraph(80, 31, { back: 30, loops: 5 })
		const patches = shiftDownstream(chartOf(), r.nodes, r.edges, [r.nodes[0].id], 20)
		expect(patches.length).toBeLessThanOrEqual(80)
		expect(patches[0].patch.y).toBe(r.nodes[0].y + 20)
	})
})

describe("chartBounds and positionBelow", () => {
	it("is the union of the node boxes", () => {
		const nodes = [flowNode("A", "process", 0, 0), flowNode("B", "decision", 300, 200)]
		expect(chartBounds(chartOf(), nodes, measure)).toEqual({
			x: -85,
			y: -32,
			w: 85 + 395,
			h: 260 + 32,
		})
	})
	it("is null without nodes", () => {
		expect(chartBounds(chartOf(), [], measure)).toBeNull()
	})
	it("places a new chart below, left edges aligned, with the gap", () => {
		const bounds = { x: 100, y: 50, w: 400, h: 300 }
		const at = positionBelow(bounds, { w: 160, h: 56 })
		expect(at).toEqual({ x: 180, y: 50 + 300 + 80 + 28 })
		expect(positionBelow(bounds, { w: 160, h: 56 }, 20).y).toBe(50 + 300 + 20 + 28)
		expect(positionBelow(bounds).x).toBe(180)
	})
	it("starts at the origin on an empty canvas", () => {
		expect(positionBelow(null, { w: 160, h: 56 })).toEqual({ x: 0, y: 0 })
	})
})
