import { describe, expect, it } from "vitest"
import { NODE_TEXT_LIMIT } from "./model"
import { countNodes, looksLikeOutline, MAX_PASTE_LINES, parseOutline, treeToChange } from "./paste"
import { applyChange, childrenOf, depthOf } from "./tree"

// Strips the empty `children` arrays for compact expectations.
const shape = (tree) => tree.map((e) => (e.children.length ? [e.text, shape(e.children)] : e.text))

describe("parseOutline: indentation", () => {
	it("reads tab indentation", () => {
		expect(shape(parseOutline("A\n\tA1\n\t\tA1a\n\tA2\nB"))).toEqual([
			["A", [["A1", ["A1a"]], "A2"]],
			"B",
		])
	})
	it("reads 2-space indentation", () => {
		expect(shape(parseOutline("A\n  A1\n    A1a\n  A2\nB"))).toEqual([
			["A", [["A1", ["A1a"]], "A2"]],
			"B",
		])
	})
	it("reads 4-space indentation", () => {
		expect(shape(parseOutline("A\n    A1\n        A1a\n    A2\nB"))).toEqual([
			["A", [["A1", ["A1a"]], "A2"]],
			"B",
		])
	})
	it("tolerates mixed tabs and spaces", () => {
		expect(shape(parseOutline("A\n  A1\n\t\tA1a\n  A2"))).toEqual([
			["A", [["A1", ["A1a"]], "A2"]],
		])
		expect(shape(parseOutline("A\n\tA1\n\t    A1a"))).toEqual([["A", [["A1", ["A1a"]]]]])
	})
	it("clamps an indent jump to one level deeper", () => {
		expect(shape(parseOutline("A\n\t\t\tdeep\n\t\tsame as deep"))).toEqual([
			["A", ["deep", "same as deep"]],
		])
		expect(shape(parseOutline("A\n\t\t\tdeep\n\t\t\t\tdeeper"))).toEqual([
			["A", [["deep", ["deeper"]]]],
		])
	})
	it("returns to a shallower level and keeps going", () => {
		const tree = parseOutline("A\n    A1\n        A1a\n  odd\nB")
		expect(shape(tree)).toEqual([["A", [["A1", ["A1a"]], "odd"]], "B"])
	})
	it("treats an indented first line as top level", () => {
		expect(shape(parseOutline("    A\n    B\n        B1"))).toEqual(["A", ["B", ["B1"]]])
	})
	it("gives a flat list for unindented lines", () => {
		expect(shape(parseOutline("one\ntwo\nthree"))).toEqual(["one", "two", "three"])
	})
})

describe("parseOutline: bullets, numbers, headings", () => {
	it("strips - * + bullet characters", () => {
		for (const b of ["-", "*", "+", "•", "–"])
			expect(shape(parseOutline(`${b} A\n  ${b} A1\n${b} B`))).toEqual([["A", ["A1"]], "B"])
	})
	it("strips numbered markers 1. and 1)", () => {
		expect(shape(parseOutline("1. First\n   1) inner\n2. Second\n10. Tenth"))).toEqual([
			["First", ["inner"]],
			"Second",
			"Tenth",
		])
	})
	it("does not strip things that only look like markers", () => {
		expect(shape(parseOutline("-5 degrees\n**bold**\n1.5 litres\n2020 was great"))).toEqual([
			"-5 degrees",
			"**bold**",
			"1.5 litres",
			"2020 was great",
		])
	})
	it("reads markdown headings as depth", () => {
		expect(shape(parseOutline("# Top\n## Mid\n### Low\n## Mid2\n# Top2"))).toEqual([
			["Top", [["Mid", ["Low"]], "Mid2"]],
			"Top2",
		])
	})
	it("nests bullets under the heading above", () => {
		expect(shape(parseOutline("# Top\n- a\n  - a1\n- b\n## Sub\n- s1"))).toEqual([
			["Top", ["a", ["b"]].length ? [["a", ["a1"]], "b", ["Sub", ["s1"]]] : []],
		])
	})
	it("clamps heading jumps", () => {
		expect(shape(parseOutline("# A\n#### D"))).toEqual([["A", ["D"]]])
		expect(shape(parseOutline("### Start"))).toEqual(["Start"])
	})
	it("needs a space after # to be a heading", () => {
		expect(shape(parseOutline("#hashtag\nplain"))).toEqual(["#hashtag", "plain"])
	})
	it("drops empty bullets and headings", () => {
		expect(shape(parseOutline("A\n-\n#\n  - \nB"))).toEqual(["A", "B"])
	})
})

describe("parseOutline: cleaning and limits", () => {
	it("ignores blank lines and trims trailing spaces", () => {
		expect(shape(parseOutline("\n\nA   \n\n\t \n  A1\t\n\n"))).toEqual([["A", ["A1"]]])
	})
	it("handles Windows and old Mac line endings", () => {
		expect(shape(parseOutline("A\r\n  A1\r\nB\rC"))).toEqual([["A", ["A1"]], "B", "C"])
	})
	it("cuts each line at 500 characters", () => {
		const tree = parseOutline(`${"x".repeat(900)}\nshort`)
		expect(tree[0].text).toHaveLength(NODE_TEXT_LIMIT)
	})
	it("keeps at most 500 lines", () => {
		const text = Array.from({ length: 800 }, (_, i) => `- line ${i}`).join("\n")
		const tree = parseOutline(text)
		expect(tree).toHaveLength(MAX_PASTE_LINES)
		expect(tree.at(-1).text).toBe("line 499")
		expect(
			countNodes(
				parseOutline(
					Array.from({ length: 800 }, (_, i) => `${"\t".repeat(i % 3)}n${i}`).join("\n"),
				),
			),
		).toBe(500)
	})
	it("returns [] for empty input", () => {
		expect(parseOutline("")).toEqual([])
		expect(parseOutline("  \n\n ")).toEqual([])
		expect(parseOutline(null)).toEqual([])
	})
	it("keeps text inside a line, including inner spacing", () => {
		expect(parseOutline("- hello   big world")[0].text).toBe("hello   big world")
	})
})

describe("looksLikeOutline and countNodes", () => {
	it("needs two non-empty lines", () => {
		expect(looksLikeOutline("just one line")).toBe(false)
		expect(looksLikeOutline("one line\n\n  ")).toBe(false)
		expect(looksLikeOutline("")).toBe(false)
		expect(looksLikeOutline(null)).toBe(false)
		expect(looksLikeOutline("a\nb")).toBe(true)
		expect(looksLikeOutline("a\r\n\r\nb")).toBe(true)
	})
	it("counts every node in a tree", () => {
		expect(countNodes(parseOutline("A\n  A1\n  A2\n    A2a\nB"))).toBe(5)
		expect(countNodes([])).toBe(0)
	})
})

describe("treeToChange", () => {
	const tree = parseOutline("A\n  A1\n  A2\nB")
	const parent = {
		id: "P",
		mapId: "m",
		parentId: null,
		order: 0,
		text: "P",
		collapsed: false,
		color: null,
		marker: null,
		note: "",
	}

	it("adds a node per entry with new unique ids", () => {
		const change = treeToChange({ mapId: "m", parentId: "P", startOrder: 0, tree })
		expect(change.add).toHaveLength(4)
		expect(change.update).toEqual([])
		expect(change.remove).toEqual([])
		expect(new Set(change.add.map((n) => n.id)).size).toBe(4)
		for (const n of change.add)
			expect(n).toMatchObject({ mapId: "m", collapsed: false, color: null, note: "" })
	})
	it("attaches top-level entries to the parent from startOrder", () => {
		const change = treeToChange({ mapId: "m", parentId: "P", startOrder: 3, tree })
		const tops = change.add.filter((n) => n.parentId === "P")
		expect(tops.map((n) => [n.text, n.order])).toEqual([
			["A", 3],
			["B", 4],
		])
	})
	it("keeps the nesting and orders among siblings", () => {
		const change = treeToChange({ mapId: "m", parentId: "P", startOrder: 0, tree })
		const nodes = applyChange([parent], change)
		const texts = (id) => childrenOf(nodes, id).map((n) => n.text)
		expect(texts("P")).toEqual(["A", "B"])
		const a = nodes.find((n) => n.text === "A")
		expect(texts(a.id)).toEqual(["A1", "A2"])
		expect(childrenOf(nodes, a.id).map((n) => n.order)).toEqual([0, 1])
		expect(depthOf(nodes, nodes.find((n) => n.text === "A2").id)).toBe(2)
	})
	it("lists parents before their children", () => {
		const change = treeToChange({ mapId: "m", parentId: "P", startOrder: 0, tree })
		const seen = new Set(["P"])
		for (const n of change.add) {
			expect(seen.has(n.parentId)).toBe(true)
			seen.add(n.id)
		}
	})
	it("gives an empty change for an empty tree", () => {
		expect(treeToChange({ mapId: "m", parentId: "P", startOrder: 0, tree: [] }).add).toEqual([])
	})
})
