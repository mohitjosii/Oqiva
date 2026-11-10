import { describe, expect, it } from "vitest"
import { layoutMap } from "./layout"
import { navigate } from "./tree"
import { build, mapOf, measure } from "./testUtils"

// Both layout: right side gets A, C, E; left side gets B, D.
//   R: A(A1, A2(A2a)), B(B1, B2), C, D(D1), E(E1)
const spec = [
	"R",
	["A", ["A1"], ["A2", ["A2a"]]],
	["B", ["B1"], ["B2"]],
	["C"],
	["D", ["D1"]],
	["E", ["E1"]],
]
const setup = (mutate = (n) => n) => {
	const nodes = mutate(build(spec))
	const layout = layoutMap(mapOf(nodes), nodes, measure)
	return { nodes, layout, go: (id, dir) => navigate(nodes, layout, id, dir) }
}
const collapse =
	(...ids) =>
	(nodes) =>
		nodes.map((n) => (ids.includes(n.id) ? { ...n, collapsed: true } : n))

describe("navigate from the root", () => {
	const { go } = setup()
	it("goes to the first child on each side", () => {
		expect(go("R", "right")).toBe("A")
		expect(go("R", "left")).toBe("B")
	})
	it("does nothing up or down", () => {
		expect(go("R", "up")).toBeNull()
		expect(go("R", "down")).toBeNull()
	})
	it("does nothing when that side is empty", () => {
		const nodes = build(["R", ["A"]])
		const layout = layoutMap(mapOf(nodes), nodes, measure)
		expect(navigate(nodes, layout, "R", "left")).toBeNull()
		expect(navigate(nodes, layout, "R", "right")).toBe("A")
	})
})

describe("navigate on the right side", () => {
	const { go } = setup()
	it("right goes to the first visible child, left to the parent", () => {
		expect(go("A", "right")).toBe("A1")
		expect(go("A1", "left")).toBe("A")
		expect(go("A", "left")).toBe("R")
		expect(go("A1", "right")).toBeNull()
		expect(go("A2", "right")).toBe("A2a")
	})
	it("up and down move between siblings on the same side", () => {
		expect(go("A", "down")).toBe("C") // B is on the other side
		expect(go("C", "down")).toBe("E")
		expect(go("E", "up")).toBe("C")
		expect(go("A1", "down")).toBe("A2")
		expect(go("A2", "up")).toBe("A1")
	})
	it("jumps to the nearest node at the same depth when there is no sibling", () => {
		expect(go("A2", "down")).toBe("E1") // C has no children, so the next depth-2 node is E1
		expect(go("E1", "up")).toBe("A2")
		expect(go("E1", "down")).toBeNull()
		expect(go("A1", "up")).toBeNull()
	})
	it("returns null at the ends of the side", () => {
		expect(go("A", "up")).toBeNull()
		expect(go("E", "down")).toBeNull()
	})
})

describe("navigate on the left side (mirrored)", () => {
	const { go } = setup()
	it("left goes outward to the first child, right to the parent", () => {
		expect(go("B", "left")).toBe("B1")
		expect(go("B1", "right")).toBe("B")
		expect(go("B", "right")).toBe("R")
		expect(go("B1", "left")).toBeNull()
	})
	it("up and down use siblings, then the same depth on this side", () => {
		expect(go("B", "down")).toBe("D")
		expect(go("D", "up")).toBe("B")
		expect(go("B1", "down")).toBe("B2")
		expect(go("B2", "down")).toBe("D1")
		expect(go("D1", "up")).toBe("B2")
		expect(go("B", "up")).toBeNull()
		expect(go("D", "down")).toBeNull()
	})
})

describe("navigate with collapsed nodes and bad input", () => {
	it("does not enter a collapsed node", () => {
		const { go } = setup(collapse("A"))
		expect(go("A", "right")).toBeNull()
		expect(go("R", "right")).toBe("A")
	})
	it("skips the hidden depth-2 nodes when jumping", () => {
		const { go } = setup(collapse("A"))
		expect(go("E1", "up")).toBeNull() // A's children are hidden
	})
	it("returns null for unknown or hidden nodes and bad directions", () => {
		const { go } = setup(collapse("A"))
		expect(go("nope", "up")).toBeNull()
		expect(go("A1", "up")).toBeNull() // no box
		expect(go("A", "sideways")).toBeNull()
	})
	it("handles a right-only map", () => {
		const nodes = build(spec)
		const layout = layoutMap(mapOf(nodes, "right"), nodes, measure)
		expect(navigate(nodes, layout, "R", "left")).toBeNull()
		expect(navigate(nodes, layout, "A", "down")).toBe("B")
	})
})
