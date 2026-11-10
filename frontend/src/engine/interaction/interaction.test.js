import { beforeEach, describe, expect, it } from "vitest"
import { createStore } from "../store/createStore"
import { createConnector, createObject, createTable } from "../model/factories"
import { createDocument } from "../model/schema"
import { toBoard, toScreen } from "../geometry/viewport"
import { handlePoint, rotationFor } from "../geometry/resize"
import { CanvasController } from "./controller"
import { commandFor, SHORTCUTS } from "./keymap"
import { runAction } from "./actions"
import {
	clearClipboard,
	copySelection,
	cutSelection,
	hasClipboard,
	pasteClipboard,
} from "./clipboard"
import { runCommand } from "./commands"
import { fitView, setViewport, zoomIn, zoomOut, zoomTo } from "./view"

const measure = (text, style) => text.length * style.size * 0.5
const rect = (id, x, y, w = 100, h = 60, over = {}) => ({
	...createObject("rectangle", { x, y, w, h }, { theme: "ocean", z: 1 }),
	id,
	...over,
})
const press = (x, y, over = {}) => ({
	clientX: x,
	clientY: y,
	button: 0,
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	...over,
})

// A line from a card to nowhere in particular, so the card counts as taken.
function tieDown(id) {
	store.addItems({
		connectors: [
			createConnector({
				from: { objectId: id, anchor: "e" },
				to: { x: 2000, y: 2000 },
				theme: "ocean",
				z: 1,
			}),
		],
	})
}

let store
let controller
function setup(objects = [], options = {}) {
	store = createStore(
		{ ...createDocument(), objects: objects.map((o, i) => ({ ...o, z: i + 1 })) },
		options,
	)
	store.state.size = { width: 1000, height: 700 }
	controller = new CanvasController(store, { measure })
	return controller
}
const drag = (from, to, over = {}) => {
	controller.pointerDown(press(from[0], from[1], over))
	controller.pointerMove(press(to[0], to[1], over))
	controller.pointerUp(press(to[0], to[1], over))
}

describe("selecting and moving", () => {
	beforeEach(() => setup([rect("a", 100, 100), rect("b", 400, 100)]))

	it("selects the object under a click and clears on empty canvas", () => {
		drag([150, 130], [150, 130])
		expect(store.state.selection).toEqual(["a"])
		drag([800, 600], [800, 600])
		expect(store.state.selection).toEqual([])
	})

	it("shift-click adds and removes from the selection", () => {
		drag([150, 130], [150, 130])
		drag([450, 130], [450, 130], { shiftKey: true })
		expect(store.state.selection).toEqual(["a", "b"])
		drag([150, 130], [150, 130], { shiftKey: true })
		expect(store.state.selection).toEqual(["b"])
	})

	it("drags an object and records one undo step", () => {
		controller.pointerDown(press(150, 130))
		for (let x = 160; x <= 250; x += 10) controller.pointerMove(press(x, 130 + (x - 150) / 2))
		controller.pointerUp(press(250, 180))
		expect([store.getObject("a").x, store.getObject("a").y]).toEqual([200, 150])
		expect(store.history.undoStack).toHaveLength(1)
		store.undo()
		expect([store.getObject("a").x, store.getObject("a").y]).toEqual([100, 100])
	})

	it("treats a press that barely moves as a click, not a move", () => {
		drag([150, 130], [151, 131])
		expect(store.getObject("a").x).toBe(100)
		expect(store.history.undoStack).toHaveLength(0)
	})

	it("moves every selected object together", () => {
		store.select(["a", "b"])
		drag([150, 130], [180, 160])
		expect([store.getObject("a").x, store.getObject("b").x]).toEqual([130, 430])
	})

	it("narrows a multiple selection to the clicked object when it did not move", () => {
		store.select(["a", "b"])
		drag([150, 130], [150, 130])
		expect(store.state.selection).toEqual(["a"])
	})

	it("selects with a marquee, and shift extends it", () => {
		drag([50, 50], [260, 200])
		expect(store.state.selection).toEqual(["a"])
		expect(store.state.marquee).toBeNull()
		drag([350, 50], [560, 200], { shiftKey: true })
		expect(store.state.selection).toEqual(["a", "b"])
	})

	it("works at any zoom and pan, because it only uses the one transform", () => {
		store.state.viewport = { x: -300, y: 40, scale: 0.5 }
		const centre = toScreen(store.state.viewport, { x: 150, y: 130 })
		drag([centre.x, centre.y], [centre.x + 50, centre.y])
		expect(store.getObject("a").x).toBe(200) // 50 screen px at 50% is 100 board units
	})

	it("cannot move anything when read-only, but can still select", () => {
		setup([rect("a", 100, 100)], { readonly: true })
		drag([150, 130], [250, 130])
		expect(store.getObject("a").x).toBe(100)
		expect(store.state.selection).toEqual(["a"])
	})
})

describe("resizing and rotating", () => {
	beforeEach(() => {
		setup([rect("a", 100, 100, 200, 100)])
		store.select(["a"])
	})

	const handleEvent = (name, x, y, over = {}) => ({
		...press(x, y, over),
		target: { dataset: { handle: name } },
	})

	it("resizes from a handle and keeps the opposite corner fixed", () => {
		const from = handlePoint(store.getObject("a"), "se")
		controller.pointerDown(handleEvent("se", from.x, from.y))
		controller.pointerMove(press(400, 350))
		controller.pointerUp(press(400, 350))
		const a = store.getObject("a")
		expect([a.x, a.y, a.w, a.h]).toEqual([100, 100, 300, 250])
		store.undo()
		expect(store.getObject("a").w).toBe(200)
	})

	it("holds the shape's proportions while shift is down", () => {
		controller.pointerDown(handleEvent("se", 300, 200))
		controller.pointerMove(press(500, 260, { shiftKey: true }))
		controller.pointerUp(press(500, 260, { shiftKey: true }))
		const a = store.getObject("a")
		expect(a.w / a.h).toBeCloseTo(2)
	})

	it("will not shrink a shape below its text", () => {
		const text = {
			align: "center",
			size: 20,
			color: "#111111",
			paragraphs: [{ runs: [{ t: "a long line of words here" }] }],
		}
		setup([rect("a", 0, 0, 200, 100, { text })])
		store.select(["a"])
		controller.pointerDown(handleEvent("s", 100, 100))
		controller.pointerMove(press(100, 5))
		controller.pointerUp(press(100, 5))
		expect(store.getObject("a").h).toBeGreaterThan(30)
	})

	it("rotates from the rotation handle, snapping to 15 degrees with shift", () => {
		const a = store.getObject("a")
		controller.pointerDown(handleEvent("rotate", 200, 40))
		controller.pointerMove(press(a.x + a.w + 100, a.y + a.h / 2 + 5, { shiftKey: true }))
		controller.pointerUp(press(a.x + a.w + 100, a.y + a.h / 2 + 5, { shiftKey: true }))
		expect(store.getObject("a").rotation).toBe(90)
		store.undo()
		expect(store.getObject("a").rotation).toBe(0)
	})

	it("rotates freely without shift", () => {
		const a = store.getObject("a")
		controller.pointerDown(handleEvent("rotate", 200, 40))
		controller.pointerMove(press(a.x + a.w + 100, a.y + a.h / 2 + 40))
		controller.pointerUp(press(a.x + a.w + 100, a.y + a.h / 2 + 40))
		const angle = rotationFor(a, { x: a.x + a.w + 100, y: a.y + a.h / 2 + 40 })
		expect(store.getObject("a").rotation).toBeCloseTo(angle, 1)
	})

	it("ignores handles when read-only", () => {
		setup([rect("a", 100, 100)], { readonly: true })
		store.select(["a"])
		controller.pointerDown(handleEvent("se", 200, 160))
		controller.pointerMove(press(400, 400))
		controller.pointerUp(press(400, 400))
		expect(store.getObject("a").w).toBe(100)
	})
})

describe("drawing", () => {
	beforeEach(() => setup())

	it("drags out a rectangle, with a live preview, then selects it and returns to the select tool", () => {
		store.state.tool = "rectangle"
		controller.pointerDown(press(100, 100))
		controller.pointerMove(press(260, 220))
		expect(store.state.preview.rect).toEqual({ x: 100, y: 100, w: 160, h: 120 })
		controller.pointerUp(press(260, 220))
		expect(store.state.preview).toBeNull()
		const [shape] = store.objects.value
		expect([shape.shape, shape.x, shape.y, shape.w, shape.h]).toEqual([
			"rectangle",
			100,
			100,
			160,
			120,
		])
		expect(store.state.selection).toEqual([shape.id])
		expect(store.state.tool).toBe("select")
	})

	it("draws in any direction", () => {
		store.state.tool = "ellipse"
		drag([300, 300], [200, 250])
		const [shape] = store.objects.value
		expect([shape.x, shape.y, shape.w, shape.h]).toEqual([200, 250, 100, 50])
	})

	it("a plain click drops a default-sized shape centred on the click", () => {
		store.state.tool = "rectangle"
		drag([400, 300], [400, 300])
		const [shape] = store.objects.value
		expect([shape.w, shape.h]).toEqual([160, 100])
		expect([shape.x + shape.w / 2, shape.y + shape.h / 2]).toEqual([400, 300])
	})

	it("shift and the square and circle tools keep a 1:1 ratio", () => {
		store.state.tool = "rectangle"
		drag([100, 100], [300, 160], { shiftKey: true })
		let [shape] = store.objects.value
		expect(shape.w).toBe(shape.h)
		store.state.tool = "circle"
		drag([500, 400], [560, 440])
		shape = store.objects.value[1]
		expect([shape.shape, shape.w, shape.h]).toEqual(["ellipse", 60, 60])
	})

	it("shift-drags into the opposite quadrant without flipping the start corner", () => {
		store.state.tool = "rectangle"
		drag([300, 300], [250, 280], { shiftKey: true })
		const [shape] = store.objects.value
		expect([shape.x, shape.y, shape.w, shape.h]).toEqual([250, 250, 50, 50])
	})

	it("places a text box and starts editing it", () => {
		store.state.tool = "text"
		drag([100, 100], [320, 100])
		const [box] = store.objects.value
		expect(box.kind).toBe("text")
		expect(store.state.editingId).toBe(box.id)
		expect(store.state.editingNew).toBe(true)
	})

	it("remembers the last shape for double-click on empty canvas", () => {
		store.state.tool = "diamond"
		drag([100, 100], [250, 200])
		controller.doubleClick(press(600, 400))
		const created = store.objects.value[1]
		expect(created.shape).toBe("diamond")
		expect(store.state.editingId).toBe(created.id)
	})

	it("abandons a half-drawn shape on cancel", () => {
		store.state.tool = "rectangle"
		controller.pointerDown(press(100, 100))
		controller.pointerMove(press(200, 200))
		controller.cancel()
		controller.pointerUp(press(200, 200))
		expect(store.objects.value).toHaveLength(0)
		expect(store.state.preview).toBeNull()
	})

	it("draws nothing when read-only", () => {
		setup([], { readonly: true })
		store.state.tool = "rectangle"
		drag([100, 100], [200, 200])
		expect(store.objects.value).toHaveLength(0)
	})

	it("refuses to draw past the object limit", () => {
		store.setLimits({ maxObjects: 1 })
		const seen = []
		store.subscribe((event) => seen.push(event.type))
		store.state.tool = "rectangle"
		drag([100, 100], [200, 200])
		store.state.tool = "rectangle"
		drag([300, 100], [400, 200])
		expect(store.objects.value).toHaveLength(1)
		expect(seen).toContain("limit")
	})
})

describe("editing text from the canvas", () => {
	it("double-click on a shape starts editing it", () => {
		setup([rect("a", 100, 100)])
		controller.doubleClick(press(150, 130))
		expect(store.state.editingId).toBe("a")
		expect(store.state.editingNew).toBe(false)
	})

	it("pressing elsewhere ends editing", () => {
		setup([rect("a", 100, 100)])
		store.state.editingId = "a"
		controller.pointerDown(press(800, 600))
		expect(store.state.editingId).toBeNull()
	})

	it("does nothing on double-click when read-only", () => {
		setup([rect("a", 100, 100)], { readonly: true })
		controller.doubleClick(press(150, 130))
		expect(store.state.editingId).toBeNull()
	})
})

describe("panning and zooming", () => {
	beforeEach(() => setup())

	it("pans with the hand tool, the middle button, and the space bar", () => {
		store.state.tool = "hand"
		drag([100, 100], [160, 130])
		expect(store.state.viewport).toMatchObject({ x: 60, y: 30 })
		store.state.tool = "select"
		drag([100, 100], [110, 100], { button: 1 })
		expect(store.state.viewport.x).toBe(70)
		controller.setSpaceHeld(true)
		expect(controller.cursor).toBe("grab")
		drag([100, 100], [100, 90])
		expect(store.state.viewport.y).toBe(20)
		expect(store.objects.value).toHaveLength(0)
	})

	it("zooms with ctrl and the wheel, keeping the point under the cursor", () => {
		const cursor = { clientX: 400, clientY: 300 }
		const before = toBoard(store.state.viewport, { x: 400, y: 300 })
		controller.wheel({ ...cursor, deltaY: -100, ctrlKey: true })
		expect(store.state.viewport.scale).toBeGreaterThan(1)
		const after = toBoard(store.state.viewport, { x: 400, y: 300 })
		expect(after.x).toBeCloseTo(before.x)
		expect(after.y).toBeCloseTo(before.y)
		for (let i = 0; i < 100; i++) controller.wheel({ ...cursor, deltaY: 100, ctrlKey: true })
		expect(store.state.viewport.scale).toBe(0.1)
	})

	it("pans with the plain wheel, sideways with shift", () => {
		controller.wheel({ clientX: 0, clientY: 0, deltaX: 0, deltaY: 40 })
		expect(store.state.viewport).toMatchObject({ x: 0, y: -40 })
		controller.wheel({ clientX: 0, clientY: 0, deltaX: 0, deltaY: 30, shiftKey: true })
		expect(store.state.viewport).toMatchObject({ x: -30, y: -40 })
	})

	it("steps zoom in tenths and fits the content", () => {
		zoomIn(store)
		expect(store.state.viewport.scale).toBeCloseTo(1.1)
		zoomOut(store)
		zoomOut(store)
		expect(store.state.viewport.scale).toBeCloseTo(0.9)
		zoomTo(store, 1)
		expect(store.state.viewport.scale).toBe(1)
		store.addObjects([rect("near", 0, 0), rect("far", 5000, 3000, 400, 300)])
		fitView(store)
		expect(store.state.viewport.scale).toBeLessThan(0.25)
		const topLeft = toScreen(store.state.viewport, { x: 0, y: 0 })
		const bottomRight = toScreen(store.state.viewport, { x: 5400, y: 3300 })
		expect(topLeft.x).toBeGreaterThanOrEqual(0)
		expect(bottomRight.x).toBeLessThanOrEqual(1000)
		expect(bottomRight.y).toBeLessThanOrEqual(700)
	})

	it("keeps a preset-size canvas from being panned off into space", () => {
		store.setCanvas({ mode: "preset", preset: "16:9" })
		setViewport(store, { x: -99999, y: -99999, scale: 1 })
		const view = toBoard(store.state.viewport, { x: 0, y: 0 })
		expect(view.x).toBeLessThanOrEqual(1280 - 80)
		expect(view.y).toBeLessThanOrEqual(720 - 80)
	})
})

describe("keyboard commands", () => {
	const key = (k, over = {}) => ({
		key: k,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		...over,
	})

	it("maps the shortcuts", () => {
		expect(commandFor(key("z", { ctrlKey: true })).name).toBe("undo")
		expect(commandFor(key("Z", { metaKey: true, shiftKey: true })).name).toBe("redo")
		expect(commandFor(key("y", { ctrlKey: true })).name).toBe("redo")
		expect(commandFor(key("d", { ctrlKey: true })).name).toBe("duplicate")
		expect(commandFor(key("a", { metaKey: true })).name).toBe("selectAll")
		expect(commandFor(key("Delete")).name).toBe("delete")
		expect(commandFor(key("Backspace")).name).toBe("delete")
		expect(commandFor(key("ArrowRight"))).toEqual({ name: "nudge", dx: 1, dy: 0 })
		expect(commandFor(key("ArrowUp", { shiftKey: true }))).toEqual({
			name: "nudge",
			dx: 0,
			dy: -10,
		})
		expect(commandFor(key("=", { ctrlKey: true })).name).toBe("zoomIn")
		expect(commandFor(key("-", { ctrlKey: true })).name).toBe("zoomOut")
		expect(commandFor(key("0", { ctrlKey: true })).name).toBe("zoomReset")
		expect(commandFor(key("!", { shiftKey: true, code: "Digit1" })).name).toBe("fit")
		expect(commandFor(key("?", { shiftKey: true })).name).toBe("shortcuts")
		expect(commandFor(key("r"))).toEqual({ name: "tool", tool: "rectangle" })
	})

	it("leaves number keys and unknown keys alone", () => {
		for (const k of "123456789".split("")) expect(commandFor(key(k))).toBeNull()
		expect(commandFor(key("q"))).toBeNull()
		expect(commandFor(key("r", { shiftKey: true }))).toBeNull()
		expect(commandFor(key("r", { altKey: true }))).toBeNull()
	})

	it("ignores every key while text is being typed", () => {
		expect(commandFor(key("Delete"), { editing: true })).toBeNull()
		expect(commandFor(key("z", { ctrlKey: true }), { editing: true })).toBeNull()
		expect(commandFor({ ...key("Delete"), target: { tagName: "INPUT" } })).toBeNull()
		expect(
			commandFor({ ...key("r"), target: { tagName: "DIV", isContentEditable: true } }),
		).toBeNull()
	})

	it("lets a read-only viewer look around but not change anything", () => {
		const ro = { readonly: true }
		expect(commandFor(key("="), ro)).toBeNull()
		expect(commandFor(key("=", { ctrlKey: true }), ro).name).toBe("zoomIn")
		expect(commandFor(key("Delete"), ro)).toBeNull()
		expect(commandFor(key("d", { ctrlKey: true }), ro)).toBeNull()
		expect(commandFor(key("z", { ctrlKey: true }), ro)).toBeNull()
		expect(commandFor(key("ArrowLeft"), ro)).toBeNull()
		expect(commandFor(key("r"), ro)).toBeNull()
		expect(commandFor(key("h"), ro).name).toBe("tool")
		expect(commandFor(key("a", { ctrlKey: true }), ro).name).toBe("selectAll")
	})

	it("documents every key it binds", () => {
		const text = SHORTCUTS.map((s) => s.keys.join("+")).join(" ")
		for (const needle of [
			"Ctrl/Cmd+Z",
			"Delete",
			"Arrows",
			"Esc",
			"V",
			"H",
			"R",
			"O",
			"T",
			"?",
			"Shift+1",
		]) {
			expect(text).toContain(needle)
		}
	})
})

describe("running commands", () => {
	beforeEach(() => setup([rect("a", 100, 100), rect("b", 400, 100)]))

	it("deletes, duplicates and nudges the selection, and undoes them", () => {
		store.select(["a"])
		runCommand(store, controller, { name: "nudge", dx: 10, dy: 0 })
		runCommand(store, controller, { name: "nudge", dx: 10, dy: 0 })
		expect(store.getObject("a").x).toBe(120)
		runCommand(store, controller, { name: "duplicate" })
		expect(store.objects.value).toHaveLength(3)
		runCommand(store, controller, { name: "delete" })
		expect(store.objects.value).toHaveLength(2)
		runCommand(store, controller, { name: "undo" })
		runCommand(store, controller, { name: "undo" })
		expect(store.objects.value).toHaveLength(2)
		runCommand(store, controller, { name: "undo" })
		expect(store.getObject("a").x).toBe(100) // both nudges were one step
	})

	it("selects everything", () => {
		runCommand(store, controller, { name: "selectAll" })
		expect(store.state.selection).toEqual(["a", "b"])
	})

	it("escape steps back one level at a time", () => {
		store.select(["a"])
		store.state.tool = "rectangle"
		controller.pointerDown(press(500, 500))
		runCommand(store, controller, { name: "escape" }) // the half-done drag
		expect(controller.drag).toBeNull()
		expect(store.state.tool).toBe("rectangle")
		runCommand(store, controller, { name: "escape" }) // the tool
		expect(store.state.tool).toBe("select")
		expect(store.state.selection).toEqual(["a"])
		runCommand(store, controller, { name: "escape" }) // the selection
		expect(store.state.selection).toEqual([])
	})

	it("switching tools abandons a half-done drag", () => {
		store.state.tool = "rectangle"
		controller.pointerDown(press(500, 500))
		controller.pointerMove(press(600, 600))
		runCommand(store, controller, { name: "tool", tool: "hand" })
		expect(store.state.tool).toBe("hand")
		expect(store.state.preview).toBeNull()
	})

	it("discards an abandoned new text box without leaving a step behind", () => {
		store.state.tool = "text"
		drag([100, 300], [300, 300])
		const box = store.objects.value.at(-1)
		expect(store.discardLastStep()).toBe(true)
		expect(store.getObject(box.id)).toBeNull()
		expect(store.canRedo).toBe(false)
	})
})

describe("lines", () => {
	const line = (over = {}) =>
		createConnector({
			from: { objectId: "a", anchor: "e" },
			to: { objectId: "b", anchor: "w" },
			theme: "ocean",
			z: 1,
			...over,
		})
	beforeEach(() => setup([rect("a", 100, 100), rect("b", 400, 100)]))

	it("draws a line that attaches to the anchors it starts and ends near", () => {
		store.state.tool = "arrow-straight"
		drag([203, 132], [398, 128])
		const [connector] = store.connectors.value
		expect(connector.from).toEqual({ objectId: "a", anchor: "e" })
		expect(connector.to).toEqual({ objectId: "b", anchor: "w" })
		expect(connector.heads.end).toBe("arrow")
		expect(store.state.tool).toBe("select")
		expect(store.history.undoStack).toHaveLength(1)
		expect(store.state.connectorPreview).toBeNull()
		expect(store.state.snap).toBeNull()
	})

	it("leaves the ends free when they are not near an anchor", () => {
		store.state.tool = "line-elbow"
		drag([250, 400], [350, 500])
		const [connector] = store.connectors.value
		expect(connector.from).toEqual({ x: 250, y: 400 })
		expect(connector.to).toEqual({ x: 350, y: 500 })
		expect(connector.geometry).toBe("elbow")
		expect(connector.heads.end).toBe("none")
	})

	it("shows the anchors and the snap target while drawing", () => {
		store.state.tool = "arrow-straight"
		controller.pointerMove(press(205, 135))
		expect(store.state.anchorShapes).toContain("a")
		expect(store.state.snap).toEqual({ objectId: "a", anchor: "e" })
		controller.pointerMove(press(700, 600))
		expect(store.state.anchorShapes).toEqual([])
		expect(store.state.snap).toBeNull()
	})

	it("a click with a line tool, or ending where it began, draws nothing", () => {
		store.state.tool = "arrow-straight"
		drag([250, 400], [250, 400])
		expect(store.connectors.value).toHaveLength(0)
		store.state.tool = "arrow-straight"
		drag([203, 132], [60, 300])
		controller.pointerDown(press(203, 132))
		controller.pointerMove(press(204, 133))
		controller.pointerUp(press(204, 133))
		expect(store.connectors.value).toHaveLength(1)
	})

	it("escape abandons a line half drawn", () => {
		store.state.tool = "arrow-straight"
		controller.pointerDown(press(250, 400))
		controller.pointerMove(press(350, 500))
		expect(store.state.connectorPreview).not.toBeNull()
		runCommand(store, controller, { name: "escape" })
		expect(store.state.connectorPreview).toBeNull()
		expect(store.connectors.value).toHaveLength(0)
	})

	it("a click on a line selects it, and delete removes only the line", () => {
		const connector = line()
		store.addItems({ connectors: [connector] })
		store.clearSelection()
		drag([300, 131], [300, 131])
		expect(store.state.selection).toEqual([connector.id])
		runCommand(store, controller, { name: "delete" })
		expect(store.connectors.value).toHaveLength(0)
		expect(store.objects.value).toHaveLength(2)
		store.undo()
		expect(store.connectors.value).toHaveLength(1)
	})

	it("deleting a shape deletes its lines in the same step", () => {
		store.addItems({ connectors: [line()] })
		store.select(["a"])
		runCommand(store, controller, { name: "delete" })
		expect(store.connectors.value).toHaveLength(0)
		store.undo()
		expect(store.connectors.value).toHaveLength(1)
		expect(store.objects.value).toHaveLength(2)
	})

	it("drags a line end onto another shape's anchor, then back to open space, as one step each", () => {
		const connector = line()
		store.addItems({ connectors: [connector] })
		store.select([connector.id])
		const handle = { target: { dataset: { handle: "line-to" } } }
		controller.pointerDown(press(400, 130, handle))
		controller.pointerMove(press(450, 92))
		expect(store.state.snap).toEqual({ objectId: "b", anchor: "n" })
		controller.pointerUp(press(450, 92))
		expect(store.getConnector(connector.id).to).toEqual({ objectId: "b", anchor: "n" })
		controller.pointerDown(press(450, 100, handle))
		controller.pointerMove(press(700, 500))
		controller.pointerUp(press(700, 500))
		expect(store.getConnector(connector.id).to).toEqual({ x: 700, y: 500 })
		expect(store.state.snap).toBeNull()
		store.undo()
		expect(store.getConnector(connector.id).to).toEqual({ objectId: "b", anchor: "n" })
	})

	it("bends a curved line from its middle handle", () => {
		const connector = line({ geometry: "curved" })
		store.addItems({ connectors: [connector] })
		store.select([connector.id])
		const handle = { target: { dataset: { handle: "line-bend" } } }
		controller.pointerDown(press(300, 130, handle))
		controller.pointerMove(press(300, 60))
		controller.pointerUp(press(300, 60))
		expect(Math.abs(store.getConnector(connector.id).bend)).toBeGreaterThan(50)
		expect(store.history.undoStack).toHaveLength(2)
	})

	it("moving selected shapes leaves their lines attached; free ends move with a selected line", () => {
		const attached = line()
		const free = line({ from: { x: 10, y: 400 }, to: { x: 110, y: 400 } })
		store.addItems({ connectors: [attached, free] })
		store.select([free.id, "a"])
		controller.pointerDown(press(150, 130))
		controller.pointerMove(press(170, 150))
		controller.pointerUp(press(170, 150))
		expect(store.getObject("a").x).toBe(120)
		expect(store.getConnector(attached.id).from).toEqual({ objectId: "a", anchor: "e" })
		expect(store.getConnector(free.id).from).toEqual({ x: 30, y: 420 })
		expect(store.getConnector(free.id).to).toEqual({ x: 130, y: 420 })
	})

	it("a marquee selects the lines it crosses", () => {
		const connector = line()
		store.addItems({ connectors: [connector] })
		store.clearSelection()
		drag([280, 60], [330, 200])
		expect(store.state.selection).toEqual([connector.id])
	})

	it("double-clicking a line starts editing its label", () => {
		const connector = line()
		store.addItems({ connectors: [connector] })
		controller.doubleClick(press(300, 130))
		expect(store.state.editingId).toBe(connector.id)
		expect(store.objects.value).toHaveLength(2)
	})

	it("hover arrows add a connected copy on that side, in one step", () => {
		tieDown("b") // "b" already has a line, so it is not a free card to join
		controller.pointerMove(press(150, 130))
		expect(store.state.hoverId).toBe("a")
		controller.pointerDown(press(240, 130, { target: { dataset: { quick: "e" } } }))
		controller.pointerUp(press(240, 130))
		expect(store.objects.value).toHaveLength(3)
		expect(store.connectors.value).toHaveLength(2)
		const added = store.objects.value.find((object) => !["a", "b"].includes(object.id))
		const connector = store.connectors.value.find((c) => c.from.objectId === "a")
		expect(connector.from).toEqual({ objectId: "a", anchor: "e" })
		expect(connector.to).toEqual({ objectId: added.id, anchor: "w" })
		// Directly east is taken by "b", so the copy sits clear of it.
		expect(
			added.x < 400 + 100 &&
				added.x + added.w > 400 &&
				added.y < 160 &&
				added.y + added.h > 100,
		).toBe(false)
		expect(store.state.selection).toEqual([added.id])
		expect(store.history.undoStack).toHaveLength(2) // the tie-down, then this one step
		store.undo()
		expect(store.objects.value).toHaveLength(2)
		expect(store.connectors.value).toHaveLength(1)
	})

	it("hover arrows do nothing for a read-only viewer", () => {
		setup([rect("a", 100, 100)], { readonly: true })
		controller.pointerMove(press(150, 130))
		controller.pointerDown(press(240, 130, { target: { dataset: { quick: "e" } } }))
		expect(store.objects.value).toHaveLength(1)
	})

	it("select all and the L key include lines", () => {
		store.addItems({ connectors: [line()] })
		runCommand(store, controller, { name: "selectAll" })
		expect(store.state.selection).toHaveLength(3)
		expect(commandFor({ key: "l", target: null }, {})).toEqual({
			name: "tool",
			tool: "connector",
		})
		runCommand(store, controller, { name: "tool", tool: "connector" })
		expect(store.state.tool).toBe("arrow-straight")
	})
})

describe("groups and the format painter", () => {
	beforeEach(() => setup([rect("a", 100, 100), rect("b", 400, 100), rect("c", 700, 100)]))

	it("clicking one member of a group picks the whole group, and moving it moves them all", () => {
		store.select(["a", "b"])
		runCommand(store, controller, { name: "selectAll" })
		store.updateObjects([
			{ id: "a", patch: { groupId: "g" } },
			{ id: "b", patch: { groupId: "g" } },
		])
		store.clearSelection()
		drag([150, 130], [150, 130])
		expect(store.state.selection.sort()).toEqual(["a", "b"])
		controller.pointerDown(press(150, 130))
		controller.pointerMove(press(190, 160))
		controller.pointerUp(press(190, 160))
		expect([store.getObject("a").x, store.getObject("b").x, store.getObject("c").x]).toEqual([
			140, 440, 700,
		])
	})

	it("clicking inside a selected group keeps the group; a marquee takes whole groups", () => {
		store.updateObjects([
			{ id: "a", patch: { groupId: "g" } },
			{ id: "b", patch: { groupId: "g" } },
		])
		store.select(["a", "b"])
		drag([450, 130], [450, 130])
		expect(store.state.selection.sort()).toEqual(["a", "b"])
		store.clearSelection()
		drag([90, 90], [230, 200]) // catches only "a"
		expect(store.state.selection.sort()).toEqual(["a", "b"])
	})

	it("shift-click adds or removes a whole group", () => {
		store.updateObjects([
			{ id: "a", patch: { groupId: "g" } },
			{ id: "b", patch: { groupId: "g" } },
		])
		store.select(["c"])
		drag([150, 130], [150, 130], { shiftKey: true })
		expect(store.state.selection.sort()).toEqual(["a", "b", "c"])
		drag([450, 130], [450, 130], { shiftKey: true })
		expect(store.state.selection).toEqual(["c"])
	})

	it("duplicating a group makes a new group, and a lone member leaves the group", () => {
		store.updateObjects([
			{ id: "a", patch: { groupId: "g" } },
			{ id: "b", patch: { groupId: "g" } },
		])
		const ids = store.duplicate(["a", "b"])
		const copies = ids.map((id) => store.getObject(id))
		expect(copies[0].groupId).toBeTruthy()
		expect(copies[0].groupId).toBe(copies[1].groupId)
		expect(copies[0].groupId).not.toBe("g")
		const [lone] = store.duplicate(["a"]).map((id) => store.getObject(id))
		expect(lone.groupId).toBeUndefined()
	})

	it("the format painter puts a copied format on the next object clicked, then lets go", () => {
		store.updateObjects([
			{ id: "a", patch: { style: { ...store.getObject("a").style, fill: "#FEE2E2" } } },
		])
		store.select(["a"])
		runAction(store, { name: "painter" })
		expect(store.state.painter).not.toBeNull()
		drag([450, 130], [450, 130])
		expect(store.getObject("b").style.fill).toBe("#FEE2E2")
		expect(store.state.painter).toBeNull()
		expect(store.state.selection).toEqual(["a"]) // the selection did not move
	})

	it("escape puts the painter down before anything else", () => {
		store.select(["a"])
		runAction(store, { name: "painter" })
		runCommand(store, controller, { name: "escape" })
		expect(store.state.painter).toBeNull()
		expect(store.state.selection).toEqual(["a"])
	})
})

describe("shortcuts and form controls", () => {
	it("typing in a text field keeps its keys, but a slider does not", () => {
		const event = (type) => ({ key: "z", ctrlKey: true, target: { tagName: "INPUT", type } })
		expect(commandFor(event("text"), {})).toBeNull()
		expect(commandFor({ key: "z", ctrlKey: true, target: { tagName: "INPUT" } }, {})).toBeNull() // no type means text
		expect(commandFor(event("range"), {})).toEqual({ name: "undo" })
		expect(commandFor(event("checkbox"), {})).toEqual({ name: "undo" })
		expect(
			commandFor({ key: "z", ctrlKey: true, target: { tagName: "TEXTAREA" } }, {}),
		).toBeNull()
	})
})

describe("smart guides while dragging", () => {
	beforeEach(() => setup([rect("a", 100, 100), rect("b", 400, 300)]))

	it("snaps a dragged object's edge to another's and shows the guide", () => {
		controller.pointerDown(press(150, 130)) // a, at (100,100)
		controller.pointerMove(press(450, 430)) // its raw position would be x 400, y 400... near b's left edge (400)
		controller.pointerMove(press(448, 330)) // raw x 398, y 300: within 6px of b's left edge and top edge
		expect([store.getObject("a").x, store.getObject("a").y]).toEqual([400, 300])
		expect(store.state.guides.length).toBeGreaterThan(0)
		controller.pointerUp(press(448, 330))
		expect(store.state.guides).toEqual([])
	})

	it("lets go once the pointer moves on", () => {
		controller.pointerDown(press(150, 130))
		controller.pointerMove(press(448, 330))
		expect(store.getObject("a").x).toBe(400)
		controller.pointerMove(press(470, 380))
		expect(store.getObject("a").x).toBe(420)
		expect(store.state.guides).toEqual([])
	})

	it("holding Alt turns the snap off", () => {
		controller.pointerDown(press(150, 130, { altKey: true }))
		controller.pointerMove(press(448, 330, { altKey: true }))
		expect([store.getObject("a").x, store.getObject("a").y]).toEqual([398, 300])
		expect(store.state.guides).toEqual([])
	})

	it("snaps to the page edge in a preset canvas", () => {
		store.setCanvas({ mode: "preset", preset: "16:9" })
		store.state.viewport = { x: 0, y: 0, scale: 1 }
		controller.pointerDown(press(150, 130))
		controller.pointerMove(press(54, 130)) // raw x 4: 4 from the page's left edge
		expect(store.getObject("a").x).toBe(0)
	})

	it("snaps by screen distance, so zoomed out it reaches further across the board", () => {
		controller.pointerDown(press(150, 130))
		controller.pointerMove(press(150 + 288, 130)) // raw x 388: 12 board units from b's left edge
		expect(store.getObject("a").x).toBe(388) // at 100% that is 12px away: too far to snap
		controller.pointerUp(press(150 + 288, 130))
		store.undo()
		store.state.viewport = { x: 0, y: 0, scale: 0.5 }
		controller.pointerDown(press(75, 65)) // inside "a" at half size
		controller.pointerMove(press(75 + 144, 65)) // the same 288 board units, now 6 screen pixels from the edge
		expect(store.getObject("a").x).toBe(400)
	})
})

describe("clipboard", () => {
	beforeEach(() => {
		clearClipboard()
		setup([rect("a", 100, 100), rect("b", 400, 100), rect("c", 700, 100)])
	})

	it("copies, then pastes a copy 10 units over, selected, as one step; each paste goes 10 further", () => {
		store.select(["a"])
		expect(copySelection(store)).toBe(true)
		const first = pasteClipboard(store)
		expect(first).toHaveLength(1)
		expect(store.getObject(first[0]).x).toBe(110)
		expect(store.state.selection).toEqual(first)
		const second = pasteClipboard(store)
		expect(store.getObject(second[0]).x).toBe(120)
		expect(store.history.undoStack).toHaveLength(2)
		store.undo()
		expect(store.objects.value).toHaveLength(4)
	})

	it("pastes on top of the board", () => {
		store.select(["c"])
		copySelection(store)
		store.select(["a"])
		copySelection(store)
		const [id] = pasteClipboard(store)
		expect(store.objects.value.at(-1).id).toBe(id)
	})

	it("cuts: the original goes in one step, and the paste brings it back", () => {
		store.select(["a"])
		expect(cutSelection(store)).toBe(true)
		expect(store.getObject("a")).toBeNull()
		const [id] = pasteClipboard(store)
		expect(store.getObject(id).x).toBe(110)
		store.undo()
		store.undo()
		expect(store.getObject("a")).not.toBeNull()
	})

	it("keeps a line's ends only when both shapes are copied, else leaves it free where it was", () => {
		store.addItems({
			connectors: [
				createConnector({
					from: { objectId: "a", anchor: "e" },
					to: { objectId: "b", anchor: "w" },
					theme: "ocean",
					z: 1,
				}),
			],
		})
		store.select(["a", "b"])
		copySelection(store)
		const both = pasteClipboard(store)
		const line = store.connectors.value.find((c) => both.includes(c.id))
		expect(line.from.objectId).not.toBe("a")
		expect(both.includes(line.from.objectId) && both.includes(line.to.objectId)).toBe(true)
		store.select(["a"])
		copySelection(store)
		pasteClipboard(store)
		expect(store.connectors.value).toHaveLength(2) // no new line: only one end was copied
	})

	it("a line copied on its own keeps where it was as free ends", () => {
		const line = createConnector({
			from: { objectId: "a", anchor: "e" },
			to: { objectId: "b", anchor: "w" },
			theme: "ocean",
			z: 1,
		})
		store.addItems({ connectors: [line] })
		store.select([line.id])
		copySelection(store)
		const [id] = pasteClipboard(store)
		const pasted = store.getConnector(id)
		expect(pasted.from).toEqual({ x: 210, y: 140 }) // a's east anchor (200,130), moved 10
		expect(pasted.to).toEqual({ x: 410, y: 140 })
	})

	it("survives a different board, and nothing happens when read-only or empty", () => {
		store.select(["a"])
		copySelection(store)
		setup([rect("z", 0, 0)])
		expect(hasClipboard()).toBe(true)
		expect(pasteClipboard(store)).toHaveLength(1)
		setup([], { readonly: true })
		expect(pasteClipboard(store)).toEqual([])
		clearClipboard()
		setup([rect("a", 0, 0)])
		expect(copySelection(store)).toBe(false)
		expect(pasteClipboard(store)).toEqual([])
	})

	it("is refused, without a trace, when the board is full", () => {
		store.setLimits({ maxObjects: 3 })
		store.select(["a"])
		copySelection(store)
		const stepsBefore = store.history.undoStack.length
		expect(pasteClipboard(store)).toEqual([])
		expect(store.objects.value).toHaveLength(3)
		expect(store.history.undoStack).toHaveLength(stepsBefore)
	})
})

describe("auto-pan at the edge of the view", () => {
	beforeEach(() => setup([rect("a", 100, 100)]))

	it("scrolls the view while an object is held near an edge, and the object keeps up", () => {
		controller.pointerDown(press(150, 130))
		controller.pointerMove(press(995, 400)) // 5px from the right edge of a 1000px view
		const x = store.state.viewport.x
		const before = store.getObject("a").x
		expect(controller.autoPanTick(100)).toBe(true)
		expect(store.state.viewport.x).toBeLessThan(x) // the view moved right
		expect(store.getObject("a").x).toBeGreaterThan(before) // and the object travelled with it
		controller.pointerUp(press(995, 400))
	})

	it("does nothing in the middle of the view, with nothing held, or when panning by hand", () => {
		expect(controller.autoPanTick(100)).toBe(false)
		controller.pointerDown(press(150, 130))
		controller.pointerMove(press(500, 350))
		expect(controller.autoPanTick(100)).toBe(false)
		controller.pointerUp(press(500, 350))
		controller.pointerDown(press(500, 350, { button: 1 }))
		expect(controller.autoPanTick(100)).toBe(false)
	})

	it("speeds up the nearer the pointer is to the edge, in every direction", () => {
		controller.pointerDown(press(150, 130))
		controller.pointerMove(press(20, 350))
		const slow = store.state.viewport.x
		controller.autoPanTick(100)
		const moveNear = store.state.viewport.x - slow
		controller.pointerMove(press(2, 350))
		const mid = store.state.viewport.x
		controller.autoPanTick(100)
		expect(store.state.viewport.x - mid).toBeGreaterThan(moveNear)
		controller.pointerMove(press(500, 3))
		const y = store.state.viewport.y
		controller.autoPanTick(100)
		expect(store.state.viewport.y).toBeGreaterThan(y) // near the top: the view moves up, content down
	})

	it("also carries a drawing drag along", () => {
		store.state.tool = "rectangle"
		controller.pointerDown(press(500, 350))
		controller.pointerMove(press(998, 350))
		const x = store.state.viewport.x
		controller.autoPanTick(200)
		expect(store.state.viewport.x).toBeLessThan(x)
		expect(store.state.preview.rect.w).toBeGreaterThan(498)
	})
})

describe("tables", () => {
	const table = (id = "t", x = 100, y = 100, over = {}) => ({
		...createTable({ rows: 2, cols: 3, center: { x: 0, y: 0 }, theme: "ocean", z: 1 }),
		id,
		x,
		y,
		...over,
	})
	// A table at (100,100): cells 120 wide and 44 tall, so 360 by 88.

	it("a click with the table tool drops a table of the chosen size, selected, in one step", () => {
		setup([])
		store.state.toolOptions.tableRows = 4
		store.state.toolOptions.tableCols = 2
		store.state.tool = "table"
		drag([500, 300], [500, 300])
		const [made] = store.objects.value
		expect(made.kind).toBe("table")
		expect([made.table.rowH.length, made.table.colW.length]).toEqual([4, 2])
		expect([made.w, made.h]).toEqual([240, 176])
		expect([made.x + made.w / 2, made.y + made.h / 2]).toEqual([500, 300])
		expect(store.state.selection).toEqual([made.id])
		expect(store.state.tool).toBe("select")
		expect(store.state.tableCell).toEqual({ id: made.id, row: 0, col: 0 })
		expect(store.history.undoStack).toHaveLength(1)
	})

	it("dragging out a rectangle shares it between the cells, each at least 20 across", () => {
		setup([])
		store.state.toolOptions.tableRows = 2
		store.state.toolOptions.tableCols = 4
		store.state.tool = "table"
		controller.pointerDown(press(100, 100))
		controller.pointerMove(press(500, 300))
		expect(store.state.preview).toMatchObject({ tool: "table", rect: { w: 400, h: 200 } })
		controller.pointerUp(press(500, 300))
		const [made] = store.objects.value
		expect([made.x, made.y, made.w, made.h]).toEqual([100, 100, 400, 200])
		expect(made.table.colW).toEqual([100, 100, 100, 100])
		expect(store.state.preview).toBeNull()
		store.state.tool = "table"
		drag([700, 100], [705, 102]) // dragged only a few pixels: far too small for eight cells
		const tiny = store.objects.value.at(-1)
		expect(tiny.table.colW.every((w) => w >= 20)).toBe(true)
	})

	it("pressing a cell of a table chooses it", () => {
		setup([table()])
		drag([300, 150], [300, 150]) // x 200 across, y 50 down: column 1, row 1
		expect(store.state.tableCell).toEqual({ id: "t", row: 1, col: 1 })
		drag([110, 110], [110, 110])
		expect(store.state.tableCell).toEqual({ id: "t", row: 0, col: 0 })
	})

	it("double-clicking a cell starts editing that cell, not the table", () => {
		setup([table()])
		controller.doubleClick(press(430, 110)) // column 2, row 0
		expect(store.state.editingId).toBe("t")
		expect(store.state.editingCell).toEqual({ row: 0, col: 2 })
		expect(store.state.tableCell).toEqual({ id: "t", row: 0, col: 2 })
		expect(store.objects.value).toHaveLength(1)
	})

	it("double-clicking an ordinary shape clears any cell being edited", () => {
		setup([table(), rect("a", 700, 100)])
		store.state.editingCell = { row: 1, col: 1 }
		controller.doubleClick(press(750, 130))
		expect(store.state.editingId).toBe("a")
		expect(store.state.editingCell).toBeNull()
	})

	it("resizing from a handle stretches the cells together and keeps the size in step", () => {
		setup([table()])
		store.select(["t"])
		const handle = { target: { dataset: { handle: "se" } } }
		controller.pointerDown(press(460, 188, handle))
		controller.pointerMove(press(820, 276, handle)) // twice as wide and tall
		controller.pointerUp(press(820, 276, handle))
		const t = store.getObject("t")
		expect(t.table.colW).toEqual([240, 240, 240])
		expect(t.table.rowH).toEqual([88, 88])
		expect([t.w, t.h]).toEqual([720, 176])
		expect(store.history.undoStack).toHaveLength(1)
	})

	it("resizing from the top-left keeps the opposite corner, even when a minimum cell stops it", () => {
		setup([table()])
		store.select(["t"])
		const handle = { target: { dataset: { handle: "nw" } } }
		controller.pointerDown(press(100, 100, handle))
		controller.pointerMove(press(450, 180, handle)) // far smaller than three 20-wide cells and two 20-tall rows allow
		controller.pointerUp(press(450, 180, handle))
		const t = store.getObject("t")
		expect(t.table.colW.every((w) => w >= 20)).toBe(true)
		expect(t.x + t.w).toBe(460) // the bottom-right corner has not moved
		expect(t.y + t.h).toBe(188)
	})

	it("finds the cell on a table that is turned", () => {
		setup([table("t", 100, 100, { rotation: 90 })]) // centre (280, 144): turned to stand 88 wide and 360 tall
		// the first cell's middle (160, 122) before turning lands at (280 - (122 - 144), 144 + (160 - 280)).
		drag([302, 24], [302, 24])
		expect(store.state.tableCell).toEqual({ id: "t", row: 0, col: 0 })
	})
})

describe("the comment tool", () => {
	beforeEach(() => {
		setup([rect("a", 100, 100)])
		store.state.canComment = true
		store.state.tool = "comment"
	})

	it("a click on a shape starts a comment on that shape, opens the panel and returns to select", () => {
		drag([150, 130], [150, 130])
		expect(store.state.commentDraft).toEqual({ anchor_type: "shape", shape_id: "a" })
		expect(store.state.commentsOpen).toBe(true)
		expect(store.state.tool).toBe("select")
		expect(store.objects.value).toHaveLength(1)
		expect(store.history.undoStack).toHaveLength(0)
	})

	it("a click on empty canvas starts a comment on that place", () => {
		drag([600.4, 300.6], [600.4, 300.6])
		expect(store.state.commentDraft).toEqual({ anchor_type: "point", x: 600, y: 301 })
	})

	it("a drag is not a comment", () => {
		drag([600, 300], [680, 380])
		expect(store.state.commentDraft).toBeNull()
		expect(store.state.tool).toBe("comment")
	})

	it("does nothing for someone who may not comment, even though a viewer may look around", () => {
		store.state.canComment = false
		drag([150, 130], [150, 130])
		expect(store.state.commentDraft).toBeNull()
	})

	it("works on a read-only board for someone who may comment, and the C key reaches it only then", () => {
		store.setReadonly(true)
		drag([150, 130], [150, 130])
		expect(store.state.commentDraft).not.toBeNull()
		const key = { key: "c", target: null }
		expect(commandFor(key, { readonly: true, canComment: true })).toEqual({
			name: "tool",
			tool: "comment",
		})
		expect(commandFor(key, { readonly: true, canComment: false })).toBeNull()
		expect(commandFor(key, {})).toEqual({ name: "tool", tool: "comment" })
	})
})

describe("the hover arrows keep their shape through the gap", () => {
	beforeEach(() => setup([rect("a", 100, 100), rect("b", 600, 100)]))

	it("stay while the pointer crosses the gap to an arrow, and go once it is well away", () => {
		controller.pointerMove(press(150, 130)) // over "a"
		expect(store.state.hoverId).toBe("a")
		for (const x of [210, 225, 240]) {
			controller.pointerMove(press(x, 130)) // out through the gap towards the east arrow
			expect(store.state.hoverId).toBe("a")
		}
		controller.pointerMove(press(400, 130)) // far away
		expect(store.state.hoverId).toBeNull()
	})

	it("moving onto another shape switches to it", () => {
		controller.pointerMove(press(150, 130))
		controller.pointerMove(press(650, 130))
		expect(store.state.hoverId).toBe("b")
	})

	it("the zone shrinks with zoom, so it is always about 64 screen pixels", () => {
		store.state.viewport = { x: 0, y: 0, scale: 0.5 } // "a" now spans screen x 50..100
		controller.pointerMove(press(75, 65))
		expect(store.state.hoverId).toBe("a")
		controller.pointerMove(press(150, 65)) // 50px past its right edge
		expect(store.state.hoverId).toBe("a")
		controller.pointerMove(press(200, 65)) // 100px past
		expect(store.state.hoverId).toBeNull()
	})

	it("a selected shape offers the quick add too, for a screen that cannot hover", () => {
		tieDown("b")
		store.select(["a"])
		controller.pointerDown(press(247, 130, { target: { dataset: { quick: "e" } } }))
		controller.pointerUp(press(247, 130))
		expect(store.objects.value).toHaveLength(3)
		expect(store.connectors.value).toHaveLength(2)
		expect(store.connectors.value.find((c) => c.from.objectId === "a").from).toEqual({
			objectId: "a",
			anchor: "e",
		})
	})

	it("with two shapes selected there is no quick add, and a text box never has one", () => {
		store.select(["a", "b"])
		controller.pointerDown(press(247, 130, { target: { dataset: { quick: "e" } } }))
		expect(store.objects.value).toHaveLength(2)
		const text = { ...rect("t", 300, 300, 100, 40), kind: "text" }
		store.addObjects([text])
		store.select(["t"])
		controller.pointerDown(press(420, 320, { target: { dataset: { quick: "e" } } }))
		expect(store.objects.value).toHaveLength(3)
	})

	it("moving a shape marks the board as busy until it is let go", () => {
		controller.pointerDown(press(150, 130))
		controller.pointerMove(press(190, 160))
		expect(store.state.dragging).toBe(true)
		controller.pointerUp(press(190, 160))
		expect(store.state.dragging).toBe(false)
	})
})

describe("a chosen line type sticks", () => {
	beforeEach(() => {
		setup([rect("a", 100, 100), rect("b", 500, 100)])
		store.select(["a"])
	})

	it("changing the line type of a line makes the next lines, and quick-add arrows, use it", () => {
		const line = createConnector({
			from: { objectId: "a", anchor: "e" },
			to: { objectId: "b", anchor: "w" },
			geometry: "straight",
			arrow: true,
			theme: "ocean",
			z: 1,
		})
		store.addItems({ connectors: [line] })
		store.select([line.id])
		runAction(store, { name: "style", target: "geometry", value: "elbow" })
		expect(store.state.lastConnectorTool).toBe("arrow-elbow")
		store.select(["a"])
		controller.pointerDown(press(247, 130, { target: { dataset: { quick: "s" } } }))
		controller.pointerUp(press(247, 130))
		const added = store.connectors.value.find((c) => c.id !== line.id)
		expect(added.geometry).toBe("elbow")
		store.select([line.id])
		runAction(store, { name: "style", target: "geometry", value: "curved" })
		expect(store.state.lastConnectorTool).toBe("arrow-curved")
	})

	it("keeps a plain line plain when the last tool had no arrowhead", () => {
		store.state.lastConnectorTool = "line-straight"
		const line = createConnector({
			from: { objectId: "a", anchor: "e" },
			to: { objectId: "b", anchor: "w" },
			geometry: "straight",
			arrow: false,
			theme: "ocean",
			z: 1,
		})
		store.addItems({ connectors: [line] })
		store.select([line.id])
		runAction(store, { name: "style", target: "geometry", value: "curved" })
		expect(store.state.lastConnectorTool).toBe("line-curved")
	})

	it("the line tool chosen last draws with that geometry", () => {
		store.state.lastConnectorTool = "arrow-elbow"
		runCommand(store, controller, { name: "tool", tool: "connector" })
		expect(store.state.tool).toBe("arrow-elbow")
	})
})

describe("table rows and columns", () => {
	const table = () => ({
		...createTable({ rows: 3, cols: 2, center: { x: 300, y: 200 }, theme: "ocean", z: 1 }),
		id: "t",
	})
	const handleEvent = (name, x, y) => ({ ...press(x, y), target: { dataset: { handle: name } } })

	it("dragging a row border changes that row only, in one undo step", () => {
		setup([table()])
		store.select(["t"])
		const before = store.getObject("t")
		controller.pointerDown(handleEvent("row-0", 300, 100))
		controller.pointerMove(handleEvent("row-0", 300, 140))
		controller.pointerUp(handleEvent("row-0", 300, 140))
		const after = store.getObject("t")
		expect(after.table.rowH[0]).toBe(before.table.rowH[0] + 40)
		expect(after.table.rowH.slice(1)).toEqual(before.table.rowH.slice(1))
		expect(after.h).toBe(after.table.rowH.reduce((a, b) => a + b, 0))
		store.undo()
		expect(store.getObject("t").table.rowH).toEqual(before.table.rowH)
	})

	it("a column border changes one column, and a row cannot go below the minimum", () => {
		setup([table()])
		store.select(["t"])
		const before = store.getObject("t")
		controller.pointerDown(handleEvent("col-0", 300, 100))
		controller.pointerMove(handleEvent("col-0", 340, 100))
		controller.pointerUp(handleEvent("col-0", 340, 100))
		expect(store.getObject("t").table.colW[0]).toBe(before.table.colW[0] + 40)
		controller.pointerDown(handleEvent("row-1", 300, 100))
		controller.pointerMove(handleEvent("row-1", 300, -900))
		controller.pointerUp(handleEvent("row-1", 300, -900))
		expect(store.getObject("t").table.rowH[1]).toBe(20)
	})

	it("works on a turned table and is refused for a read-only viewer", () => {
		setup([{ ...table(), rotation: 90 }])
		store.select(["t"])
		const before = store.getObject("t").table.rowH[0]
		controller.pointerDown(handleEvent("row-0", 300, 100))
		controller.pointerMove(handleEvent("row-0", 300 - 30, 100)) // turned 90: board x runs against rows
		controller.pointerUp(handleEvent("row-0", 270, 100))
		expect(store.getObject("t").table.rowH[0]).not.toBe(before)
		store.setReadonly(true)
		const rows = store.getObject("t").table.rowH
		controller.pointerDown(handleEvent("row-1", 300, 100))
		controller.pointerMove(handleEvent("row-1", 300, 160))
		controller.pointerUp(handleEvent("row-1", 300, 160))
		expect(store.getObject("t").table.rowH).toEqual(rows)
	})
})

describe("the quick-add arrow joins a free card nearby first", () => {
	const quick = (side, x = 247, y = 130) => {
		controller.pointerDown(press(x, y, { target: { dataset: { quick: side } } }))
		controller.pointerUp(press(x, y))
	}
	const lineTo = (id) => store.connectors.value.find((c) => c.to.objectId === id)

	beforeEach(() => {
		setup([rect("a", 100, 100), rect("b", 400, 100)])
		store.select(["a"])
	})

	it("connects the free card on that side and adds nothing, then the next click adds a card", () => {
		quick("e")
		expect(store.objects.value).toHaveLength(2)
		expect(store.connectors.value).toHaveLength(1)
		expect(store.connectors.value[0].from).toEqual({ objectId: "a", anchor: "e" })
		expect(store.connectors.value[0].to).toEqual({ objectId: "b", anchor: "w" })
		expect(store.connectors.value[0].heads.end).toBe("arrow")
		expect(store.state.selection).toEqual(["b"])
		store.select(["a"])
		quick("e") // "b" now has a line, so this one adds a new card
		expect(store.objects.value).toHaveLength(3)
		expect(store.connectors.value).toHaveLength(2)
	})

	it("is one undo step, and uses the line type last chosen", () => {
		store.state.lastConnectorTool = "arrow-elbow"
		quick("e")
		expect(store.connectors.value[0].geometry).toBe("elbow")
		expect(store.history.undoStack).toHaveLength(1)
		store.undo()
		expect(store.connectors.value).toHaveLength(0)
		expect(store.objects.value).toHaveLength(2)
	})

	it("ignores a card that is too far, on another side, or already has a line", () => {
		setup([
			rect("a", 100, 100),
			rect("far", 900, 100),
			rect("up", 100, -300),
			rect("tied", 400, 100),
		])
		const line = createConnector({
			from: { objectId: "tied", anchor: "e" },
			to: { x: 900, y: 700 },
			theme: "ocean",
			z: 1,
		})
		store.addItems({ connectors: [line] })
		store.select(["a"])
		quick("e")
		expect(store.objects.value).toHaveLength(5) // none qualified, a new card was added
		expect(store.connectors.value.filter((c) => c.from.objectId === "a")).toHaveLength(1)
		expect(lineTo("far")).toBeUndefined()
		expect(lineTo("tied")).toBeUndefined()
	})

	it("joins the card in the direction of the arrow, and the nearest when there are two", () => {
		setup([
			rect("a", 100, 100),
			rect("below", 100, 300),
			rect("right2", 330, 100),
			rect("right1", 260, 100),
		])
		store.select(["a"])
		quick("s")
		expect(lineTo("below")).toBeTruthy()
		expect(store.connectors.value[0].to.anchor).toBe("n")
		store.select(["a"])
		quick("e")
		expect(lineTo("right1")).toBeTruthy()
		expect(lineTo("right2")).toBeUndefined()
	})
})
