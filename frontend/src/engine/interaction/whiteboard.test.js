import * as Y from "yjs"
import { beforeEach, describe, expect, it } from "vitest"
import { createBridge } from "../collab/bridge"
import { seedUpdate, snapshotFromDoc } from "../collab/ydoc"
import { collectItems, exportArea, isEmpty } from "../export/scene"
import { buildSvg } from "../export/svg"
import { createConnector, createObject } from "../model/factories"
import { createDocument, parseDocument } from "../model/schema"
import { createStroke } from "../model/strokes"
import { createMap } from "../modes/mindmap/model"
import { nestFlowcharts } from "../modes/flowchart/document"
import { createStore } from "../store/createStore"
import { CanvasController } from "./controller"
import { runCommand } from "./commands"
import { commandFor } from "./keymap"
import { pasteClipboard, copySelection } from "./clipboard"
import { ERASER_RADIUS } from "./eraser"

const measure = (text, style) => text.length * (style?.size || 16) * 0.5
const press = (x, y, over = {}) => ({
	clientX: x,
	clientY: y,
	button: 0,
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	...over,
})
const rect = (id, x, y, w = 100, h = 60) => ({
	...createObject("rectangle", { x, y, w, h }, { theme: "ocean", z: 1 }),
	id,
})
const horizontal = (id, y = 200, from = 0, to = 400) => ({
	...createStroke({
		points: Array.from({ length: (to - from) / 5 + 1 }, (_, i) => [from + i * 5, y]),
		color: "#EF4444",
		width: 6,
	}),
	id,
})

let store
let controller
function setup(objects = [], { canvas = {}, readonly = false } = {}) {
	const doc = createDocument()
	store = createStore(
		{
			...doc,
			canvas: { ...doc.canvas, ...canvas },
			objects: objects.map((o, i) => ({ ...o, z: i + 1 })),
		},
		{ readonly },
	)
	store.state.size = { width: 1000, height: 700 }
	controller = new CanvasController(store, { measure })
	return controller
}
const draw = (points) => {
	controller.pointerDown(press(...points[0]))
	for (const p of points.slice(1)) controller.pointerMove(press(...p))
	const last = points[points.length - 1]
	controller.pointerUp(press(...last))
}
const strokes = () => store.objects.value.filter((o) => o.kind === "stroke")
const steps = () => store.history.undoStack.length

describe("the pen and the highlighter", () => {
	beforeEach(() => setup())

	it("draws a stroke as one undo step, and stays ready for the next", () => {
		store.state.tool = "pen"
		draw([
			[100, 100],
			[140, 120],
			[180, 100],
			[220, 130],
		])
		expect(strokes()).toHaveLength(1)
		expect(strokes()[0]).toMatchObject({ ink: "pen", kind: "stroke" })
		expect(strokes()[0].points.length).toBeGreaterThanOrEqual(3)
		expect(steps()).toBe(1)
		expect(store.state.tool).toBe("pen")
		expect(store.state.selection).toEqual([])
		expect(store.state.inkPreview).toBeNull()
		store.undo()
		expect(strokes()).toHaveLength(0)
		store.redo()
		expect(strokes()).toHaveLength(1)
	})

	it("shows the stroke while it is drawn, and a click makes a dot", () => {
		store.state.tool = "pen"
		controller.pointerDown(press(300, 300))
		controller.pointerMove(press(340, 320))
		expect(store.state.inkPreview.points.length).toBeGreaterThanOrEqual(2)
		controller.pointerUp(press(340, 320))
		draw([[500, 500]])
		expect(strokes()).toHaveLength(2)
		expect(strokes()[1].points.length).toBe(1)
	})

	it("uses the colour and width chosen, and a highlighter is see-through", () => {
		store.state.ink.pen = { color: "#3B82F6", width: 11 }
		store.state.tool = "pen"
		draw([
			[10, 10],
			[60, 10],
		])
		expect(strokes()[0].style).toMatchObject({ stroke: "#3B82F6", strokeWidth: 11 })
		store.state.tool = "highlighter"
		draw([
			[10, 90],
			[60, 90],
		])
		expect(strokes()[1].ink).toBe("highlighter")
		expect(strokes()[1].style.opacity).toBeLessThan(1)
	})

	it("keeps the pressure of a pen, and none for a mouse", () => {
		store.state.tool = "pen"
		const withType = (x, y, over) => ({ ...press(x, y), ...over })
		controller.pointerDown(withType(100, 100, { pointerType: "pen", pressure: 0.2 }))
		controller.pointerMove(withType(160, 120, { pointerType: "pen", pressure: 0.8 }))
		controller.pointerUp(withType(220, 100, { pointerType: "pen", pressure: 0.4 }))
		expect(strokes()[0].points.every((p) => p.length === 3)).toBe(true)
		draw([
			[100, 300],
			[160, 320],
			[220, 300],
		]) // a mouse
		expect(strokes()[1].points.every((p) => p.length === 2)).toBe(true)
	})

	it("thins points while drawing: a slow hand does not pile them up", () => {
		store.state.tool = "pen"
		const slow = Array.from({ length: 400 }, (_, i) => [100 + i * 0.1, 100])
		draw(slow)
		expect(strokes()[0].points.length).toBeLessThan(100)
	})

	it("a stroke can be selected, moved and deleted like any object", () => {
		store.state.tool = "pen"
		draw([
			[100, 100],
			[200, 100],
			[300, 100],
		])
		store.state.tool = "select"
		controller.pointerDown(press(200, 100))
		controller.pointerUp(press(200, 100))
		expect(store.state.selection).toEqual([strokes()[0].id])
		const before = strokes()[0].x
		store.moveBy(store.state.selection, 50, 20)
		expect(strokes()[0].x).toBe(before + 50)
		controller.pointerDown(press(900, 600)) // empty canvas: nothing under it
		controller.pointerUp(press(900, 600))
		expect(store.state.selection).toEqual([])
	})

	it("a viewer cannot draw", () => {
		setup([], { readonly: true })
		store.state.tool = "pen"
		draw([
			[100, 100],
			[200, 100],
		])
		expect(strokes()).toHaveLength(0)
	})

	it("Escape in the middle of a stroke throws it away", () => {
		store.state.tool = "pen"
		controller.pointerDown(press(100, 100))
		controller.pointerMove(press(200, 160))
		controller.cancel()
		expect(store.state.inkPreview).toBeNull()
		expect(strokes()).toHaveLength(0)
	})
})

describe("the eraser", () => {
	beforeEach(() => setup([horizontal("s1")]))

	it("ink mode cuts a stroke in two, as one undo step", () => {
		store.state.tool = "eraser"
		const before = steps()
		draw([
			[200, 160],
			[200, 240],
		])
		expect(strokes()).toHaveLength(2)
		expect(store.getObject("s1")).toBeNull()
		expect(steps()).toBe(before + 1)
		const [a, b] = strokes().sort((p, q) => p.x - q.x)
		expect(a.x + a.w).toBeLessThan(200)
		expect(b.x).toBeGreaterThan(200)
		expect(a.style.stroke).toBe("#EF4444")
		store.undo()
		expect(strokes()).toHaveLength(1)
		expect(store.getObject("s1")).toBeTruthy()
	})

	it("shows what is being cut while the pointer moves, and nothing changes until it lifts", () => {
		store.state.tool = "eraser"
		controller.pointerDown(press(200, 160))
		controller.pointerMove(press(200, 200))
		expect(store.state.erasePending.hide.has("s1")).toBe(true)
		expect(store.state.erasePending.pieces.length).toBe(2)
		expect(store.state.eraser).toMatchObject({ x: 200, y: 200, r: ERASER_RADIUS.m })
		expect(store.getObject("s1")).toBeTruthy()
		controller.pointerUp(press(200, 200))
		expect(store.state.erasePending).toBeNull()
	})

	it("a bigger tip takes a bigger bite", () => {
		const gap = (size) => {
			setup([horizontal("s1")])
			store.state.ink.eraserSize = size
			store.state.tool = "eraser"
			draw([
				[200, 190],
				[200, 210],
			])
			const [a, b] = strokes().sort((p, q) => p.x - q.x)
			return b.x - (a.x + a.w)
		}
		expect(gap("l")).toBeGreaterThan(gap("s"))
	})

	it("hit-tests the path, not the box: sweeping the empty corner of its box erases nothing", () => {
		setup([
			createStroke({
				points: [
					[0, 0],
					[100, 0],
					[100, 100],
				],
				color: "#111111",
				width: 4,
			}),
		])
		store.state.tool = "eraser"
		draw([
			[10, 90],
			[30, 90],
		]) // inside the box, far from the line
		expect(strokes()).toHaveLength(1)
		expect(steps()).toBe(0)
	})

	it("object mode removes the whole object under the tip, with its lines", () => {
		setup([rect("a", 100, 100), rect("b", 400, 100), horizontal("s1", 400)])
		store.addConnectors([
			createConnector({
				from: { objectId: "a", anchor: "e" },
				to: { objectId: "b", anchor: "w" },
				theme: "ocean",
				z: 1,
			}),
		])
		store.state.ink.eraserMode = "object"
		store.state.tool = "eraser"
		const before = steps()
		draw([
			[150, 130],
			[150, 135],
		])
		expect(store.getObject("a")).toBeNull()
		expect(store.connectors.value).toHaveLength(0) // the line to it went too
		expect(store.getObject("b")).toBeTruthy()
		expect(steps()).toBe(before + 1)
		draw([
			[200, 395],
			[210, 405],
		]) // the stroke, whole
		expect(strokes()).toHaveLength(0)
		store.undo()
		expect(strokes()).toHaveLength(1)
	})

	it("object mode leaves frames alone", () => {
		const frame = {
			...createObject("rectangle", { x: 0, y: 0, w: 300, h: 200 }, { theme: "ocean", z: 1 }),
			id: "f",
			kind: "frame",
			name: "Frame",
			text: null,
		}
		setup([frame])
		store.state.ink.eraserMode = "object"
		store.state.tool = "eraser"
		draw([
			[0, 100],
			[5, 100],
		])
		expect(store.getObject("f")).toBeTruthy()
	})

	it("a viewer cannot erase", () => {
		setup([horizontal("s1")], { readonly: true })
		store.state.tool = "eraser"
		draw([
			[200, 160],
			[200, 240],
		])
		expect(strokes()).toHaveLength(1)
	})
})

describe("the laser", () => {
	beforeEach(() => setup())

	it("follows the pointer, leaves a trail and saves nothing", () => {
		store.state.tool = "laser"
		controller.pointerMove(press(100, 100))
		controller.pointerMove(press(140, 120))
		controller.pointerMove(press(180, 160))
		expect(store.state.laser).toMatchObject({ x: 180, y: 160 })
		expect(store.state.laser.trail.length).toBe(3)
		expect(steps()).toBe(0)
		expect(store.objects.value).toHaveLength(0)
		controller.cancel()
		expect(store.state.laser).toBeNull()
	})

	it("works for a viewer too", () => {
		setup([], { readonly: true })
		store.state.tool = "laser"
		controller.pointerMove(press(50, 50))
		expect(store.state.laser).toBeTruthy()
	})

	it("is never in an export", () => {
		store.state.tool = "laser"
		controller.pointerMove(press(50, 50))
		const items = collectItems(store, "board")
		expect(isEmpty(items)).toBe(true)
	})
})

describe("the keys", () => {
	const key = (k, over = {}) => ({
		key: k,
		code: k,
		target: null,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		...over,
	})

	it("P is the pen, E the eraser, Shift+H the highlighter and Shift+L the laser", () => {
		expect(commandFor(key("p"))).toEqual({ name: "tool", tool: "pen" })
		expect(commandFor(key("e"))).toEqual({ name: "tool", tool: "eraser" })
		expect(commandFor(key("H", { shiftKey: true }))).toEqual({
			name: "tool",
			tool: "highlighter",
		})
		expect(commandFor(key("L", { shiftKey: true }))).toEqual({ name: "tool", tool: "laser" })
	})

	it("a viewer may use only the laser", () => {
		expect(commandFor(key("L", { shiftKey: true }), { readonly: true })).toEqual({
			name: "tool",
			tool: "laser",
		})
		expect(commandFor(key("p"), { readonly: true })).toBeNull()
		expect(commandFor(key("e"), { readonly: true })).toBeNull()
	})

	it("choosing a tool ends a half-done gesture", () => {
		setup()
		store.state.tool = "pen"
		controller.pointerDown(press(10, 10))
		controller.pointerMove(press(60, 60))
		runCommand(store, controller, { name: "tool", tool: "select" })
		expect(store.state.inkPreview).toBeNull()
		expect(store.state.tool).toBe("select")
	})
})

describe("the board's settings", () => {
	it("double-click adds a shape, or on a whiteboard a text box", () => {
		setup()
		controller.doubleClick(press(300, 300))
		expect(store.objects.value[0].kind).toBe("shape")
		setup([], { canvas: { doubleClick: "text" } })
		controller.doubleClick(press(300, 300))
		expect(store.objects.value[0].kind).toBe("text")
		expect(store.state.editingId).toBe(store.objects.value[0].id)
	})

	it("sketch style: the object's own choice beats the board's", () => {
		setup([rect("a", 0, 0)], { canvas: { sketch: true } })
		const svgOf = () => {
			const items = collectItems(store, "board")
			return buildSvg(items, exportArea(store, items, "board", measure), { measure })
		}
		const rects = (svg) => (svg.match(/<rect/g) || []).length // the page and its clip are rects too
		const hand = rects(svgOf())
		store.updateObjects([
			{ id: "a", patch: { style: { ...store.getObject("a").style, sketch: false } } },
		])
		expect(rects(svgOf())).toBe(hand + 1) // the clean rectangle is a <rect>, the hand-drawn one paths
		store.setCanvas({ sketch: false })
		store.updateObjects([
			{ id: "a", patch: { style: { ...store.getObject("a").style, sketch: true } } },
		])
		expect(rects(svgOf())).toBe(hand)
	})

	it("lines can be hand-drawn too, by the board or on their own", () => {
		setup([rect("a", 0, 0), rect("b", 300, 0)], { canvas: { sketch: false } })
		store.addConnectors([
			createConnector({
				from: { objectId: "a", anchor: "e" },
				to: { objectId: "b", anchor: "w" },
				theme: "ocean",
				z: 1,
			}),
		])
		const svgOf = () => {
			const items = collectItems(store, "board")
			return buildSvg(items, exportArea(store, items, "board", measure), { measure })
		}
		const paths = (svg) => (svg.match(/<path/g) || []).length
		const clean = paths(svgOf())
		store.setCanvas({ sketch: true })
		expect(paths(svgOf())).toBeGreaterThan(clean) // a rough line is drawn in more strokes than a plain one
		const [line] = store.connectors.value
		store.updateConnectors([
			{ id: line.id, patch: { style: { ...line.style, sketch: false } } },
		])
		const parsed = parseDocument(JSON.parse(JSON.stringify({ ...store.snapshot() })))
		expect(parsed.issues).toEqual([])
	})

	it("a hand-drawn shape looks the same every time it is drawn", () => {
		setup([rect("a", 0, 0)], { canvas: { sketch: true } })
		const draw1 = () => {
			const items = collectItems(store, "board")
			return buildSvg(items, exportArea(store, items, "board", measure), { measure })
		}
		expect(draw1()).toBe(draw1())
	})
})

describe("a mixed selection", () => {
	beforeEach(() => {
		setup([
			rect("a", 0, 0),
			horizontal("s1", 300, 100, 300),
			{
				...createObject("text", { x: 400, y: 0, w: 100, h: 30 }, { theme: "ocean", z: 1 }),
				id: "t",
			},
			{ ...rect("n", 500, 200), kind: "note" },
		])
		store.select(["a", "s1", "t", "n"])
	})

	it("moves together, as one step", () => {
		const x = (id) => store.getObject(id).x
		const before = { a: x("a"), s1: x("s1"), t: x("t"), n: x("n") }
		const steps0 = steps()
		store.moveBy(store.state.selection, 40, 10)
		for (const id of Object.keys(before)) expect(x(id)).toBe(before[id] + 40)
		expect(steps()).toBe(steps0 + 1)
	})

	it("copies and pastes, strokes included", () => {
		copySelection(store)
		pasteClipboard(store)
		expect(store.objects.value).toHaveLength(8)
		expect(strokes()).toHaveLength(2)
		expect(strokes()[1].points).toEqual(strokes()[0].points)
	})

	it("duplicates and deletes", () => {
		store.duplicate(store.state.selection)
		expect(store.objects.value).toHaveLength(8)
		store.removeItems(store.state.selection)
		expect(store.objects.value).toHaveLength(4)
	})

	it("is offered the arranging tools and the shared ones, and nothing that would skip a stroke", async () => {
		const { availableSections } = await import("./palette")
		const sections = availableSections(store.state.selection.map((id) => store.getObject(id)))
		for (const name of ["arrange", "align", "group", "transform", "opacity"])
			expect(sections.has(name)).toBe(true)
		expect(sections.has("fill")).toBe(false) // a stroke has no fill
		expect(sections.has("sketch")).toBe(false)
	})
})

describe("exporting and thumbnails show every kind", () => {
	it("draws strokes, hand-drawn shapes, mind maps and flowcharts into one picture", () => {
		const { map, root } = createMap({ origin: { x: 600, y: 600 }, id: "m" })
		const node = (id, type, x, y, text) => ({
			id,
			chartId: "c",
			type,
			text,
			x,
			y,
			manual: false,
		})
		const doc = {
			...createDocument(),
			canvas: { ...createDocument().canvas, sketch: true },
			objects: [
				rect("a", 0, 0),
				horizontal("s1", 300, 0, 200),
				{ ...rect("n", 300, 0), kind: "note" },
			].map((o, i) => ({ ...o, z: i + 1 })),
			mindmaps: [
				{ ...map, rootId: root.id, nodes: [{ ...root, text: "Centre" }], crosslinks: [] },
			],
			flowcharts: nestFlowcharts(
				[{ id: "c", direction: "TB", numbered: false }],
				[node("p", "process", 900, 100, "Do it"), node("q", "terminator", 900, 300, "End")],
				[{ id: "e1", chartId: "c", from: "p", to: "q", label: "", order: 0 }],
			),
		}
		const parsed = parseDocument(JSON.parse(JSON.stringify(doc)))
		expect(parsed.issues).toEqual([])
		store = createStore(parsed.document)
		const items = collectItems(store, "board")
		expect(isEmpty(items)).toBe(false)
		const area = exportArea(store, items, "board", measure)
		expect(area.w).toBeGreaterThan(900)
		const svg = buildSvg(items, area, { measure })
		expect(svg).toContain("Centre") // the mind map
		expect(svg).toContain("Do it") // the flowchart
		expect(svg).toContain('data-flowchart="c"')
		expect(svg).toContain('fill="#EF4444"') // the stroke, filled with its pen colour
		expect(svg).toMatch(/<path d="M[^"]*" fill="none" stroke="#[0-9A-Fa-f]{6}"/) // hand-drawn outlines
		// a selection export takes the stroke when it is selected
		store.select(["s1"])
		expect(collectItems(store, "selection").objects.map((o) => o.id)).toEqual(["s1"])
	})

	it("a stroke past the edge of the shapes widens the picture", () => {
		setup([rect("a", 0, 0), horizontal("s1", 30, 0, 900)])
		const items = collectItems(store, "board")
		expect(exportArea(store, items, "board", measure).w).toBeGreaterThan(900)
	})
})

describe("two people on one whiteboard", () => {
	const flush = () => new Promise((resolve) => queueMicrotask(resolve))
	const settle = async () => {
		await flush()
		await flush()
	}
	function pair() {
		const snapshot = { ...createDocument(), objects: [horizontal("s1")] }
		const people = ["a", "b"].map(() => {
			const doc = new Y.Doc()
			Y.applyUpdate(doc, seedUpdate(snapshot))
			const s = createStore(snapshotFromDoc(doc, snapshot))
			s.state.size = { width: 1000, height: 700 }
			createBridge(s, doc)
			return { doc, store: s }
		})
		const [a, b] = people
		const send = (from, to) =>
			from.doc.on(
				"update",
				(u, origin) => origin !== "wire" && Y.applyUpdate(to.doc, u, "wire"),
			)
		send(a, b)
		send(b, a)
		return { a, b }
	}

	it("a stroke one person draws appears for the other, and so does an erased cut", async () => {
		const { a, b } = pair()
		a.store.addObjects([horizontal("s2", 300)], { select: false })
		await settle()
		expect(b.store.getObject("s2")?.points.length).toBe(81)
		// B cuts the first stroke in two
		const cut = new CanvasController(b.store, { measure })
		b.store.state.tool = "eraser"
		cut.pointerDown(press(200, 160))
		cut.pointerMove(press(200, 240))
		cut.pointerUp(press(200, 240))
		await settle()
		const kinds = (s) => s.objects.value.filter((o) => o.kind === "stroke").length
		expect(kinds(b.store)).toBe(3) // s2 and the two pieces of s1
		expect(kinds(a.store)).toBe(3)
		expect(a.store.getObject("s1")).toBeNull()
	})
})
