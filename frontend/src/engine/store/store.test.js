import { describe, expect, it, vi } from "vitest"
import { createDocument } from "../model/schema"
import { createObject } from "../model/factories"
import { History } from "./history"
import { createStore } from "./createStore"

const shape = (over = {}) => ({
	...createObject("rectangle", { x: 0, y: 0, w: 100, h: 60 }, { theme: "ocean", z: 1 }),
	...over,
})
const storeWith = (...objects) => createStore({ ...createDocument(), objects })

describe("store operations", () => {
	it("adds, updates and removes objects, in z order", () => {
		const store = createStore(createDocument())
		const a = shape({ id: "a", z: 2 })
		const b = shape({ id: "b", z: 1 })
		store.addObjects([a, b])
		expect(store.objects.value.map((o) => o.id)).toEqual(["b", "a"])
		store.updateObjects([{ id: "a", patch: { z: 0, x: 40 } }])
		expect(store.objects.value.map((o) => o.id)).toEqual(["a", "b"])
		expect(store.getObject("a").x).toBe(40)
		store.removeObjects(["b"])
		expect(store.getObject("b")).toBeNull()
		expect(store.nextZ()).toBe(1)
	})

	it("replaces an object instead of editing it, so unchanged ones keep their identity", () => {
		const store = storeWith(shape({ id: "a" }), shape({ id: "b" }))
		const before = { a: store.getObject("a"), b: store.getObject("b") }
		store.updateObjects([{ id: "a", patch: { x: 5 } }])
		expect(store.getObject("a")).not.toBe(before.a)
		expect(store.getObject("b")).toBe(before.b)
		expect(before.a.x).toBe(0)
	})

	it("refuses a duplicate id and ignores edits to objects that are gone", () => {
		const store = storeWith(shape({ id: "a" }))
		expect(() => store.addObjects([shape({ id: "a" })])).toThrow(/already exists/)
		expect(store.updateObjects([{ id: "missing", patch: { x: 1 } }])).toBe(false)
		expect(store.removeObjects(["missing"])).toBe(false)
	})

	it("changes canvas and theme settings as undoable operations", () => {
		const store = createStore(createDocument())
		store.setCanvas({ grid: "dense" })
		store.setTheme("violet")
		expect(store.canvas.value.grid).toBe("dense")
		expect(store.theme.value.preset).toBe("violet")
		store.undo()
		store.undo()
		expect(store.canvas.value.grid).toBe("off")
		expect(store.theme.value.preset).toBe("ocean")
	})

	it("snapshots the document for saving", () => {
		const store = storeWith(shape({ id: "a" }))
		store.setCanvas({ background: "#ffeecc" })
		const doc = store.snapshot()
		expect(doc.schemaVersion).toBe(1)
		expect(doc.canvas.background).toBe("#ffeecc")
		expect(doc.objects).toHaveLength(1)
		expect(doc.connectors).toEqual([])
	})
})

describe("undo and redo", () => {
	it("undoes and redoes add, update and delete", () => {
		const store = createStore(createDocument())
		store.addObjects([shape({ id: "a" })])
		store.updateObjects([{ id: "a", patch: { x: 50 } }])
		store.removeObjects(["a"])
		expect(store.objects.value).toHaveLength(0)
		store.undo()
		expect(store.getObject("a").x).toBe(50)
		store.undo()
		expect(store.getObject("a").x).toBe(0)
		store.undo()
		expect(store.objects.value).toHaveLength(0)
		store.redo()
		store.redo()
		store.redo()
		expect(store.objects.value).toHaveLength(0)
		expect(store.canRedo).toBe(false)
	})

	it("makes everything in a transaction one step", () => {
		const store = storeWith(shape({ id: "a" }), shape({ id: "b", z: 2 }))
		store.transact("Both", () => {
			store.updateObjects([{ id: "a", patch: { x: 1 } }])
			store.updateObjects([{ id: "b", patch: { x: 2 } }])
		})
		expect(store.history.undoStack).toHaveLength(1)
		store.undo()
		expect([store.getObject("a").x, store.getObject("b").x]).toEqual([0, 0])
	})

	it("drops the redo stack when something new is done", () => {
		const store = storeWith(shape({ id: "a" }))
		store.updateObjects([{ id: "a", patch: { x: 1 } }])
		store.undo()
		expect(store.canRedo).toBe(true)
		store.updateObjects([{ id: "a", patch: { x: 2 } }])
		expect(store.canRedo).toBe(false)
	})

	it("restores the selection that went with an action", () => {
		const store = createStore(createDocument())
		store.addObjects([shape({ id: "a" })])
		expect(store.state.selection).toEqual(["a"])
		store.removeObjects(["a"])
		expect(store.state.selection).toEqual([])
		store.undo()
		expect(store.state.selection).toEqual(["a"])
		store.undo()
		expect(store.state.selection).toEqual([])
	})

	it("keeps at most one hundred steps", () => {
		const store = storeWith(shape({ id: "a" }))
		for (let i = 1; i <= 120; i++) store.updateObjects([{ id: "a", patch: { x: i } }])
		expect(store.history.undoStack).toHaveLength(100)
		let steps = 0
		while (store.undo()) steps++
		expect(steps).toBe(100)
		expect(store.getObject("a").x).toBe(20)
	})

	it("merges quick repeated steps with the same coalesce key", () => {
		const history = new History()
		const entry = (n) => ({ label: "Move", coalesce: "nudge", redo: [n], undo: [-n] })
		history.push(entry(1), 1000)
		history.push(entry(2), 1300)
		history.push(entry(3), 3000) // too late: a new step
		history.push({ label: "Other", redo: [9], undo: [-9] }, 3100)
		expect(history.undoStack).toHaveLength(3)
		expect(history.undoStack[0].redo).toEqual([1, 2])
		expect(history.undoStack[0].undo).toEqual([-1, -2])
	})

	it("undoes a run of nudges in one go", () => {
		const store = storeWith(shape({ id: "a" }))
		for (let i = 0; i < 10; i++) store.moveBy(["a"], 1, 0, { coalesce: "nudge" })
		expect(store.getObject("a").x).toBe(10)
		store.undo()
		expect(store.getObject("a").x).toBe(0)
	})
})

describe("gestures", () => {
	it("turns many live updates into one undo step, with no history while dragging", () => {
		const store = storeWith(shape({ id: "a" }))
		const gesture = store.beginGesture(["a"])
		for (let i = 1; i <= 30; i++) gesture.set([{ id: "a", patch: { x: i, y: i * 2 } }])
		expect(store.history.undoStack).toHaveLength(0)
		expect(gesture.commit("Move")).toBe(true)
		expect(store.history.undoStack).toHaveLength(1)
		store.undo()
		expect([store.getObject("a").x, store.getObject("a").y]).toEqual([0, 0])
		store.redo()
		expect([store.getObject("a").x, store.getObject("a").y]).toEqual([30, 60])
	})

	it("records nothing when the drag ended where it began", () => {
		const store = storeWith(shape({ id: "a" }))
		const gesture = store.beginGesture(["a"])
		gesture.set([{ id: "a", patch: { x: 50 } }])
		gesture.set([{ id: "a", patch: { x: 0 } }])
		expect(gesture.commit()).toBe(false)
		expect(store.history.undoStack).toHaveLength(0)
	})

	it("puts everything back on cancel", () => {
		const store = storeWith(shape({ id: "a" }))
		const gesture = store.beginGesture(["a"])
		gesture.set([{ id: "a", patch: { x: 99 } }])
		gesture.cancel()
		expect(store.getObject("a").x).toBe(0)
	})

	it("only notifies savers about the finished change, not the drag", () => {
		const store = storeWith(shape({ id: "a" }))
		const seen = []
		store.subscribe((event) => seen.push(event.type))
		const gesture = store.beginGesture(["a"])
		gesture.set([{ id: "a", patch: { x: 1 } }])
		gesture.set([{ id: "a", patch: { x: 2 } }])
		gesture.commit()
		expect(seen).toEqual(["live", "live", "change"])
	})
})

describe("selection, duplicate and read-only", () => {
	it("selects, toggles and ignores ids that do not exist", () => {
		const store = storeWith(shape({ id: "a" }), shape({ id: "b", z: 2 }))
		store.select(["a", "ghost"])
		expect(store.state.selection).toEqual(["a"])
		store.toggleSelection("b")
		expect(store.state.selection).toEqual(["a", "b"])
		store.toggleSelection("a")
		expect(store.state.selection).toEqual(["b"])
		store.clearSelection()
		expect(store.state.selection).toEqual([])
	})

	it("duplicates with an offset, new ids, on top, selected, as one step", () => {
		const store = storeWith(
			shape({ id: "a", x: 10, y: 10 }),
			shape({ id: "b", x: 50, y: 50, z: 2 }),
		)
		const ids = store.duplicate(["a", "b"])
		expect(ids).toHaveLength(2)
		expect(new Set([...ids, "a", "b"]).size).toBe(4)
		const copy = store.getObject(ids[0])
		expect([copy.x, copy.y]).toEqual([20, 20])
		expect(copy.z).toBeGreaterThan(store.getObject("b").z)
		expect(store.state.selection).toEqual(ids)
		store.undo()
		expect(store.objects.value).toHaveLength(2)
	})

	it("duplicates deeply, so editing a copy never touches the original", () => {
		const store = storeWith(shape({ id: "a" }))
		const [copyId] = store.duplicate(["a"])
		expect(store.getObject(copyId).style).not.toBe(store.getObject("a").style)
	})

	it("refuses every change while read-only", () => {
		const store = createStore(
			{ ...createDocument(), objects: [shape({ id: "a" })] },
			{ readonly: true },
		)
		expect(store.addObjects([shape({ id: "b" })])).toBe(false)
		expect(store.updateObjects([{ id: "a", patch: { x: 1 } }])).toBe(false)
		expect(store.removeObjects(["a"])).toBe(false)
		expect(store.setCanvas({ grid: "dense" })).toBe(false)
		expect(store.duplicate(["a"])).toEqual([])
		const listener = vi.fn()
		store.subscribe(listener)
		store.beginGesture(["a"]).set([{ id: "a", patch: { x: 5 } }])
		expect(store.getObject("a").x).toBe(0)
		expect(listener).not.toHaveBeenCalled()
		store.setReadonly(false)
		expect(store.updateObjects([{ id: "a", patch: { x: 1 } }])).toBe(true)
	})
})
