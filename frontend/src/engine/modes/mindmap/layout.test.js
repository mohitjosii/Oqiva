import { describe, expect, it } from "vitest"
import { LAYOUT_DEFAULTS, layoutMap, subtreeBounds, visibleIds } from "./layout"
import { build, mapOf, measure, randomTree } from "./testUtils"

const H = 16 * 1.35 + 16 // one line of body text: 37.6
const run = (nodes, layout = "right", options = {}, origin = { x: 0, y: 0 }) =>
	layoutMap(mapOf(nodes, layout, origin), nodes, measure, options)
const mid = (b) => b.y + b.h / 2
const right = (b) => b.x + b.w
const collapse = (nodes, ...ids) =>
	nodes.map((n) => (ids.includes(n.id) ? { ...n, collapsed: true } : n))

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
function expectNoOverlap(boxes) {
	const list = [...boxes.entries()]
	for (let i = 0; i < list.length; i++)
		for (let j = i + 1; j < list.length; j++)
			if (overlaps(list[i][1], list[j][1]))
				throw new Error(`${list[i][0]} overlaps ${list[j][0]}`)
}

describe("the root", () => {
	it("is centred exactly on the origin", () => {
		const nodes = build(["R", ["A"], ["B"]])
		const { boxes } = run(nodes, "both", {}, { x: 300, y: -120 })
		const r = boxes.get("R")
		expect(r.x + r.w / 2).toBeCloseTo(300)
		expect(mid(r)).toBeCloseTo(-120)
		expect(r).toMatchObject({ side: "root", depth: 0 })
	})
	it("uses the root font size and its text width", () => {
		const nodes = build(["R"]).map((n) => ({ ...n, text: "Central idea" }))
		const { boxes, bounds } = run(nodes)
		expect(boxes.get("R").w).toBeCloseTo(12 * 20 * 0.5 + 28)
		expect(boxes.get("R").h).toBeCloseTo(20 * 1.35 + 16)
		expect(bounds).toEqual({
			x: boxes.get("R").x,
			y: boxes.get("R").y,
			w: boxes.get("R").w,
			h: boxes.get("R").h,
		})
	})
	it("returns empty boxes when the root is missing", () => {
		const out = layoutMap({ rootId: "x", origin: { x: 1, y: 2 }, layout: "both" }, [], measure)
		expect(out.boxes.size).toBe(0)
		expect(out.bounds).toEqual({ x: 1, y: 2, w: 0, h: 0 })
	})
})

describe("right-only layout", () => {
	const nodes = build(["R", ["A", ["A1"], ["A2"], ["A3"]], ["B"], ["C", ["C1"]]])
	const { boxes } = run(nodes)

	it("puts every node on the right with the right depth", () => {
		for (const [id, b] of boxes) if (id !== "R") expect(b.side).toBe("right")
		expect(boxes.get("A").depth).toBe(1)
		expect(boxes.get("C1").depth).toBe(2)
	})
	it("places children gapX after the parent's right edge", () => {
		const gap = LAYOUT_DEFAULTS.gapX
		expect(boxes.get("A").x).toBeCloseTo(right(boxes.get("R")) + gap)
		expect(boxes.get("A1").x).toBeCloseTo(right(boxes.get("A")) + gap)
		expect(boxes.get("C1").x).toBeCloseTo(right(boxes.get("C")) + gap)
	})
	it("stacks siblings in order with gapY between their subtrees", () => {
		const gapY = LAYOUT_DEFAULTS.gapY
		expect(boxes.get("A2").y - (boxes.get("A1").y + H)).toBeCloseTo(gapY)
		expect(boxes.get("A3").y - (boxes.get("A2").y + H)).toBeCloseTo(gapY)
		expect(boxes.get("A").y).toBeLessThan(boxes.get("B").y)
		expect(boxes.get("B").y).toBeLessThan(boxes.get("C").y)
	})
	it("centres a parent on its children", () => {
		expect(mid(boxes.get("A"))).toBeCloseTo(mid(boxes.get("A2")))
		expect(mid(boxes.get("C"))).toBeCloseTo(mid(boxes.get("C1")))
	})
	it("centres the first level on the root", () => {
		const top = boxes.get("A1").y // A's subtree is the tallest and starts the stack
		const bottom = boxes.get("C1").y + H
		expect(mid({ y: top, h: bottom - top })).toBeCloseTo(mid(boxes.get("R")), 0)
		const stackTop = Math.min(...["A", "B", "C"].map((id) => boxes.get(id).y))
		expect(stackTop).toBeLessThan(mid(boxes.get("R")))
	})
	it("has the expected exact subtree arithmetic", () => {
		// A's block = 3 * H + 2 * gapY; B = H; C = H. Total = A + B + C + 2 * gapY.
		const g = LAYOUT_DEFAULTS.gapY
		const a = 3 * H + 2 * g
		const total = a + H + H + 2 * g
		expect(boxes.get("A1").y).toBeCloseTo(-total / 2)
		expect(mid(boxes.get("A"))).toBeCloseTo(-total / 2 + a / 2)
		expect(boxes.get("B").y).toBeCloseTo(-total / 2 + a + g)
	})
	it("does not overlap", () => expectNoOverlap(boxes))
	it("reports bounds covering every box", () => {
		const { bounds, boxes: all } = run(nodes)
		for (const b of all.values()) {
			expect(b.x).toBeGreaterThanOrEqual(bounds.x - 1e-9)
			expect(right(b)).toBeLessThanOrEqual(bounds.x + bounds.w + 1e-9)
			expect(b.y).toBeGreaterThanOrEqual(bounds.y - 1e-9)
			expect(b.y + b.h).toBeLessThanOrEqual(bounds.y + bounds.h + 1e-9)
		}
	})
})

describe("two-sided layout", () => {
	it("alternates the first-level children right, left, right, left", () => {
		const nodes = build(["R", ["A"], ["B"], ["C"], ["D"], ["E"]])
		const { boxes } = run(nodes, "both")
		expect(["A", "B", "C", "D", "E"].map((id) => boxes.get(id).side)).toEqual([
			"right",
			"left",
			"right",
			"left",
			"right",
		])
	})
	it("gives the right side ceil(n/2) children", () => {
		for (const n of [1, 2, 3, 4, 7]) {
			const nodes = build(["R", ...Array.from({ length: n }, (_, i) => [`c${i}`])])
			const { boxes } = run(nodes, "both")
			const onRight = [...boxes.values()].filter((b) => b.side === "right").length
			expect(onRight).toBe(Math.ceil(n / 2))
		}
	})
	it("grows subtrees outward, mirrored on the left", () => {
		const nodes = build(["R", ["A", ["A1"]], ["B", ["B1", ["B1a"]]]])
		const { boxes } = run(nodes, "both", {}, { x: 100, y: 100 })
		const gap = LAYOUT_DEFAULTS.gapX
		expect(boxes.get("A").x).toBeCloseTo(right(boxes.get("R")) + gap)
		expect(boxes.get("A1").x).toBeCloseTo(right(boxes.get("A")) + gap)
		expect(right(boxes.get("B"))).toBeCloseTo(boxes.get("R").x - gap)
		expect(right(boxes.get("B1"))).toBeCloseTo(boxes.get("B").x - gap)
		expect(right(boxes.get("B1a"))).toBeCloseTo(boxes.get("B1").x - gap)
		for (const id of ["B", "B1", "B1a"]) expect(boxes.get(id).side).toBe("left")
		for (const id of ["A", "A1"]) expect(boxes.get(id).side).toBe("right")
	})
	it("centres each side independently on the root's centre", () => {
		const nodes = build(["R", ["A", ["A1"], ["A2"], ["A3"]], ["B"], ["C"]])
		const { boxes } = run(nodes, "both")
		// Left side holds only B, so it sits exactly on the centre line.
		expect(mid(boxes.get("B"))).toBeCloseTo(0)
		// Right side holds A (3 children tall) and C: the stack is centred on 0.
		const g = LAYOUT_DEFAULTS.gapY
		const a = 3 * H + 2 * g
		const total = a + g + H
		expect(boxes.get("A1").y).toBeCloseTo(-total / 2)
		expect(boxes.get("C").y + H).toBeCloseTo(total / 2)
	})
	it("does not overlap on either side", () => {
		const nodes = build([
			"R",
			["A", ["A1"], ["A2"]],
			["B", ["B1"], ["B2"], ["B3"]],
			["C"],
			["D", ["D1"]],
		])
		expectNoOverlap(run(nodes, "both").boxes)
	})
	it("sorts children by order, not by array position", () => {
		const nodes = build(["R", ["A"], ["B"]]).map((n) =>
			n.id === "A" ? { ...n, order: 1 } : n.id === "B" ? { ...n, order: 0 } : n,
		)
		const { boxes } = run(nodes, "both")
		expect(boxes.get("B").side).toBe("right")
		expect(boxes.get("A").side).toBe("left")
	})
})

describe("collapsed nodes", () => {
	const base = build(["R", ["A", ["A1"], ["A2"], ["A3"]], ["B"]])
	it("lay out no children", () => {
		const { boxes } = run(collapse(base, "A"))
		expect([...boxes.keys()].sort()).toEqual(["A", "B", "R"])
	})
	it("take no space: siblings shift up", () => {
		const open = run(base).boxes
		const closed = run(collapse(base, "A")).boxes
		const g = LAYOUT_DEFAULTS.gapY
		expect(closed.get("B").y - closed.get("A").y).toBeCloseTo(H + g)
		expect(open.get("B").y - open.get("A").y).toBeGreaterThan(
			closed.get("B").y - closed.get("A").y,
		)
		// Two single-height boxes centred on the root.
		expect(closed.get("A").y).toBeCloseTo(-(2 * H + g) / 2)
	})
	it("hides everything under a collapsed root", () => {
		expect(run(collapse(base, "R")).boxes.size).toBe(1)
	})
	it("hides grandchildren under a collapsed child but keeps open siblings", () => {
		const nodes = build(["R", ["A", ["A1", ["A1a"]], ["A2"]]])
		expect([...run(collapse(nodes, "A1")).boxes.keys()].sort()).toEqual(["A", "A1", "A2", "R"])
	})
	it("visibleIds lists what gets a box, depth first", () => {
		expect(visibleIds(mapOf(base), base)).toEqual(["R", "A", "A1", "A2", "A3", "B"])
		const c = collapse(base, "A")
		expect(visibleIds(mapOf(c), c)).toEqual(["R", "A", "B"])
		expect(new Set(visibleIds(mapOf(c), c))).toEqual(new Set(run(c).boxes.keys()))
		expect(visibleIds({ rootId: "none" }, c)).toEqual([])
	})
})

describe("text size", () => {
	it("sizes a box from the text width and padding", () => {
		const nodes = build(["R", ["A"]]).map((n) =>
			n.id === "A" ? { ...n, text: "hello world" } : n,
		)
		const { w, h } = run(nodes).boxes.get("A")
		expect(w).toBeCloseTo(11 * 8 + 28)
		expect(h).toBeCloseTo(H)
	})
	it("grows the height with each line and uses the widest line", () => {
		const nodes = build(["R", ["A"]]).map((n) =>
			n.id === "A" ? { ...n, text: "one\nthree lines\nx" } : n,
		)
		const { w, h } = run(nodes).boxes.get("A")
		expect(h).toBeCloseTo(3 * 16 * 1.35 + 16)
		expect(w).toBeCloseTo(11 * 8 + 28)
	})
	it("wraps long lines by words at maxWidth", () => {
		const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda"
		const nodes = build(["R", ["A"]]).map((n) => (n.id === "A" ? { ...n, text } : n))
		const { w, h } = run(nodes).boxes.get("A")
		expect(w).toBeLessThanOrEqual(260)
		expect(h).toBeGreaterThan(H * 1.5)
		const lines = Math.round((h - 16) / (16 * 1.35))
		expect(lines).toBeGreaterThanOrEqual(3)
		expect(lines).toBeLessThanOrEqual(6)
	})
	it("breaks a single over-long word", () => {
		const nodes = build(["R", ["A"]]).map((n) =>
			n.id === "A" ? { ...n, text: "x".repeat(200) } : n,
		)
		const { w, h } = run(nodes).boxes.get("A")
		expect(w).toBeLessThanOrEqual(260)
		expect(h).toBeGreaterThan(H * 2)
	})
	it("honours options", () => {
		const nodes = build(["R", ["A"]])
		const { boxes } = run(nodes, "right", {
			gapX: 10,
			fontSize: 10,
			paddingY: 0,
			lineHeight: 2,
		})
		expect(boxes.get("A").x - right(boxes.get("R"))).toBeCloseTo(10)
		expect(boxes.get("A").h).toBeCloseTo(20)
	})
	it("makes tall nodes keep their subtree apart", () => {
		const tall = "word ".repeat(40)
		const nodes = build(["R", ["A", ["A1"]], ["B"], ["C"]]).map((n) =>
			n.id === "A1" ? { ...n, text: tall } : n,
		)
		expectNoOverlap(run(nodes, "both").boxes)
	})
})

describe("subtreeBounds", () => {
	it("is the rectangle around a node and its visible descendants", () => {
		const nodes = build(["R", ["A", ["A1"], ["A2"]], ["B"]])
		const { boxes } = run(nodes)
		const b = subtreeBounds(boxes, nodes, "A")
		expect(b.x).toBeCloseTo(boxes.get("A").x)
		expect(b.y).toBeCloseTo(boxes.get("A1").y)
		expect(b.y + b.h).toBeCloseTo(boxes.get("A2").y + H)
		expect(right(b)).toBeCloseTo(right(boxes.get("A1")))
	})
	it("ignores hidden descendants and is null without boxes", () => {
		const nodes = collapse(build(["R", ["A", ["A1"]]]), "A")
		const { boxes } = run(nodes)
		const a = boxes.get("A")
		expect(subtreeBounds(boxes, nodes, "A")).toEqual({ x: a.x, y: a.y, w: a.w, h: a.h })
		expect(subtreeBounds(boxes, nodes, "A1")).toBeNull()
		expect(subtreeBounds(boxes, nodes, "zzz")).toBeNull()
	})
})

describe("random trees", () => {
	it("never overlap, with 200 nodes, in both layouts", () => {
		for (const seed of [1, 2, 3, 4]) {
			const nodes = randomTree(200, seed)
			for (const layout of ["right", "both"]) {
				const { boxes } = run(nodes, layout)
				expect(boxes.size).toBe(200)
				expectNoOverlap(boxes)
			}
		}
	})
	it("never overlap with random collapsed nodes", () => {
		const nodes = randomTree(200, 9, { collapsedShare: 0.2 })
		const { boxes } = run(nodes, "both")
		expect(boxes.size).toBeLessThan(200)
		expectNoOverlap(boxes)
		expect(boxes.size).toBe(visibleIds(mapOf(nodes), nodes).length)
	})
	it("puts children a gap outward of the parent, and the parent between its first and last child", () => {
		const nodes = randomTree(200, 5)
		const { boxes } = run(nodes, "both")
		for (const n of nodes) {
			if (n.parentId == null) continue
			const p = boxes.get(n.parentId)
			const b = boxes.get(n.id)
			const kids = nodes.filter((k) => k.parentId === n.id && boxes.has(k.id))
			if (kids.length && n.parentId) {
				const same = kids.map((k) => mid(boxes.get(k.id)))
				expect(mid(b)).toBeGreaterThanOrEqual(Math.min(...same) - 1e-6)
				expect(mid(b)).toBeLessThanOrEqual(Math.max(...same) + 1e-6)
			}
			if (b.side === "right") expect(b.x).toBeCloseTo(right(p) + LAYOUT_DEFAULTS.gapX)
			else expect(right(b)).toBeCloseTo(p.x - LAYOUT_DEFAULTS.gapX)
		}
	})
	it("is deterministic", () => {
		const nodes = randomTree(200, 7)
		const a = run(nodes, "both")
		const b = run(nodes, "both")
		expect([...a.boxes]).toEqual([...b.boxes])
		expect(a.bounds).toEqual(b.bounds)
	})
	it("does not mutate its input", () => {
		const nodes = randomTree(50, 3)
		const before = JSON.stringify(nodes)
		run(nodes, "both")
		expect(JSON.stringify(nodes)).toBe(before)
	})
	it("lays out 5,000 nodes in well under 300 ms", () => {
		const nodes = randomTree(5000, 11)
		const start = performance.now()
		const { boxes } = run(nodes, "both")
		const elapsed = performance.now() - start
		expect(boxes.size).toBe(5000)
		expect(elapsed).toBeLessThan(300)
	})
	it("handles a 5,000 deep chain without recursion limits", () => {
		const nodes = [{ ...build(["n0"])[0] }]
		for (let i = 1; i < 5000; i++)
			nodes.push({ ...build([`n${i}`])[0], parentId: `n${i - 1}`, order: 0 })
		expect(run(nodes, "right").boxes.size).toBe(5000)
	})
})
