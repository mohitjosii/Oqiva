import { describe, expect, it } from "vitest"
import { CanvasController } from "../interaction/controller"
import { visibleRect } from "../geometry/viewport"
import { createDocument } from "../model/schema"
import { createStore } from "../store/createStore"

const measure = (text, style) => text.length * style.size * 0.5

function setup() {
	const store = createStore(createDocument())
	store.state.size = { width: 1000, height: 800 }
	store.state.viewport = { x: 0, y: 0, scale: 1 }
	return { store, controller: new CanvasController(store, { measure, ask: async () => true }) }
}

describe("showing a new diagram", () => {
	it("scrolls to one that fits the screen without changing the zoom", () => {
		const { store, controller } = setup()
		controller.showRect({ x: 3000, y: 2000, w: 400, h: 300 })
		expect(store.state.viewport.scale).toBe(1)
		const view = visibleRect(store.state.viewport, store.state.size)
		expect(view.x).toBeLessThan(3000)
		expect(view.x + view.w).toBeGreaterThan(3400)
	})

	it("zooms out to show all of one bigger than the screen", () => {
		const { store, controller } = setup()
		const rect = { x: 100, y: 100, w: 500, h: 6000 }
		controller.showRect(rect)
		expect(store.state.viewport.scale).toBeLessThan(0.2)
		const view = visibleRect(store.state.viewport, store.state.size)
		expect(view.x).toBeLessThanOrEqual(rect.x)
		expect(view.y).toBeLessThanOrEqual(rect.y)
		expect(view.y + view.h).toBeGreaterThanOrEqual(rect.y + rect.h)
		expect(view.x + view.w).toBeGreaterThanOrEqual(rect.x + rect.w)
	})

	it("leaves a diagram already in view alone", () => {
		const { store, controller } = setup()
		const before = { ...store.state.viewport }
		controller.showRect({ x: 100, y: 100, w: 300, h: 200 })
		expect(store.state.viewport).toEqual(before)
	})
})
