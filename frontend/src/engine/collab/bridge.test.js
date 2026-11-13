import * as Y from "yjs"
import { describe, expect, it } from "vitest"
import { createConnector, createObject } from "../model/factories"
import { createDocument } from "../model/schema"
import { createStore } from "../store/createStore"
import { createBridge } from "./bridge"
import { decodeState, encodeState, hasChangesSince, seedUpdate, snapshotFromDoc } from "./ydoc"

const box = (id, x = 0, y = 0, over = {}) => ({
	...createObject("rectangle", { x, y, w: 100, h: 60 }, { theme: "ocean", z: 1 }),
	id,
	...over,
})
const flush = () => new Promise((resolve) => queueMicrotask(resolve))
const settle = async () => {
	await flush()
	await flush()
}

// Two people with their own store and Yjs document, joined by a wire we can cut and mend.
function pair(objects = [], connectors = []) {
	const snapshot = {
		...createDocument(),
		objects: objects.map((o, i) => ({ ...o, z: i + 1 })),
		connectors,
	}
	const people = []
	for (const name of ["a", "b"]) {
		const doc = new Y.Doc()
		Y.applyUpdate(doc, seedUpdate(snapshot))
		const store = createStore(snapshotFromDoc(doc, snapshot))
		store.state.size = { width: 1000, height: 700 }
		const bridge = createBridge(store, doc)
		people.push({ name, doc, store, bridge })
	}
	const [a, b] = people
	const wire = { connected: true }
	const send = (from, to) =>
		from.doc.on("update", (update, origin) => {
			if (wire.connected && origin !== "wire") Y.applyUpdate(to.doc, update, "wire")
		})
	send(a, b)
	send(b, a)
	wire.mend = () => {
		wire.connected = true
		Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)), "wire")
		Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)), "wire")
	}
	wire.cut = () => (wire.connected = false)
	return { a, b, wire }
}

const ids = (store) => store.objects.value.map((o) => o.id).sort()

describe("the same content in every browser", () => {
	it("seeding is deterministic, so two browsers that seed on their own agree and add up to one copy", () => {
		const snapshot = {
			...createDocument(),
			objects: [box("b", 10), box("a", 0)].map((o, i) => ({ ...o, z: i + 1 })),
		}
		expect(
			Y.encodeStateAsUpdate(Y.applyUpdate(new Y.Doc(), seedUpdate(snapshot)) ?? new Y.Doc()),
		).toBeTruthy()
		expect(Array.from(seedUpdate(snapshot))).toEqual(Array.from(seedUpdate(snapshot)))
		const one = new Y.Doc()
		const two = new Y.Doc()
		Y.applyUpdate(one, seedUpdate(snapshot))
		Y.applyUpdate(two, seedUpdate(snapshot))
		Y.applyUpdate(one, Y.encodeStateAsUpdate(two))
		Y.applyUpdate(two, Y.encodeStateAsUpdate(one))
		expect(snapshotFromDoc(one, snapshot).objects).toHaveLength(2)
		expect(snapshotFromDoc(one, snapshot)).toEqual(snapshotFromDoc(two, snapshot))
	})

	it("the document rebuilds the board it was seeded from, through the same sanitising as a load", () => {
		const snapshot = { ...createDocument(), objects: [box("a", 5, 6)], connectors: [] }
		const doc = new Y.Doc()
		Y.applyUpdate(doc, seedUpdate(snapshot))
		const rebuilt = snapshotFromDoc(doc, snapshot)
		expect(rebuilt.objects[0]).toMatchObject({ id: "a", x: 5, y: 6, kind: "shape" })
		doc.getMap("objects").get("a").set("fill", "url(javascript:x)")
		doc.getMap("objects").get("a").set("x", "far")
		expect(snapshotFromDoc(doc, snapshot).objects[0].x).toBe(0) // junk from a peer is put right, not believed
	})

	it("state travels as text and back", () => {
		const doc = new Y.Doc()
		Y.applyUpdate(doc, seedUpdate({ ...createDocument(), objects: [box("a")] }))
		const text = encodeState(doc)
		expect(text).toMatch(/^[A-Za-z0-9+/]+=*$/)
		const copy = new Y.Doc()
		Y.applyUpdate(copy, decodeState(text))
		expect(copy.getMap("objects").has("a")).toBe(true)
	})

	it("knows when a document holds changes made since a baseline, such as work restored from this device", () => {
		const doc = new Y.Doc()
		Y.applyUpdate(doc, seedUpdate({ ...createDocument(), objects: [box("a")] }))
		const baseline = Y.encodeStateVector(doc)
		expect(hasChangesSince(doc, baseline)).toBe(false) // a board nobody edited has nothing to save
		doc.getMap("objects").get("a").set("x", 99)
		expect(hasChangesSince(doc, baseline)).toBe(true)
		const removed = new Y.Doc()
		Y.applyUpdate(removed, Y.encodeStateAsUpdate(doc))
		const later = Y.encodeStateVector(removed)
		removed.getMap("objects").delete("a")
		expect(hasChangesSince(removed, later)).toBe(true) // a deletion counts
	})
})

describe("a damaged shared document", () => {
	it("never crashes the editor: an item that is not a map is ignored and the rest still arrives", async () => {
		const { a, b } = pair([box("one")])
		const objects = a.doc.getMap("objects")
		a.doc.transact(() => {
			objects.set("junk-text", "just a string")
			objects.set("junk-list", new Y.Array())
			objects.set("junk-number", 7)
		}, "someone-else")
		a.store.addObjects([box("two", 300, 0, { z: 2 })], { label: "Add" })
		await settle()
		expect(() => snapshotFromDoc(b.doc, createDocument())).not.toThrow()
		expect(b.store.objects.value.map((o) => o.id).sort()).toEqual(["one", "two"])
	})

	it("reads a document with such items back without them", () => {
		const doc = new Y.Doc()
		Y.applyUpdate(doc, seedUpdate({ ...createDocument(), objects: [box("keep")] }))
		doc.getMap("objects").set("bad", 12)
		const snapshot = snapshotFromDoc(doc, createDocument())
		expect(snapshot.objects.map((o) => o.id)).toEqual(["keep"])
	})
})

describe("changes flow both ways", () => {
	it("a shape one person adds, moves, restyles and deletes appears, changes and goes for the other", async () => {
		const { a, b } = pair([box("s", 0, 0)])
		a.store.addObjects([box("n", 200, 0, { z: 5 })])
		await settle()
		expect(ids(b.store)).toEqual(["n", "s"])
		a.store.updateObjects([{ id: "n", patch: { x: 300 } }])
		await settle()
		expect(b.store.getObject("n").x).toBe(300)
		a.store.updateObjects([
			{ id: "s", patch: { style: { ...a.store.getObject("s").style, fill: "#FEE2E2" } } },
		])
		await settle()
		expect(b.store.getObject("s").style.fill).toBe("#FEE2E2")
		a.store.removeObjects(["n"])
		await settle()
		expect(ids(b.store)).toEqual(["s"])
	})

	it("a gesture that moves several shapes arrives as the finished move", async () => {
		const { a, b } = pair([box("p", 0), box("q", 200)])
		const gesture = a.store.beginGesture(["p", "q"])
		gesture.set([
			{ id: "p", patch: { x: 50 } },
			{ id: "q", patch: { x: 250 } },
		])
		await settle()
		expect(b.store.getObject("p").x).toBe(0) // nothing is shared until the move ends
		gesture.commit("Move")
		await settle()
		expect([b.store.getObject("p").x, b.store.getObject("q").x]).toEqual([50, 250])
	})

	it("changes from the other person never enter this person's undo history, nor mark the board changed", async () => {
		const { a, b } = pair([box("s")])
		const events = []
		b.store.subscribe((event) => events.push(event))
		a.store.updateObjects([{ id: "s", patch: { x: 40 } }])
		await settle()
		expect(b.store.history.undoStack).toHaveLength(0)
		expect(events.map((e) => e.origin)).toEqual(["remote"])
		expect(b.store.canUndo).toBe(false)
		expect(a.store.canUndo).toBe(true)
	})

	it("undo and redo reach the other person too", async () => {
		const { a, b } = pair([box("s")])
		a.store.addObjects([box("n", 100, 0, { z: 3 })])
		await settle()
		a.store.undo()
		await settle()
		expect(ids(b.store)).toEqual(["s"])
		a.store.redo()
		await settle()
		expect(ids(b.store)).toEqual(["n", "s"])
	})

	it("lines, canvas settings and the theme travel too", async () => {
		const { a, b } = pair([box("p", 0), box("q", 300)])
		a.store.addItems({
			connectors: [
				createConnector({
					from: { objectId: "p", anchor: "e" },
					to: { objectId: "q", anchor: "w" },
					theme: "ocean",
					z: 1,
				}),
			],
		})
		a.store.setCanvas({ mode: "preset", preset: "4:3", grid: "dense" })
		a.store.setTheme("violet")
		await settle()
		expect(b.store.connectors.value).toHaveLength(1)
		expect(b.store.canvas.value).toMatchObject({ mode: "preset", preset: "4:3", grid: "dense" })
		expect(b.store.theme.value.preset).toBe("violet")
	})

	it("a selection the other person deleted is dropped from this person's selection", async () => {
		const { a, b } = pair([box("s"), box("t", 200)])
		b.store.select(["s", "t"])
		a.store.removeObjects(["s"])
		await settle()
		expect(b.store.state.selection).toEqual(["t"])
	})
})

describe("two people at once", () => {
	it("different fields of one shape both win: one moves it while the other recolours it", async () => {
		const { a, b, wire } = pair([box("s")])
		wire.cut()
		a.store.updateObjects([{ id: "s", patch: { x: 500 } }])
		b.store.updateObjects([
			{ id: "s", patch: { style: { ...b.store.getObject("s").style, fill: "#DBEAFE" } } },
		])
		wire.mend()
		await settle()
		for (const person of [a, b]) {
			expect(person.store.getObject("s").x).toBe(500)
			expect(person.store.getObject("s").style.fill).toBe("#DBEAFE")
		}
	})

	it("the same field changed by both settles on one value for both", async () => {
		const { a, b, wire } = pair([box("s")])
		wire.cut()
		a.store.updateObjects([{ id: "s", patch: { x: 111 } }])
		b.store.updateObjects([{ id: "s", patch: { x: 222 } }])
		wire.mend()
		await settle()
		expect(a.store.getObject("s").x).toBe(b.store.getObject("s").x)
		expect([111, 222]).toContain(a.store.getObject("s").x)
	})

	it("shapes drawn while apart are all there once the link is back (the merge T5.6 relies on)", async () => {
		const { a, b, wire } = pair([box("s")])
		wire.cut()
		a.store.addObjects([box("fromA1", 100, 0, { z: 2 }), box("fromA2", 100, 100, { z: 3 })])
		b.store.addObjects([box("fromB", 300, 0, { z: 4 })])
		wire.mend()
		await settle()
		expect(ids(a.store)).toEqual(["fromA1", "fromA2", "fromB", "s"])
		expect(ids(b.store)).toEqual(ids(a.store))
	})

	it("deleting a shape wins over a change to it made by the other person", async () => {
		const { a, b, wire } = pair([box("s"), box("t", 200)])
		wire.cut()
		a.store.removeObjects(["s"])
		b.store.updateObjects([{ id: "s", patch: { x: 77 } }])
		wire.mend()
		await settle()
		expect(ids(a.store)).toEqual(["t"])
		expect(ids(b.store)).toEqual(["t"])
	})

	it("a line one person attached to a shape the other deleted goes away for both", async () => {
		const { a, b, wire } = pair([box("p", 0), box("q", 300)])
		wire.cut()
		a.store.removeObjects(["q"])
		b.store.addItems({
			connectors: [
				createConnector({
					from: { objectId: "p", anchor: "e" },
					to: { objectId: "q", anchor: "w" },
					theme: "ocean",
					z: 1,
				}),
			],
		})
		wire.mend()
		await settle()
		await settle()
		expect(a.store.connectors.value).toHaveLength(0)
		expect(b.store.connectors.value).toHaveLength(0)
		expect(a.doc.getMap("connectors").size).toBe(0)
	})

	it("both browsers end with the same board, however the changes interleave", async () => {
		const { a, b, wire } = pair([box("s", 0), box("t", 200)])
		wire.cut()
		a.store.updateObjects([{ id: "s", patch: { x: 1, rotation: 30 } }])
		a.store.removeObjects(["t"])
		b.store.updateObjects([{ id: "s", patch: { y: 9, w: 150 } }])
		b.store.addObjects([box("u", 400, 0, { z: 9 })])
		wire.mend()
		await settle()
		expect(JSON.stringify(a.store.snapshot())).toBe(JSON.stringify(b.store.snapshot()))
	})
})

describe("what a peer sends is not trusted", () => {
	it("an invalid shape from a peer is refused, not drawn", async () => {
		const { a, b } = pair([box("s")])
		a.doc.transact(() => {
			const bad = new Y.Map()
			bad.set("id", "bad")
			bad.set("kind", "shape")
			bad.set("x", "not a number")
			bad.set("w", 100)
			a.doc.getMap("objects").set("bad<script>", bad)
		}, "peer")
		await settle()
		expect(ids(a.store)).toEqual(["s"])
		void b
	})

	it("a field set to an unsafe value is put back to a safe one", async () => {
		const { a } = pair([box("s")])
		a.doc.transact(
			() =>
				a.doc
					.getMap("objects")
					.get("s")
					.set("style", { fill: "url(//evil)", stroke: "#000000", strokeWidth: 999 }),
			"peer",
		)
		await settle()
		const style = a.store.getObject("s").style
		expect(style.fill).toBeNull()
		expect(style.strokeWidth).toBeLessThanOrEqual(20)
	})

	it("unknown kinds from a newer version are kept", async () => {
		const { a } = pair([box("s")])
		a.doc.transact(() => {
			const map = new Y.Map()
			map.set("id", "newkind")
			map.set("kind", "hologram")
			map.set("z", 9)
			a.doc.getMap("objects").set("newkind", map)
		}, "peer")
		await settle()
		expect(ids(a.store)).toContain("newkind")
	})
})
