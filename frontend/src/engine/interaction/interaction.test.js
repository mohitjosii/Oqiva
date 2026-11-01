import { beforeEach, describe, expect, it } from "vitest"
import { createStore } from "../store/createStore"
import { createObject } from "../model/factories"
import { createDocument } from "../model/schema"
import { toBoard, toScreen } from "../geometry/viewport"
import { handlePoint, rotationFor } from "../geometry/resize"
import { CanvasController } from "./controller"
import { commandFor, SHORTCUTS } from "./keymap"
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
