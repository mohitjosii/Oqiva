import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createObject } from "../model/factories"
import { createDocument } from "../model/schema"
import { createStore } from "../store/createStore"
import { createBridge } from "./bridge"
import { createPresence } from "./presence"
import { createProvider, MAX_SYNC_BYTES } from "./provider"
import { seedUpdate, snapshotFromDoc } from "./ydoc"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const settle = async () => {
	for (let i = 0; i < 15; i++) await tick() // each hop through the relay takes a tick
}
const box = (id, x = 0, over = {}) => ({
	...createObject("rectangle", { x, y: 0, w: 100, h: 60 }, { theme: "ocean", z: 1 }),
	id,
	...over,
})

// A stand-in for the relay (realtime/handlers.js, tested for real in realtime/harness): the same
// rules about who joins and who may write, with sockets that live in memory.
function relay(access) {
	const sockets = []
	let counter = 0
	return {
		access,
		sockets,
		// The connection breaks: the person hears "disconnect", and the relay tells the room they left.
		drop(socket) {
			socket.connected = false
			socket.deliver("disconnect")
			sockets
				.filter((s) => s !== socket && s.room === socket.room && s.connected)
				.forEach((s) => s.deliver("oqiva:peer_left", { board: socket.room, id: socket.id }))
		},
		socket(user) {
			const id = `sock${++counter}`
			const listeners = new Map()
			const socket = {
				id,
				user,
				connected: true,
				room: null,
				on: (event, fn) => listeners.set(event, [...(listeners.get(event) || []), fn]),
				off: (event, fn) =>
					listeners.set(
						event,
						(listeners.get(event) || []).filter((f) => f !== fn),
					),
				deliver: (event, message) =>
					(listeners.get(event) || []).forEach((fn) => fn(message)),
				emit: (event, message, ack) => {
					if (!socket.connected) return
					setTimeout(() => handle(socket, event, message, ack), 0)
				},
				sent: [],
			}
			sockets.push(socket)
			return socket
		},
	}
	function handle(socket, event, message, ack) {
		socket.sent.push({ event, message })
		const level = access[socket.user] ?? null
		const others = sockets.filter(
			(s) => s !== socket && s.room === socket.room && s.connected && socket.room,
		)
		if (event === "oqiva:join") {
			if (!level) return ack?.({ access: null })
			socket.room = message.board
			return ack?.({ access: level, id: socket.id, peers: others.map((s) => s.id) })
		}
		if (event === "oqiva:leave") {
			socket.room = null
			others.forEach((s) =>
				s.deliver("oqiva:peer_left", { board: message.board, id: socket.id }),
			)
		}
		if (!socket.room) return
		if (event === "oqiva:sync") {
			if (message.kind !== "step1" && level !== "edit") return
			const out = { ...message, from: socket.id }
			const targets = message.to ? others.filter((s) => s.id === message.to) : others
			targets.forEach((s) => s.deliver("oqiva:sync", out))
		}
		if (event === "oqiva:awareness")
			others.forEach((s) => s.deliver("oqiva:awareness", { ...message, from: socket.id }))
	}
}

function person(net, name, snapshot, { user = name, ...options } = {}) {
	const doc = new Y.Doc()
	Y.applyUpdate(doc, seedUpdate(snapshot))
	const store = createStore(snapshotFromDoc(doc, snapshot))
	const awareness = new Awareness(doc)
	const presence = createPresence({
		user: { id: name, name: name.toUpperCase() },
		store,
		awareness,
	})
	createBridge(store, doc)
	const socket = net.socket(user)
	const seen = { status: [], access: [], saved: [], resync: [], tooLarge: 0 }
	const provider = createProvider({
		doc,
		awareness,
		socket,
		board: "b1",
		maxBytes: options.maxBytes,
		onStatus: (s) => seen.status.push(s),
		onAccess: (a) => seen.access.push(a),
		onSaved: (m) => seen.saved.push(m),
		onResync: (m) => seen.resync.push(m),
		onTooLarge: () => seen.tooLarge++,
	})
	return { name, doc, store, awareness, presence, socket, provider, seen }
}

const base = (...objects) => ({
	...createDocument(),
	objects: objects.map((o, i) => ({ ...o, z: i + 1 })),
})
const ids = (p) => p.store.objects.value.map((o) => o.id).sort()
afterEach(() => vi.useRealTimers())

describe("joining and syncing", () => {
	it("two editors that each made changes before meeting end up with both sets", async () => {
		const net = relay({ a: "edit", b: "edit" })
		const snapshot = base(box("s"))
		const a = person(net, "a", snapshot)
		a.store.addObjects([box("fromA", 100, { z: 2 })]) // done before anyone else was here
		const b = person(net, "b", snapshot)
		b.store.addObjects([box("fromB", 300, { z: 3 })])
		await settle()
		expect(ids(a)).toEqual(["fromA", "fromB", "s"])
		expect(ids(b)).toEqual(["fromA", "fromB", "s"])
		expect(a.seen.status).toEqual(["connected"])
		expect(a.seen.access).toEqual(["edit"])
	})

	it("changes made later travel at once, in both directions", async () => {
		const net = relay({ a: "edit", b: "edit" })
		const a = person(net, "a", base(box("s")))
		const b = person(net, "b", base(box("s")))
		await settle()
		a.store.updateObjects([{ id: "s", patch: { x: 40 } }])
		await settle()
		expect(b.store.getObject("s").x).toBe(40)
		b.store.addObjects([box("n", 200, { z: 4 })])
		await settle()
		expect(ids(a)).toEqual(["n", "s"])
	})

	it("someone who may only view receives everything and sends nothing", async () => {
		const net = relay({ a: "edit", v: "view", c: "comment" })
		const a = person(net, "a", base(box("s")))
		const v = person(net, "v", base(box("s")))
		const c = person(net, "c", base(box("s")))
		await settle()
		a.store.updateObjects([{ id: "s", patch: { x: 70 } }])
		await settle()
		expect(v.store.getObject("s").x).toBe(70)
		expect(c.store.getObject("s").x).toBe(70)
		const writes = (p) =>
			p.socket.sent.filter((m) => m.event === "oqiva:sync" && m.message.kind !== "step1")
		expect(writes(v)).toHaveLength(0)
		expect(writes(c)).toHaveLength(0)
		// even a tampered document of theirs sends nothing
		v.doc.transact(() => v.doc.getMap("objects").get("s").set("x", 999), "tamper")
		await settle()
		expect(writes(v)).toHaveLength(0)
		expect(a.store.getObject("s").x).toBe(70)
	})

	it("a person with no access is denied, told so, and sends nothing", async () => {
		const net = relay({ a: "edit", x: null })
		const x = person(net, "x", base(box("s")), { user: "x" })
		await settle()
		expect(x.provider.status).toBe("denied")
		expect(x.seen.status).toEqual(["denied"])
		expect(x.socket.sent.map((m) => m.event)).toEqual(["oqiva:join"])
	})

	it("a payload over the limit is not sent; the caller is told instead", async () => {
		const net = relay({ a: "edit", b: "edit" })
		const a = person(net, "a", base(box("s")), { maxBytes: 200 })
		const b = person(net, "b", base(box("s")))
		await settle()
		a.store.updateObjects([
			{
				id: "s",
				patch: {
					text: {
						align: "left",
						size: 16,
						color: "#000000",
						paragraphs: [{ runs: [{ t: "x".repeat(2000) }] }],
					},
				},
			},
		])
		await settle()
		expect(a.seen.tooLarge).toBe(1)
		expect(b.store.getObject("s").text).toBeNull()
		expect(MAX_SYNC_BYTES).toBe(900 * 1024)
	})

	it("malformed messages from the network are ignored", async () => {
		const net = relay({ a: "edit" })
		const a = person(net, "a", base(box("s")))
		await settle()
		for (const message of [
			undefined,
			null,
			{},
			{ board: "other", kind: "update", data: new Uint8Array([1]) },
			{ board: "b1", kind: "update", data: new Uint8Array([255, 255, 255]) },
			{ board: "b1", kind: "bogus", data: new Uint8Array(3) },
		]) {
			a.socket.deliver("oqiva:sync", message)
			a.socket.deliver("oqiva:awareness", message)
		}
		expect(ids(a)).toEqual(["s"])
	})
})

describe("losing and regaining the connection", () => {
	it("work done by both while apart is merged when they meet again", async () => {
		const net = relay({ a: "edit", b: "edit" })
		const a = person(net, "a", base(box("s")))
		const b = person(net, "b", base(box("s")))
		await settle()
		net.drop(b.socket)
		expect(b.provider.status).toBe("offline")
		a.store.addObjects([box("fromA", 100, { z: 2 })])
		b.store.addObjects([box("fromB", 300, { z: 3 })])
		await settle()
		expect(ids(a)).toEqual(["fromA", "s"]) // nothing crossed while b was away
		b.socket.connected = true
		b.socket.deliver("connect")
		await settle()
		expect(ids(a)).toEqual(["fromA", "fromB", "s"])
		expect(ids(b)).toEqual(["fromA", "fromB", "s"])
		expect(b.provider.status).toBe("connected")
	})
})

describe("presence", () => {
	it("shows the others with their name, colour, pointer and selection, and not oneself", async () => {
		const net = relay({ a: "view", b: "edit" })
		const a = person(net, "a", base(box("s")))
		const b = person(net, "b", base(box("s")))
		await settle()
		b.presence.setCursor({ x: 10.4, y: 20.6 })
		b.presence.setSelection(["s"])
		await new Promise((resolve) => setTimeout(resolve, 80))
		await settle()
		expect(a.store.state.peers).toHaveLength(1)
		expect(a.store.state.peers[0]).toMatchObject({
			id: "b",
			name: "B",
			cursor: { x: 10, y: 21 },
			selection: ["s"],
		})
		expect(a.store.state.peers[0].color).toMatch(/^#[0-9A-F]{6}$/i)
		expect(b.store.state.peers.map((p) => p.id)).toEqual(["a"]) // someone who may only look is seen too
	})

	it("shows someone's laser pointer, from a person who may only look too, and puts it away", async () => {
		const net = relay({ a: "edit", b: "view" })
		const a = person(net, "a", base(box("s")))
		const b = person(net, "b", base(box("s")))
		await settle()
		b.presence.setLaser({ x: 40.2, y: 80.7 })
		await new Promise((resolve) => setTimeout(resolve, 80))
		await settle()
		expect(a.store.state.peers[0].laser).toEqual({ x: 40, y: 81 })
		expect(a.store.state.peers[0].cursor).toBeNull() // it is not the pointer
		b.presence.setLaser(null)
		await new Promise((resolve) => setTimeout(resolve, 80))
		await settle()
		expect(a.store.state.peers[0].laser).toBeNull()
	})

	it("drops someone who leaves or who loses the connection", async () => {
		const net = relay({ a: "edit", b: "edit" })
		const a = person(net, "a", base(box("s")))
		const b = person(net, "b", base(box("s")))
		await settle()
		expect(a.store.state.peers).toHaveLength(1)
		b.provider.destroy()
		await settle()
		expect(a.store.state.peers).toHaveLength(0)
		const c = person(net, "a", base(box("s")), { user: "b" })
		await settle()
		expect(a.store.state.peers.length).toBeGreaterThan(0)
		net.drop(c.socket)
		await settle()
		expect(a.store.state.peers).toHaveLength(0)
	})

	it("keeps the pointer's updates to about one every 50 ms", () => {
		vi.useFakeTimers()
		const doc = new Y.Doc()
		const awareness = new Awareness(doc)
		const store = createStore(createDocument())
		const presence = createPresence({
			user: { id: "a", name: "A" },
			store,
			awareness,
			now: () => Date.now(),
			schedule: setTimeout,
			cancel: clearTimeout,
		})
		const sent = []
		awareness.on("update", () => sent.push(awareness.getLocalState().cursor))
		for (let i = 1; i <= 40; i++) {
			presence.setCursor({ x: i, y: i })
			vi.advanceTimersByTime(5)
		}
		vi.advanceTimersByTime(100)
		expect(sent.length).toBeLessThanOrEqual(6)
		expect(sent.at(-1)).toEqual({ x: 40, y: 40 }) // the last position always arrives
		presence.setCursor(null)
		vi.advanceTimersByTime(100)
		expect(awareness.getLocalState().cursor).toBeNull()
	})

	it("treats what a peer says about itself as data: lengths are capped and odd values dropped", () => {
		const doc = new Y.Doc()
		const awareness = new Awareness(doc)
		const store = createStore(createDocument())
		createPresence({ user: { id: "me", name: "Me" }, store, awareness })
		const hostile = new Awareness(new Y.Doc())
		hostile.setLocalState({
			user: {
				id: "x".repeat(500),
				name: "n".repeat(500),
				color: "url(//evil)",
				image: "https://evil/x.png",
			},
			cursor: { x: "far", y: 1 },
			selection: ["ok", 5, {}],
		})
		const { encodeAwarenessUpdate, applyAwarenessUpdate } = awarenessApi
		applyAwarenessUpdate(awareness, encodeAwarenessUpdate(hostile, [hostile.clientID]), "peer")
		const [peer] = store.state.peers
		expect(peer.id.length).toBe(140)
		expect(peer.name.length).toBe(60)
		expect(peer.color).toMatch(/^#/)
		expect(peer.image).toBeNull()
		expect(peer.cursor).toBeNull()
		expect(peer.selection).toEqual(["ok"])
	})
})

describe("what the server announces", () => {
	it("a downgrade announced by the relay is reported, and writing stops", async () => {
		const net = relay({ a: "edit", b: "edit" })
		const a = person(net, "a", base(box("s")))
		const b = person(net, "b", base(box("s")))
		await settle()
		a.socket.deliver("oqiva:access_changed", { board: "b1", access: "view" })
		expect(a.seen.access.at(-1)).toBe("view")
		a.store.updateObjects([{ id: "s", patch: { x: 9 } }])
		await settle()
		expect(b.store.getObject("s").x).toBe(0)
		a.socket.deliver("oqiva:access_changed", { board: "b1", access: null })
		expect(a.provider.status).toBe("denied")
	})

	it("a change announced by the server makes the browser ask again", async () => {
		const net = relay({ a: "edit" })
		const a = person(net, "a", base(box("s")))
		await settle()
		net.access.a = "comment"
		a.socket.deliver("oqiva:access_changed", { board: "b1" })
		await settle()
		expect(a.provider.access).toBe("comment")
		expect(a.seen.access).toEqual(["edit", "comment"])
		a.socket.deliver("oqiva:access_changed", { board: "another-board" })
		await settle()
		expect(a.socket.sent.filter((m) => m.event === "oqiva:join")).toHaveLength(2)
	})

	it("saved and resync notices reach the caller, for this board only", async () => {
		const net = relay({ a: "edit" })
		const a = person(net, "a", base(box("s")))
		await settle()
		a.socket.deliver("oqiva:saved", { board: "b1", revision: 4, save_id: "x" })
		a.socket.deliver("oqiva:saved", { board: "zzz", revision: 9 })
		a.socket.deliver("oqiva:resync", { board: "b1" })
		a.socket.deliver("oqiva:resync", { board: "zzz" })
		expect(a.seen.saved).toEqual([{ board: "b1", revision: 4, save_id: "x" }])
		expect(a.seen.resync).toHaveLength(1)
	})
})

describe("leaving", () => {
	it("tells the relay, stops listening, and withdraws from everyone's view", async () => {
		const net = relay({ a: "edit", b: "edit" })
		const a = person(net, "a", base(box("s")))
		const b = person(net, "b", base(box("s")))
		await settle()
		a.provider.destroy()
		await settle()
		expect(a.socket.sent.at(-1).event).toBe("oqiva:leave")
		const before = b.socket.sent.length
		b.store.updateObjects([{ id: "s", patch: { x: 5 } }])
		await settle()
		expect(a.store.getObject("s").x).toBe(0) // no longer listening
		expect(b.socket.sent.length).toBeGreaterThan(before)
		a.provider.destroy() // harmless twice
	})
})

import * as awarenessApi from "y-protocols/awareness"
