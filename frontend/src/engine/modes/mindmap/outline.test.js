import { describe, expect, it } from "vitest"
import { indentChange, outdentChange, outlineToText, toOutline } from "./outline"
import { parseOutline } from "./paste"
import { applyChange } from "./tree"
import { build } from "./testUtils"

const nodes = build(["R", ["A", ["A1", ["A1a"]], ["A2"]], ["B"]])

describe("toOutline", () => {
	it("lists the tree in reading order with depth", () => {
		expect(toOutline(nodes, "R").map((i) => [i.id, i.depth])).toEqual([
			["R", 0],
			["A", 1],
			["A1", 2],
			["A1a", 3],
			["A2", 2],
			["B", 1],
		])
	})
	it("follows sibling order, not array order", () => {
		const swapped = nodes.map((n) =>
			n.id === "A" ? { ...n, order: 1 } : n.id === "B" ? { ...n, order: 0 } : n,
		)
		expect(toOutline(swapped, "R").map((i) => i.id)).toEqual(["R", "B", "A", "A1", "A1a", "A2"])
	})
	it("reports hasChildren, text and collapsed, and still includes collapsed children", () => {
		const collapsed = nodes.map((n) => (n.id === "A" ? { ...n, collapsed: true } : n))
		const items = toOutline(collapsed, "R")
		expect(items).toHaveLength(6)
		expect(items.find((i) => i.id === "A")).toEqual({
			id: "A",
			depth: 1,
			text: "A",
			hasChildren: true,
			collapsed: true,
		})
		expect(items.find((i) => i.id === "B")).toMatchObject({
			hasChildren: false,
			collapsed: false,
		})
		expect(items.find((i) => i.id === "A1")).toMatchObject({
			hasChildren: true,
			collapsed: false,
		})
	})
	it("can start from a subtree and handles unknown ids", () => {
		expect(toOutline(nodes, "A1").map((i) => [i.id, i.depth])).toEqual([
			["A1", 0],
			["A1a", 1],
		])
		expect(toOutline(nodes, "nope")).toEqual([])
	})
})

describe("outlineToText", () => {
	it("writes two spaces per level and dash bullets", () => {
		expect(outlineToText(nodes, "R")).toBe("- R\n  - A\n    - A1\n      - A1a\n    - A2\n  - B")
	})
	it("keeps each node on one line", () => {
		const multi = nodes.map((n) => (n.id === "B" ? { ...n, text: "two\nlines" } : n))
		expect(outlineToText(multi, "R").split("\n").at(-1)).toBe("  - two lines")
	})
	it("round-trips through parseOutline", () => {
		const tree = parseOutline(outlineToText(nodes, "R"))
		expect(tree).toHaveLength(1)
		expect(tree[0].text).toBe("R")
		expect(tree[0].children.map((c) => c.text)).toEqual(["A", "B"])
		expect(tree[0].children[0].children[0].children[0].text).toBe("A1a")
	})
})

describe("indent and outdent", () => {
	it("indent is demote and outdent is promote", () => {
		const indented = applyChange(nodes, indentChange(nodes, "B"))
		expect(indented.find((n) => n.id === "B").parentId).toBe("A")
		const outdented = applyChange(nodes, outdentChange(nodes, "A2"))
		expect(outdented.find((n) => n.id === "A2").parentId).toBe("R")
		expect(indentChange(nodes, "A")).toBeNull()
		expect(outdentChange(nodes, "A")).toBeNull()
	})
})
