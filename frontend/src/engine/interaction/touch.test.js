import { beforeEach, describe, expect, it } from "vitest"
import { createDocument } from "../model/schema"
import { createObject } from "../model/factories"
import { createStore } from "../store/createStore"
import { CanvasController } from "./controller"
import { createPinch } from "./touch"

const measure = (text, style) => text.length * (style?.size || 16) * 0.5
const finger = (id, x, y, over = {}) => ({
	pointerId: id,
	pointerType: "touch",
	clientX: x,
	clientY: y,
	button: 0,
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	...over,
})

describe("the pinch tracker", () => {
	it("says nothing for one finger, and the pan and zoom for two", () => {
		const pinch = createPinch()
		pinch.down(1, { x: 100, y: 100 })
		expect(pinch.move(1, { x: 110, y: 100 })).toBeNull()
		pinch.down(2, { x: 200, y: 100 })
		const spread = pinch.move(2, { x: 300, y: 100 }) // fingers 110 apart -> 190 apart
		expect(spread.ratio).toBeCloseTo(190 / 90, 5)
		expect(spread.center).toEqual({ x: 205, y: 100 })
		const slide = pinch.move(1, { x: 120, y: 120 })
		expect(slide.dy).toBe(10)
		pinch.up(2)
		expect(pinch.move(1, { x: 130, y: 120 })).toBeNull() // one finger again
	})

	it("ignores fingers it was never told about, and tiny distances", () => {
		const pinch = createPinch()
		expect(pinch.move(9, { x: 1, y: 1 })).toBeNull()
		pinch.down(1, { x: 10, y: 10 })
		pinch.down(2, { x: 11, y: 10 })
		expect(pinch.move(2, { x: 12, y: 10 }).ratio).toBe(1) // too close to tell
	})
})

describe("touching the board", () => {
	let store
	let controller
	beforeEach(() => {
		store = createStore({
			...createDocument(),
			objects: [
				{
					...createObject(
						"rectangle",
						{ x: 100, y: 100, w: 100, h: 60 },
						{ theme: "ocean", z: 1 },
					),
					id: "a",
				},
			],
		})
		store.state.size = { width: 1000, height: 700 }
		controller = new CanvasController(store, { measure })
	})

	it("one finger drags a shape as a mouse does", () => {
		controller.pointerDown(finger(1, 150, 130))
		controller.pointerMove(finger(1, 250, 130))
		controller.pointerUp(finger(1, 250, 130))
		expect(store.getObject("a").x).toBe(200)
	})

	it("a second finger abandons the drag and zooms and pans the board instead", () => {
		const before = store.getObject("a").x
		controller.pointerDown(finger(1, 150, 130))
		controller.pointerMove(finger(1, 170, 130)) // a drag has begun
		controller.pointerDown(finger(2, 350, 130)) // second finger: now a pinch
		expect(controller.drag).toBeNull()
		controller.pointerMove(finger(2, 550, 130)) // spreading: the distance doubles
		expect(store.state.viewport.scale).toBeGreaterThan(1.5)
		controller.pointerMove(finger(1, 190, 170)) // sliding pans
		controller.pointerUp(finger(2, 550, 130))
		controller.pointerMove(finger(1, 400, 400)) // the finger left down does nothing now
		controller.pointerUp(finger(1, 400, 400))
		expect(store.getObject("a").x).toBe(before)
		expect(store.history.undoStack).toHaveLength(0) // nothing was changed on the board
	})

	it("after both fingers lift, the next touch drags again", () => {
		controller.pointerDown(finger(1, 150, 130))
		controller.pointerDown(finger(2, 350, 130))
		controller.pointerUp(finger(1, 150, 130))
		controller.pointerUp(finger(2, 350, 130))
		const { x: viewX, scale } = store.state.viewport
		const at = (x, y) => ({ x: x * scale + viewX, y: y * scale + store.state.viewport.y })
		const from = at(150, 130)
		const to = at(250, 130)
		controller.pointerDown(finger(3, from.x, from.y))
		controller.pointerMove(finger(3, to.x, to.y))
		controller.pointerUp(finger(3, to.x, to.y))
		expect(store.getObject("a").x).toBe(200)
	})

	it("a cancelled touch leaves nothing half done", () => {
		controller.pointerDown(finger(1, 150, 130))
		controller.pointerDown(finger(2, 350, 130))
		controller.pointerCancel(finger(2, 350, 130))
		controller.pointerDown(finger(4, 150, 130))
		controller.pointerMove(finger(4, 250, 130))
		controller.pointerUp(finger(4, 250, 130))
		expect(store.getObject("a").x).toBe(200)
	})

	it("a mouse is not affected", () => {
		controller.pointerDown({ ...finger(1, 150, 130), pointerType: "mouse" })
		controller.pointerMove({ ...finger(1, 250, 130), pointerType: "mouse" })
		controller.pointerUp({ ...finger(1, 250, 130), pointerType: "mouse" })
		expect(store.getObject("a").x).toBe(200)
	})
})
