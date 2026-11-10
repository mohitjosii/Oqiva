import { describe, expect, it } from "vitest"
import { createConnector, createImage, createObject, createTable } from "../model/factories"
import { createDocument } from "../model/schema"
import { createStore } from "../store/createStore"
import {
	MAX_SIDES,
	copyFormat,
	paintOnto,
	pasteFormat,
	runAction,
	shapeToolOf,
	stylePatch,
} from "./actions"
import { activeCell } from "./tables"
import { availableSections, commonValue, pushRecent, RECENT_LIMIT } from "./palette"

const shape = (id, x = 0, over = {}) => ({
	...createObject("rectangle", { x, y: 0, w: 100, h: 60 }, { theme: "ocean", z: 1 }),
	id,
	...over,
})
const ellipse = (id, x = 0) => ({
	...createObject("ellipse", { x, y: 0, w: 100, h: 60 }, { theme: "ocean", z: 1 }),
	id,
})
const textBox = (id) => ({
	...createObject("text", { x: 0, y: 0, w: 100, h: 30 }, { theme: "ocean", z: 1 }),
	id,
})
const image = (id) => ({
	...createImage({
		src: "/private/files/a.png",
		size: { w: 100, h: 100 },
		center: { x: 0, y: 0 },
		z: 1,
	}),
	id,
})
const table = (id) => ({
	...createTable({ rows: 2, cols: 2, center: { x: 0, y: 0 }, theme: "ocean", z: 1 }),
	id,
})
const line = (id = "l1") =>
	createConnector({
		from: { x: 0, y: 0 },
		to: { x: 50, y: 50 },
		theme: "ocean",
		z: 1,
		geometry: "straight",
	})

describe("which tiles a selection shows (the intersection rule)", () => {
	it("shows nothing for nothing", () => {
		expect(availableSections([], []).size).toBe(0)
	})

	it("a single rectangle gets style, text and corner radius", () => {
		const s = availableSections([shape("a")])
		for (const name of [
			"arrange",
			"align",
			"transform",
			"fill",
			"border",
			"text",
			"opacity",
			"radius",
		])
			expect(s.has(name)).toBe(true)
		for (const name of ["group", "distribute", "swap", "size", "removeGaps"])
			expect(s.has(name)).toBe(false)
	})

	it("corner radius needs every selected thing to be rectangular", () => {
		expect(availableSections([shape("a"), shape("b")]).has("radius")).toBe(true)
		expect(availableSections([shape("a"), ellipse("b")]).has("radius")).toBe(false)
		expect(availableSections([shape("a"), image("b")]).has("radius")).toBe(true)
	})

	it("an image takes no fill and no text; a table takes neither and no size changes", () => {
		const s = availableSections([image("i")])
		expect(s.has("fill")).toBe(false)
		expect(s.has("text")).toBe(false)
		expect(s.has("border")).toBe(true)
		expect(availableSections([shape("a"), table("t")]).has("fill")).toBe(false)
		expect(availableSections([table("t"), table("u")]).has("size")).toBe(false)
	})

	it("a line takes colour, width, dash and opacity, but no fill, text or radius", () => {
		const s = availableSections([], [line()])
		expect(s.has("border")).toBe(true)
		expect(s.has("line")).toBe(true)
		expect(s.has("opacity")).toBe(true)
		for (const name of ["fill", "text", "radius", "align", "transform"])
			expect(s.has(name)).toBe(false)
	})

	it("mixing a shape with a line leaves only what both take", () => {
		const s = availableSections([shape("a")], [line()])
		expect(s.has("border")).toBe(true)
		expect(s.has("opacity")).toBe(true)
		expect(s.has("fill")).toBe(false)
		expect(s.has("line")).toBe(false)
	})

	it("arrangement sets lines aside, since they follow their shapes", () => {
		const s = availableSections([shape("a"), shape("b"), shape("c")], [line()])
		for (const name of ["align", "distribute", "size", "group", "transform", "removeGaps"])
			expect(s.has(name)).toBe(true)
	})

	it("distribute needs three, swap exactly two, group two", () => {
		expect(availableSections([shape("a"), shape("b")]).has("distribute")).toBe(false)
		expect(availableSections([shape("a"), shape("b")]).has("swap")).toBe(true)
		expect(availableSections([shape("a"), shape("b"), shape("c")]).has("swap")).toBe(false)
		expect(availableSections([shape("a"), shape("b")]).has("group")).toBe(true)
	})

	it("offers ungroup only when something is grouped", () => {
		expect(availableSections([shape("a"), shape("b")]).has("ungroup")).toBe(false)
		expect(
			availableSections([shape("a", 0, { groupId: "g" }), shape("b")]).has("ungroup"),
		).toBe(true)
	})

	it("leaves an unknown kind from a newer version without style tiles", () => {
		const s = availableSections([{ id: "x", kind: "hologram" }])
		expect(s.has("fill")).toBe(false)
		expect(s.has("arrange")).toBe(true)
	})
})

describe("shared values and recent colours", () => {
	it("reports the shared value, or undefined when they differ", () => {
		expect(commonValue([shape("a"), shape("b")], (o) => o.style.stroke)).toBe(
			shape("a").style.stroke,
		)
		expect(
			commonValue(
				[shape("a"), shape("b", 0, { style: { ...shape("b").style, stroke: "#000000" } })],
				(o) => o.style.stroke,
			),
		).toBeUndefined()
		expect(commonValue([], (o) => o)).toBeUndefined()
	})

	it("keeps recent colours newest first, without repeats, and short", () => {
		let recent = []
		for (const c of ["#111111", "#222222", "#111111"]) recent = pushRecent(recent, c)
		expect(recent).toEqual(["#111111", "#222222"])
		for (let i = 0; i < 20; i++) recent = pushRecent(recent, `#${String(i).padStart(6, "0")}`)
		expect(recent).toHaveLength(RECENT_LIMIT)
		expect(pushRecent(["#ABCDEF"], "#abcdef")).toEqual(["#abcdef"])
	})
})

describe("palette actions on a board", () => {
	const board = (objects, connectors = []) => {
		const store = createStore({
			...createDocument(),
			objects: objects.map((o, i) => ({ ...o, z: i + 1 })),
			connectors,
		})
		store.state.size = { width: 1000, height: 700 }
		return store
	}

	it("arranges, groups and aligns as single undo steps", () => {
		const store = board([shape("a", 0), shape("b", 300), shape("c", 600)])
		store.select(["a"])
		expect(runAction(store, { name: "arrange", mode: "front" })).toBe(true)
		expect(store.objects.value.at(-1).id).toBe("a")
		store.undo()
		expect(store.objects.value.at(-1).id).toBe("c")
		store.select(["a", "b", "c"])
		runAction(store, { name: "group" })
		expect(new Set(store.objects.value.map((o) => o.groupId)).size).toBe(1)
		runAction(store, { name: "ungroup" })
		expect(store.objects.value.every((o) => !o.groupId)).toBe(true)
		store.state.alignTo = "selection"
		store.getObject("b") // read to keep refs warm
		runAction(store, { name: "align", mode: "left" })
		expect(store.objects.value.map((o) => o.x)).toEqual([0, 0, 0])
		store.undo()
		expect(store.objects.value.map((o) => o.x)).toEqual([0, 300, 600])
	})

	it("aligns a lone object to the canvas, and to the first or last picked", () => {
		const store = board([shape("a", 300), shape("b", 100)])
		store.state.alignTo = "canvas"
		store.select(["a"])
		store.state.viewport = { x: 0, y: 0, scale: 1 }
		runAction(store, { name: "align", mode: "left" })
		expect(store.getObject("a").x).toBe(0)
		store.state.alignTo = "last"
		store.select(["a", "b"])
		runAction(store, { name: "align", mode: "right" })
		expect(store.getObject("a").x).toBe(100)
	})

	it("changes nothing for a read-only viewer", () => {
		const store = board([shape("a")])
		store.select(["a"])
		store.setReadonly(true)
		expect(runAction(store, { name: "rotate", degrees: 90 })).toBe(false)
		expect(store.getObject("a").rotation).toBe(0)
	})

	it("rotates and flips the selection, and undoes both", () => {
		const store = board([shape("a", 0)])
		store.select(["a"])
		runAction(store, { name: "rotate", degrees: 90 })
		expect(store.getObject("a").rotation).toBe(90)
		runAction(store, { name: "flip", axis: "horizontal" })
		expect(store.getObject("a").flipX).toBe(true)
		store.undo()
		expect(store.getObject("a").flipX).toBeUndefined()
	})

	it("applies a style to a mixed selection only where it fits", () => {
		const store = board(
			[shape("a"), image("i")],
			[{ ...line(), id: "l1", from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }],
		)
		store.select(["a", "i", "l1"])
		runAction(store, { name: "style", target: "stroke", value: "#DC2626", recent: true })
		expect(store.getObject("a").style.stroke).toBe("#DC2626")
		expect(store.getObject("i").style.stroke).toBe("#DC2626")
		expect(store.getConnector("l1").style.stroke).toBe("#DC2626")
		expect(store.state.recentColors).toEqual(["#DC2626"])
		runAction(store, { name: "style", target: "fill", value: "#FEE2E2" })
		expect(store.getObject("a").style.fill).toBe("#FEE2E2")
		expect(store.getObject("i").style.fill).toBeNull()
		expect(store.getConnector("l1").style.fill).toBeUndefined()
		expect(store.history.undoStack).toHaveLength(2) // one step per tile, however many things changed
	})

	it("sets line geometry and arrowheads only on lines", () => {
		const connector = { ...line(), id: "l1" }
		expect(stylePatch(connector, { target: "geometry", value: "elbow" })).toEqual({
			geometry: "elbow",
		})
		expect(stylePatch(connector, { target: "heads", value: { start: "arrow" } }).heads).toEqual(
			{ start: "arrow", end: "arrow" },
		)
		expect(stylePatch(shape("a"), { target: "geometry", value: "elbow" })).toBeNull()
	})

	it("changes text colour, size, alignment and weight on every run", () => {
		const text = {
			align: "center",
			size: 16,
			color: "#111111",
			paragraphs: [
				{
					runs: [
						{ t: "ab", c: "#FF0000" },
						{ t: "cd", b: 1 },
					],
				},
			],
		}
		const item = shape("a", 0, { text })
		const colored = stylePatch(item, { target: "textColor", value: "#2563EB" }).text
		expect(colored.color).toBe("#2563EB")
		expect(colored.paragraphs[0].runs.every((run) => run.c === undefined)).toBe(true) // run colours no longer override
		expect(stylePatch(item, { target: "textSize", value: 24 }).text.size).toBe(24)
		// any size can be typed, and is held between 8 and 200
		expect(stylePatch(item, { target: "textSize", value: 37 }).text.size).toBe(37)
		expect(stylePatch(item, { target: "textSize", value: 3 }).text.size).toBe(8)
		expect(stylePatch(item, { target: "textSize", value: 999 }).text.size).toBe(200)
		expect(stylePatch(item, { target: "textAlign", value: "left" }).text.align).toBe("left")
		expect(
			stylePatch(item, { target: "bold", value: true }).text.paragraphs[0].runs.every(
				(r) => r.b === 1,
			),
		).toBe(true)
		expect(
			stylePatch(item, { target: "bold", value: false }).text.paragraphs[0].runs.some(
				(r) => r.b,
			),
		).toBe(false)
		expect(stylePatch(shape("b"), { target: "textSize", value: 24 })).toBeNull() // no text to change
	})

	it("grows a shape when a larger text size no longer fits", () => {
		const text = {
			align: "center",
			size: 16,
			color: "#111111",
			paragraphs: [{ runs: [{ t: "word word word word word word" }] }],
		}
		const store = board([shape("a", 0, { text, h: 40, w: 120 })])
		store.select(["a"])
		const measure = (t, style) => t.length * style.size * 0.5
		runAction(store, { name: "style", target: "textSize", value: 48 }, { measure })
		expect(store.getObject("a").h).toBeGreaterThan(40)
	})

	it("the format painter copies one object's style and puts it on another, once", () => {
		const store = board([
			shape("a", 0, {
				style: { ...shape("a").style, fill: "#FEE2E2", stroke: "#DC2626", radius: 20 },
			}),
			ellipse("b", 300),
		])
		store.select(["a"])
		expect(runAction(store, { name: "painter" })).toBe(true)
		expect(store.state.painter).not.toBeNull()
		expect(paintOnto(store, ["b"])).toBe(true)
		expect(store.getObject("b").style.fill).toBe("#FEE2E2")
		expect(store.getObject("b").style.stroke).toBe("#DC2626")
		expect(store.getObject("b").style.radius).not.toBe(20) // an ellipse has no corners to round
		expect(store.state.painter).toBeNull()
	})

	it("a line's format does not go onto a shape, nor a shape's onto a line", () => {
		const connector = { ...line(), id: "l1" }
		expect(pasteFormat(shape("a"), copyFormat(connector))).toBeNull()
		expect(pasteFormat(connector, copyFormat(shape("a")))).toBeNull()
		expect(
			pasteFormat(
				{ ...connector, style: { ...connector.style, stroke: "#000000" } },
				copyFormat(connector),
			).style.stroke,
		).toBe(connector.style.stroke)
	})

	it("pressing the painter again puts it down", () => {
		const store = board([shape("a")])
		store.select(["a"])
		runAction(store, { name: "painter" })
		runAction(store, { name: "painter" })
		expect(store.state.painter).toBeNull()
	})
})

describe("tables in the palette", () => {
	const tableBoard = (over = {}) => {
		const store = createStore({
			...createDocument(),
			objects: [{ ...table("t"), z: 1, x: 0, y: 0, ...over }],
		})
		store.state.size = { width: 1000, height: 700 }
		store.select(["t"])
		store.state.tableCell = { id: "t", row: 0, col: 0 }
		return store
	}

	it("a lone table gets table tools and no flip; a table with others gets no flip either", () => {
		const s = availableSections([table("t")])
		expect(s.has("table")).toBe(true)
		expect(s.has("flip")).toBe(false)
		expect(s.has("transform")).toBe(true)
		expect(availableSections([table("t"), shape("a")]).has("flip")).toBe(false)
		expect(availableSections([table("t"), shape("a")]).has("table")).toBe(false)
		expect(availableSections([shape("a")]).has("flip")).toBe(true)
	})

	it("flipping a selection that includes a table leaves the table alone", () => {
		const store = createStore({
			...createDocument(),
			objects: [
				{ ...table("t"), z: 1 },
				{ ...shape("a", 300), z: 2 },
			],
		})
		store.select(["t", "a"])
		runAction(store, { name: "flip", axis: "horizontal" })
		expect(store.getObject("t").flipX).toBeUndefined()
	})

	it("adds and removes rows and columns around the chosen cell, in one step each", () => {
		const store = tableBoard()
		runAction(store, { name: "table", op: "rowBelow" })
		expect(store.getObject("t").table.rowH).toHaveLength(3)
		expect(store.getObject("t").h).toBe(132) // 3 rows of 44
		runAction(store, { name: "table", op: "colLeft" })
		expect(store.getObject("t").table.colW).toHaveLength(3)
		expect(store.getObject("t").w).toBe(360)
		expect(store.state.tableCell).toEqual({ id: "t", row: 0, col: 1 }) // still the same cell
		runAction(store, { name: "table", op: "removeRow" })
		runAction(store, { name: "table", op: "removeColumn" })
		expect(store.getObject("t").table.rowH).toHaveLength(2)
		expect(store.getObject("t").table.colW).toHaveLength(2)
		store.undo()
		expect(store.getObject("t").table.colW).toHaveLength(3)
		expect(store.history.undoStack).toHaveLength(3)
	})

	it("refuses to remove the last row or column, or to grow past the limits", () => {
		const one = createStore({
			...createDocument(),
			objects: [
				{
					...createTable({
						rows: 1,
						cols: 1,
						center: { x: 0, y: 0 },
						theme: "ocean",
						z: 1,
					}),
					id: "t",
				},
			],
		})
		one.select(["t"])
		expect(runAction(one, { name: "table", op: "removeRow" })).toBe(false)
		expect(runAction(one, { name: "table", op: "removeColumn" })).toBe(false)
		const tall = createStore({
			...createDocument(),
			objects: [
				{
					...createTable({
						rows: 30,
						cols: 1,
						center: { x: 0, y: 0 },
						theme: "ocean",
						z: 1,
					}),
					id: "t",
				},
			],
		})
		tall.select(["t"])
		expect(runAction(tall, { name: "table", op: "rowBelow" })).toBe(false)
		expect(tall.history.undoStack).toHaveLength(0)
	})

	it("fills the chosen cell, or every cell when none is chosen", () => {
		const store = tableBoard()
		store.state.tableCell = { id: "t", row: 1, col: 1 }
		runAction(store, { name: "table", op: "fill", value: "#FEE2E2", recent: true })
		const fills = store.getObject("t").table.fills
		expect(fills[1][1]).toBe("#FEE2E2")
		expect(fills.flat().filter(Boolean)).toHaveLength(1)
		expect(store.state.recentColors).toEqual(["#FEE2E2"])
		store.state.tableCell = null
		runAction(store, { name: "table", op: "fill", value: "#DBEAFE" })
		expect(
			store
				.getObject("t")
				.table.fills.flat()
				.every((f) => f === "#DBEAFE"),
		).toBe(true)
		runAction(store, { name: "table", op: "fill", value: null })
		expect(
			store
				.getObject("t")
				.table.fills.flat()
				.every((f) => f === null),
		).toBe(true)
	})

	it("formats cell text: weight on text that is there, size and alignment kept for empty cells", () => {
		const store = tableBoard()
		const cell = {
			align: "left",
			size: 16,
			color: "#000000",
			paragraphs: [{ runs: [{ t: "hello" }] }],
		}
		const t = store.getObject("t")
		store.updateObjects([
			{
				id: "t",
				patch: {
					table: {
						...t.table,
						cells: [
							[cell, null],
							[null, null],
						],
					},
				},
			},
		])
		runAction(store, { name: "table", op: "text", target: "bold", value: true })
		expect(store.getObject("t").table.cells[0][0].paragraphs[0].runs[0].b).toBe(1)
		store.state.tableCell = { id: "t", row: 1, col: 1 }
		runAction(store, { name: "table", op: "text", target: "textSize", value: 32 })
		expect(store.getObject("t").table.cells[1][1].size).toBe(32)
		expect(store.getObject("t").table.cells[0][1]).toBeNull() // other cells untouched
		expect(runAction(store, { name: "table", op: "text", target: "bold", value: true })).toBe(
			false,
		) // nothing to make bold
	})

	it("makes the row taller when a bigger text size needs the room", () => {
		const store = tableBoard()
		const t = store.getObject("t")
		const text = {
			align: "left",
			size: 16,
			color: "#000000",
			paragraphs: [{ runs: [{ t: "some words that fill the cell" }] }],
		}
		store.updateObjects([
			{
				id: "t",
				patch: {
					table: {
						...t.table,
						cells: [
							[text, null],
							[null, null],
						],
					},
				},
			},
		])
		const before = store.getObject("t").table.rowH[0]
		runAction(
			store,
			{ name: "table", op: "text", target: "textSize", value: 48 },
			{ measure: (s, style) => s.length * style.size * 0.5 },
		)
		expect(store.getObject("t").table.rowH[0]).toBeGreaterThan(before)
		expect(store.getObject("t").h).toBe(
			store.getObject("t").table.rowH.reduce((a, b) => a + b, 0),
		)
	})

	it("does nothing for a viewer, or when more than the table is selected", () => {
		const store = tableBoard()
		store.setReadonly(true)
		expect(runAction(store, { name: "table", op: "rowBelow" })).toBe(false)
		store.setReadonly(false)
		store.addItems({ objects: [{ ...shape("a", 500), z: 5 }] }, { select: false })
		store.select(["t", "a"])
		expect(runAction(store, { name: "table", op: "rowBelow" })).toBe(false)
	})

	it("the chosen cell counts only while its table is the one thing selected", () => {
		const store = tableBoard()
		expect(activeCell(store)).toEqual({ row: 0, col: 0 })
		store.clearSelection()
		expect(activeCell(store)).toBeNull()
		store.select(["t"])
		store.state.tableCell = { id: "t", row: 9, col: 9 }
		expect(activeCell(store)).toBeNull() // that cell is gone
	})
})

describe("changing the kind of a shape, and commenting from the palette", () => {
	const make = (objects) => {
		const store = createStore({
			...createDocument(),
			objects: objects.map((o, i) => ({ ...o, z: i + 1 })),
			connectors: [],
		})
		store.state.size = { width: 1000, height: 700 }
		return store
	}

	it("offers the shape section for shapes only", () => {
		const store = make([shape("a", 0)])
		store.select(["a"])
		expect(availableSections(store.selectedObjects(), []).has("shapeType")).toBe(true)
	})

	it("turns a rectangle into an ellipse and keeps its text and style", () => {
		const store = make([shape("a", 0)])
		const before = store.getObject("a")
		store.select(["a"])
		expect(runAction(store, { name: "shape", tool: "ellipse" })).toBe(true)
		const after = store.getObject("a")
		expect(after.shape).toBe("ellipse")
		expect(after.text).toEqual(before.text)
		expect(after.style).toEqual(before.style)
		expect([after.x, after.w, after.h]).toEqual([before.x, before.w, before.h])
		expect(shapeToolOf(after)).toBe("ellipse")
	})

	it("makes a square or a circle from the longer side, and undoes in one step", () => {
		const store = make([{ ...shape("a", 0), w: 200, h: 100 }])
		store.select(["a"])
		runAction(store, { name: "shape", tool: "square" })
		const square = store.getObject("a")
		expect(square.w).toBe(square.h)
		store.undo()
		expect(store.getObject("a").w).toBe(200)
		expect(store.getObject("a").shape).toBe("rectangle")
	})

	it("sets the sides of a polygon within bounds", () => {
		const store = make([shape("a", 0)])
		store.select(["a"])
		runAction(store, { name: "shape", tool: "polygon" })
		expect(store.getObject("a").shape).toBe("polygon")
		runAction(store, { name: "sides", value: 8 })
		expect(store.getObject("a").sides).toBe(8)
		runAction(store, { name: "sides", value: 99 })
		expect(store.getObject("a").sides).toBeLessThanOrEqual(MAX_SIDES)
	})

	it("starts a comment on the selected shape only when commenting is allowed", () => {
		const store = make([shape("a", 0)])
		store.select(["a"])
		store.state.canComment = false
		expect(runAction(store, { name: "comment" })).toBe(false)
		store.state.canComment = true
		expect(runAction(store, { name: "comment" })).toBe(true)
		expect(store.state.commentDraft).toEqual({ anchor_type: "shape", shape_id: "a" })
		expect(store.state.commentsOpen).toBe(true)
	})
})
