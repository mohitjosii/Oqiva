import { describe, expect, it } from "vitest"
import { createMap, createNode, NODE_TEXT_LIMIT, NOTE_LIMIT } from "./model"
import {
	addChild,
	addSibling,
	applyChange,
	childrenOf,
	demote,
	depthOf,
	isAncestor,
	moveAmongSiblings,
	normalizeOrders,
	promote,
	removeSubtree,
	reparent,
	rootOf,
	setAllCollapsed,
	setColor,
	setCollapsed,
	setMarker,
	setNote,
	setText,
	siblingsOf,
	subtreeIds,
} from "./tree"
import { build } from "./testUtils"

// R -> A (A1, A2, A3), B, C (C1 -> C1a)
const sample = () => build(["R", ["A", ["A1"], ["A2"], ["A3"]], ["B"], ["C", ["C1", ["C1a"]]]])
const order = (nodes, parentId) => childrenOf(nodes, parentId).map((n) => n.id)
const frozen = (nodes) => JSON.stringify(nodes)
const contiguous = (nodes) => {
	const groups = new Map()
	for (const n of nodes) groups.set(n.parentId, [...(groups.get(n.parentId) ?? []), n.order])
	for (const list of groups.values())
		expect(list.sort((a, b) => a - b)).toEqual(list.map((_, i) => i))
}
const ids = (changes) => changes.update.map((u) => u.id).sort()

describe("model", () => {
	it("creates a map with a root", () => {
		const { map, root } = createMap({ origin: { x: 5, y: 6 } })
		expect(map).toMatchObject({ origin: { x: 5, y: 6 }, layout: "both", rootId: root.id })
		expect(root).toMatchObject({
			mapId: map.id,
			parentId: null,
			order: 0,
			text: "Central idea",
		})
		expect(root).toMatchObject({ collapsed: false, color: null, marker: null, note: "" })
		expect(createMap({ origin: { x: 0, y: 0 }, layout: "right" }).map.layout).toBe("right")
	})

	it("fills in node defaults and limits the text", () => {
		const n = createNode({ mapId: "m", parentId: "p", order: 2, text: "x".repeat(900) })
		expect(n.text).toHaveLength(NODE_TEXT_LIMIT)
		expect(n).toMatchObject({
			parentId: "p",
			order: 2,
			collapsed: false,
			color: null,
			note: "",
		})
		expect(n.id).toMatch(/^[A-Za-z0-9_-]+$/)
	})
})

describe("reading the tree", () => {
	const nodes = sample()
	it("lists children in order, whatever the array order", () => {
		const shuffled = [...nodes].reverse()
		expect(order(shuffled, "R")).toEqual(["A", "B", "C"])
		expect(order(shuffled, "A")).toEqual(["A1", "A2", "A3"])
		expect(order(nodes, "B")).toEqual([])
	})
	it("finds siblings, subtrees, depth, root and ancestors", () => {
		expect(siblingsOf(nodes, "A2").map((n) => n.id)).toEqual(["A1", "A2", "A3"])
		expect(siblingsOf(nodes, "nope")).toEqual([])
		expect(subtreeIds(nodes, "C")).toEqual(["C", "C1", "C1a"])
		expect(subtreeIds(nodes, "R")).toEqual(["R", "A", "A1", "A2", "A3", "B", "C", "C1", "C1a"])
		expect(subtreeIds(nodes, "nope")).toEqual([])
		expect(depthOf(nodes, "R")).toBe(0)
		expect(depthOf(nodes, "C1a")).toBe(3)
		expect(depthOf(nodes, "nope")).toBe(-1)
		expect(rootOf(nodes).id).toBe("R")
		expect(rootOf([])).toBeNull()
		expect(isAncestor(nodes, "C", "C1a")).toBe(true)
		expect(isAncestor(nodes, "R", "A1")).toBe(true)
		expect(isAncestor(nodes, "C1a", "C")).toBe(false)
		expect(isAncestor(nodes, "A", "A")).toBe(false)
		expect(isAncestor(nodes, "A", "C1a")).toBe(false)
	})
})

describe("addChild", () => {
	it("adds a last child with the next order", () => {
		const nodes = sample()
		const before = frozen(nodes)
		const c = addChild(nodes, "A", "new")
		expect(c.add).toHaveLength(1)
		expect(c.add[0]).toMatchObject({ mapId: "m", parentId: "A", order: 3, text: "new" })
		expect(c.update).toEqual([])
		expect(c.remove).toEqual([])
		expect(frozen(nodes)).toBe(before)
		expect(order(applyChange(nodes, c), "A")).toEqual(["A1", "A2", "A3", c.add[0].id])
	})
	it("adds under a leaf and gives it order 0", () => {
		expect(addChild(sample(), "B").add[0]).toMatchObject({ parentId: "B", order: 0, text: "" })
	})
	it("un-collapses a collapsed parent and only then", () => {
		const nodes = sample().map((n) => (n.id === "A" ? { ...n, collapsed: true } : n))
		expect(addChild(nodes, "A").update).toEqual([{ id: "A", patch: { collapsed: false } }])
		expect(addChild(nodes, "C").update).toEqual([])
	})
	it("returns null for an unknown parent", () => {
		expect(addChild(sample(), "nope")).toBeNull()
	})
})

describe("addSibling", () => {
	it("inserts right after the node and renumbers only the later siblings", () => {
		const nodes = sample()
		const before = frozen(nodes)
		const c = addSibling(nodes, "A1", "mid")
		expect(c.add[0]).toMatchObject({ parentId: "A", order: 1, text: "mid" })
		expect(c.update).toEqual([
			{ id: "A2", patch: { order: 2 } },
			{ id: "A3", patch: { order: 3 } },
		])
		const after = applyChange(nodes, c)
		expect(order(after, "A")).toEqual(["A1", c.add[0].id, "A2", "A3"])
		contiguous(after)
		expect(frozen(nodes)).toBe(before)
	})
	it("needs no renumbering after the last sibling", () => {
		const c = addSibling(sample(), "A3")
		expect(c.add[0].order).toBe(3)
		expect(c.update).toEqual([])
	})
	it("is not allowed on the root or an unknown node", () => {
		expect(addSibling(sample(), "R")).toBeNull()
		expect(addSibling(sample(), "nope")).toBeNull()
	})
})

describe("removeSubtree", () => {
	it("removes the node and descendants and renumbers the siblings", () => {
		const nodes = sample()
		const before = frozen(nodes)
		const c = removeSubtree(nodes, "A")
		expect(c.remove).toEqual(["A", "A1", "A2", "A3"])
		expect(c.update).toEqual([
			{ id: "B", patch: { order: 0 } },
			{ id: "C", patch: { order: 1 } },
		])
		const after = applyChange(nodes, c)
		expect(after.map((n) => n.id)).toEqual(["R", "B", "C", "C1", "C1a"])
		contiguous(after)
		expect(frozen(nodes)).toBe(before)
	})
	it("leaves the others alone when removing the last sibling", () => {
		const c = removeSubtree(sample(), "C")
		expect(c.update).toEqual([])
		expect(c.remove).toEqual(["C", "C1", "C1a"])
	})
	it("protects the root unless allowed", () => {
		expect(removeSubtree(sample(), "R")).toBeNull()
		expect(removeSubtree(sample(), "R", { allowRoot: true }).remove).toHaveLength(9)
		expect(removeSubtree(sample(), "nope")).toBeNull()
	})
})

describe("reparent", () => {
	it("moves a node with its subtree to the end of another parent", () => {
		const nodes = sample()
		const before = frozen(nodes)
		const c = reparent(nodes, "A1", "B")
		expect(c.update).toEqual([
			{ id: "A1", patch: { parentId: "B" } }, // its order is already 0
			{ id: "A2", patch: { order: 0 } },
			{ id: "A3", patch: { order: 1 } },
		])
		const after = applyChange(nodes, c)
		expect(order(after, "B")).toEqual(["A1"])
		expect(order(after, "A")).toEqual(["A2", "A3"])
		contiguous(after)
		expect(frozen(nodes)).toBe(before)
	})
	it("moves a subtree and keeps its descendants", () => {
		const after = applyChange(sample(), reparent(sample(), "C", "A", 1))
		expect(order(after, "A")).toEqual(["A1", "C", "A2", "A3"])
		expect(subtreeIds(after, "C")).toEqual(["C", "C1", "C1a"])
		expect(depthOf(after, "C1a")).toBe(4)
		contiguous(after)
	})
	it("inserts at an index and clamps it", () => {
		const nodes = sample()
		expect(order(applyChange(nodes, reparent(nodes, "B", "A", 0)), "A")).toEqual([
			"B",
			"A1",
			"A2",
			"A3",
		])
		expect(order(applyChange(nodes, reparent(nodes, "B", "A", 99)), "A")).toEqual([
			"A1",
			"A2",
			"A3",
			"B",
		])
		expect(order(applyChange(nodes, reparent(nodes, "B", "A", -5)), "A")[0]).toBe("B")
	})
	it("reorders within the same parent using the final position", () => {
		const nodes = sample()
		const c = reparent(nodes, "A1", "A", 2)
		expect(order(applyChange(nodes, c), "A")).toEqual(["A2", "A3", "A1"])
		expect(ids(c)).toEqual(["A1", "A2", "A3"])
		expect(c.update.some((u) => "parentId" in u.patch)).toBe(false)
	})
	it("only lists nodes whose order really changes", () => {
		const c = reparent(sample(), "A3", "A", 1)
		expect(ids(c)).toEqual(["A2", "A3"])
	})
	it("un-collapses the new parent", () => {
		const nodes = sample().map((n) => (n.id === "B" ? { ...n, collapsed: true } : n))
		const c = reparent(nodes, "A1", "B")
		expect(c.update).toContainEqual({ id: "B", patch: { collapsed: false } })
		expect(applyChange(nodes, c).find((n) => n.id === "B").collapsed).toBe(false)
	})
	it("blocks cycles: onto itself, a child, a deep descendant", () => {
		const nodes = sample()
		expect(reparent(nodes, "C", "C")).toBeNull()
		expect(reparent(nodes, "C", "C1")).toBeNull()
		expect(reparent(nodes, "C", "C1a")).toBeNull()
		expect(reparent(nodes, "R", "A")).toBeNull()
	})
	it("refuses the root, unknown ids and no-ops", () => {
		const nodes = sample()
		expect(reparent(nodes, "R", "A")).toBeNull()
		expect(reparent(nodes, "nope", "A")).toBeNull()
		expect(reparent(nodes, "A", "nope")).toBeNull()
		expect(reparent(nodes, "A3", "A")).toBeNull() // already last
		expect(reparent(nodes, "A1", "A", 0)).toBeNull()
	})
})

describe("moveAmongSiblings", () => {
	it("swaps with the neighbour and lists just the two", () => {
		const nodes = sample()
		const up = moveAmongSiblings(nodes, "A2", -1)
		expect(order(applyChange(nodes, up), "A")).toEqual(["A2", "A1", "A3"])
		expect(ids(up)).toEqual(["A1", "A2"])
		const down = moveAmongSiblings(nodes, "A2", 1)
		expect(order(applyChange(nodes, down), "A")).toEqual(["A1", "A3", "A2"])
		expect(ids(down)).toEqual(["A2", "A3"])
	})
	it("clamps larger steps", () => {
		const nodes = sample()
		expect(order(applyChange(nodes, moveAmongSiblings(nodes, "A1", 5)), "A")).toEqual([
			"A2",
			"A3",
			"A1",
		])
	})
	it("is null at the ends, on the root and for unknown ids", () => {
		const nodes = sample()
		expect(moveAmongSiblings(nodes, "A1", -1)).toBeNull()
		expect(moveAmongSiblings(nodes, "A3", 1)).toBeNull()
		expect(moveAmongSiblings(nodes, "R", 1)).toBeNull()
		expect(moveAmongSiblings(nodes, "nope", 1)).toBeNull()
		expect(moveAmongSiblings(nodes, "A2", 0)).toBeNull()
	})
})

describe("promote and demote", () => {
	it("promote places a node right after its former parent (depth 2)", () => {
		const nodes = sample()
		const before = frozen(nodes)
		const c = promote(nodes, "A2")
		const after = applyChange(nodes, c)
		expect(order(after, "R")).toEqual(["A", "A2", "B", "C"])
		expect(order(after, "A")).toEqual(["A1", "A3"])
		contiguous(after)
		expect(frozen(nodes)).toBe(before)
	})
	it("promote keeps the subtree and works at depth 3", () => {
		const after = applyChange(sample(), promote(sample(), "C1a"))
		expect(order(after, "C")).toEqual(["C1", "C1a"])
		expect(depthOf(after, "C1a")).toBe(2)
	})
	it("promote is null at depth 0 and 1", () => {
		const nodes = sample()
		expect(promote(nodes, "R")).toBeNull()
		expect(promote(nodes, "A")).toBeNull()
		expect(promote(nodes, "nope")).toBeNull()
	})
	it("demote becomes the last child of the previous sibling", () => {
		const nodes = sample()
		const c = demote(nodes, "B")
		const after = applyChange(nodes, c)
		expect(order(after, "A")).toEqual(["A1", "A2", "A3", "B"])
		expect(order(after, "R")).toEqual(["A", "C"])
		contiguous(after)
		expect(demote(nodes, "C").update.find((u) => u.id === "C").patch.parentId).toBe("B")
	})
	it("demote un-collapses the previous sibling", () => {
		const nodes = sample().map((n) => (n.id === "A" ? { ...n, collapsed: true } : n))
		expect(applyChange(nodes, demote(nodes, "B")).find((n) => n.id === "A").collapsed).toBe(
			false,
		)
	})
	it("demote is null for a first child, the root and unknown ids", () => {
		const nodes = sample()
		expect(demote(nodes, "A")).toBeNull()
		expect(demote(nodes, "A1")).toBeNull()
		expect(demote(nodes, "R")).toBeNull()
		expect(demote(nodes, "nope")).toBeNull()
	})
})

describe("small edits", () => {
	const nodes = sample()
	it("setText limits the length and skips no-ops", () => {
		expect(setText(nodes, "A", "hi")).toEqual({
			add: [],
			update: [{ id: "A", patch: { text: "hi" } }],
			remove: [],
		})
		expect(setText(nodes, "A", "y".repeat(800)).update[0].patch.text).toHaveLength(
			NODE_TEXT_LIMIT,
		)
		expect(setText(nodes, "A", "A")).toBeNull()
		expect(setText(nodes, "nope", "x")).toBeNull()
		expect(setText(nodes, "A", "a\nb").update[0].patch.text).toBe("a\nb")
	})
	it("setNote limits the length", () => {
		expect(setNote(nodes, "A", "n".repeat(5000)).update[0].patch.note).toHaveLength(NOTE_LIMIT)
		expect(setNote(nodes, "A", "")).toBeNull()
	})
	it("setColor validates the colour", () => {
		expect(setColor(nodes, "A", "#aabbcc").update[0].patch.color).toBe("#aabbcc")
		expect(setColor(nodes, "A", "red")).toBeNull() // invalid -> null, already null
		expect(setColor(nodes, "A", "#abc")).toBeNull()
		const coloured = applyChange(nodes, setColor(nodes, "A", "#112233"))
		expect(setColor(coloured, "A", "nonsense").update[0].patch.color).toBeNull()
		expect(setColor(coloured, "A", null).update[0].patch.color).toBeNull()
	})
	it("setMarker cleans the value", () => {
		expect(
			setMarker(nodes, "A", { icon: "star", dot: "#FF0000" }).update[0].patch.marker,
		).toEqual({
			icon: "star",
			dot: "#FF0000",
		})
		expect(setMarker(nodes, "A", { icon: "star", dot: "bad" }).update[0].patch.marker).toEqual({
			icon: "star",
			dot: null,
		})
		expect(
			setMarker(nodes, "A", { icon: null, dot: "#00FF00" }).update[0].patch.marker,
		).toEqual({
			icon: null,
			dot: "#00FF00",
		})
		expect(setMarker(nodes, "A", { icon: null, dot: null })).toBeNull()
		expect(setMarker(nodes, "A", "star")).toBeNull()
	})
	it("setCollapsed sets the flag", () => {
		expect(setCollapsed(nodes, "A", true).update).toEqual([
			{ id: "A", patch: { collapsed: true } },
		])
		expect(setCollapsed(nodes, "A", false)).toBeNull()
	})
	it("setAllCollapsed only changes parents that are not the root", () => {
		const c = setAllCollapsed(nodes, true)
		expect(ids(c)).toEqual(["A", "C", "C1"])
		const collapsed = applyChange(nodes, c)
		expect(collapsed.find((n) => n.id === "R").collapsed).toBe(false)
		expect(collapsed.find((n) => n.id === "B").collapsed).toBe(false)
		expect(setAllCollapsed(collapsed, true)).toBeNull()
		expect(ids(setAllCollapsed(collapsed, false))).toEqual(["A", "C", "C1"])
	})
})

describe("applyChange and normalizeOrders", () => {
	it("applies remove, update and add without mutating", () => {
		const nodes = sample()
		const extra = createNode({ mapId: "m", parentId: "R", order: 3, text: "D", id: "D" })
		const after = applyChange(nodes, {
			add: [extra],
			update: [{ id: "A", patch: { text: "AA" } }],
			remove: ["B"],
		})
		expect(after.find((n) => n.id === "A").text).toBe("AA")
		expect(after.some((n) => n.id === "B")).toBe(false)
		expect(after.at(-1).id).toBe("D")
		expect(nodes.find((n) => n.id === "A").text).toBe("A")
		expect(nodes).toHaveLength(9)
		expect(applyChange(nodes, null)).toEqual(nodes)
	})
	it("renumbers gaps and ties, keeping untouched nodes identical", () => {
		const nodes = sample().map((n) => (n.id === "B" ? { ...n, order: 7 } : n))
		const fixed = normalizeOrders(nodes)
		expect(order(fixed, "R")).toEqual(["A", "C", "B"])
		contiguous(fixed)
		expect(fixed.find((n) => n.id === "A")).toBe(nodes.find((n) => n.id === "A"))
		expect(nodes.find((n) => n.id === "B").order).toBe(7)
	})
	it("keeps orders contiguous through a chain of operations", () => {
		let nodes = sample()
		for (const op of [
			(n) => addChild(n, "R", "x"),
			(n) => addSibling(n, "A2"),
			(n) => reparent(n, "C1", "A", 0),
			(n) => promote(n, "A3"),
			(n) => demote(n, "B"),
			(n) => removeSubtree(n, "A1"),
			(n) => moveAmongSiblings(n, "C", -1),
		]) {
			nodes = applyChange(nodes, op(nodes))
			contiguous(nodes)
		}
	})
})
