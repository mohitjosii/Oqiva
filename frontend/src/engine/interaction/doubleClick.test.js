import { describe, expect, it } from "vitest"
import { createObject } from "../model/factories"
import { createDocument } from "../model/schema"
import { createStore } from "../store/createStore"
import { CanvasController } from "./controller"

const measure = (text, style) => text.length * style.size * 0.5
const press = (x, y) => ({
	clientX: x,
	clientY: y,
	button: 0,
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
})

function setup(objects = []) {
	const store = createStore({ ...createDocument(), objects })
	store.state.size = { width: 1000, height: 800 }
	store.state.viewport = { x: 0, y: 0, scale: 1 }
	return { store, controller: new CanvasController(store, { measure, ask: async () => true }) }
}

describe("double-clicking the board", () => {
	it("on empty canvas adds nothing and opens no editor, whatever tool was last used", () => {
		const { store, controller } = setup()
		for (const tool of ["rectangle", "ellipse", "text"]) {
			store.state.lastShapeTool = tool
			controller.doubleClick(press(400, 300))
		}
		expect(store.objects.value).toHaveLength(0)
		expect(store.state.editingId).toBeNull()
	})

	it("also adds nothing when an older board is set to add a text box", () => {
		const doc = createDocument()
		doc.canvas.doubleClick = "text"
		const store = createStore(doc)
		store.state.size = { width: 1000, height: 800 }
		store.state.viewport = { x: 0, y: 0, scale: 1 }
		const controller = new CanvasController(store, { measure, ask: async () => true })
		controller.doubleClick(press(400, 300))
		expect(store.objects.value).toHaveLength(0)
	})

	it("on a shape still edits its text", () => {
		const shape = createObject("rectangle", { x: 300, y: 250, w: 200, h: 100 }, { z: 1 })
		const { store, controller } = setup([shape])
		controller.doubleClick(press(400, 300))
		expect(store.objects.value).toHaveLength(1)
		expect(store.state.editingId).toBe(shape.id)
	})

	it("does nothing on a read-only board", () => {
		const store = createStore(createDocument(), { readonly: true })
		store.state.size = { width: 1000, height: 800 }
		store.state.viewport = { x: 0, y: 0, scale: 1 }
		new CanvasController(store, { measure, ask: async () => true }).doubleClick(press(400, 300))
		expect(store.objects.value).toHaveLength(0)
	})
})
