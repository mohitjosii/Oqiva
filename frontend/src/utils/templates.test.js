import { describe, expect, it } from "vitest"
import { filterTemplates, labelSize, previewGeometry } from "./templates"

const templates = [
	{
		slug: "a",
		name: "Kanban board",
		description: "Track work",
		category: "Planning",
		tags: ["agile"],
	},
	{
		slug: "b",
		name: "Org chart",
		description: "Who reports to whom",
		category: "People",
		tags: ["Team"],
	},
	{ slug: "c", name: "Blank", description: "", category: "Basics", tags: [] },
]

describe("filterTemplates", () => {
	it("returns everything with no filter", () => {
		expect(filterTemplates(templates)).toHaveLength(3)
		expect(filterTemplates(templates, { category: "", query: "   " })).toHaveLength(3)
	})

	it("matches name, description and tags without regard to case", () => {
		expect(filterTemplates(templates, { query: "KANBAN" }).map((t) => t.slug)).toEqual(["a"])
		expect(filterTemplates(templates, { query: "reports to" }).map((t) => t.slug)).toEqual([
			"b",
		])
		expect(filterTemplates(templates, { query: "team" }).map((t) => t.slug)).toEqual(["b"])
	})

	it("does not search the category label", () => {
		expect(filterTemplates(templates, { query: "planning" })).toEqual([])
	})

	it("combines a category with a search", () => {
		expect(filterTemplates(templates, { category: "People", query: "org" })).toHaveLength(1)
		expect(filterTemplates(templates, { category: "Basics", query: "org" })).toHaveLength(0)
	})

	it("copes with a missing list or missing fields", () => {
		expect(filterTemplates(undefined, { query: "x" })).toEqual([])
		expect(filterTemplates([{ name: "Only a name" }], { query: "only" })).toHaveLength(1)
	})
})

const box = (id, x, y, w, h, extra = {}) => ({
	id,
	kind: "shape",
	shape: "rectangle",
	x,
	y,
	w,
	h,
	style: { fill: "#fff", stroke: "#000" },
	label: null,
	...extra,
})

describe("previewGeometry", () => {
	it("fits the viewBox around the boxes with padding", () => {
		const view = previewGeometry(
			{ objects: [box("a", 100, 200, 100, 50)], connectors: [] },
			{ padding: 0.1 },
		)
		// 100 wide by 50 high, padding 10% of the longer side
		expect(view.viewBox).toBe("90 190 120 70")
		expect(view.empty).toBe(false)
		expect(view.shapes[0]).toMatchObject({ kind: "rect", x: 100, y: 200, fill: "#fff" })
	})

	it("shows a default frame when there is nothing to draw", () => {
		const view = previewGeometry({ objects: [], connectors: [] })
		expect(view.empty).toBe(true)
		expect(view.shapes).toEqual([])
		expect(view.viewBox.split(" ").every((n) => Number.isFinite(Number(n)))).toBe(true)
		expect(previewGeometry(undefined).empty).toBe(true)
	})

	it("joins attached line ends at the anchor of each box", () => {
		const view = previewGeometry({
			objects: [box("a", 0, 0, 100, 50), box("b", 300, 100, 100, 50)],
			connectors: [
				{
					id: "c",
					from: { objectId: "a", anchor: "e" },
					to: { objectId: "b", anchor: "n" },
				},
			],
		})
		expect(view.lines).toEqual([{ id: "c", x1: 100, y1: 25, x2: 350, y2: 100 }])
	})

	it("keeps free ends and drops lines attached to something missing", () => {
		const view = previewGeometry({
			objects: [box("a", 0, 0, 10, 10)],
			connectors: [
				{ id: "free", from: { x: -50, y: 0 }, to: { objectId: "a", anchor: "w" } },
				{ id: "gone", from: { objectId: "zzz", anchor: "e" }, to: { x: 1, y: 1 } },
			],
		})
		expect(view.lines.map((l) => l.id)).toEqual(["free"])
		expect(view.viewBox.startsWith("-")).toBe(true) // the free end widens the frame
	})

	it("picks a shape by kind and ignores boxes with no size", () => {
		const view = previewGeometry({
			objects: [
				box("e", 0, 0, 10, 10, { shape: "ellipse" }),
				box("d", 20, 0, 10, 10, { shape: "diamond" }),
				box("t", 40, 0, 10, 10, { kind: "text", shape: "rectangle" }),
				box("i", 60, 0, 10, 10, { kind: "image", shape: undefined, style: {} }),
				box("z", 80, 0, 0, 10),
			],
			connectors: [],
		})
		expect(view.shapes.map((s) => s.kind)).toEqual(["ellipse", "diamond", "text", "block"])
		expect(view.shapes[1].points).toBe("25,0 30,5 25,10 20,5")
		expect(view.shapes[2]).toMatchObject({ fill: "none", stroke: "none" })
		expect(view.shapes[3].fill).toBe("#F1F5F9")
	})
})

describe("labelSize", () => {
	it("fits the caption in its box", () => {
		expect(labelSize("Hi", { w: 200, h: 100 })).toBe(18)
		expect(labelSize("A much longer caption here", { w: 100, h: 100 })).toBeLessThan(18)
	})

	it("returns 0 when the text would be unreadable or absent", () => {
		expect(labelSize("", { w: 100, h: 100 })).toBe(0)
		expect(labelSize("x".repeat(40), { w: 40, h: 100 })).toBe(0)
	})
})
