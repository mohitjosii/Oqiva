// Tests the relay (../handlers.js) the way Frappe's socket server runs it: a socket.io server
// with one namespace per site, each socket carrying a ``frappe_request`` that asks the web
// server who may do what. Here that call is scripted, so the relay's own rules (who joins, who
// writes, how much, how fast, when access is checked again) can be checked without a database.
//
// Run: node --test realtime/harness      (socket.io comes from apps/frappe/node_modules)
import assert from "node:assert/strict"
import http from "node:http"
import { createRequire } from "node:module"
import path from "node:path"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const frappeModules = path.resolve(here, "../../../frappe/node_modules")
const require = createRequire(path.join(frappeModules, "noop.js"))
const { Server } = require("socket.io")
const { io: connect } = require("socket.io-client")
const HANDLERS = path.resolve(here, "../handlers.js")

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const REAUTH_MS = 250

// access: { "<user>": "edit" | "comment" | "view" | null } or a function; changeable during a test.
async function startServer({ sites = ["site-a"] } = {}) {
	process.env.OQIVA_REAUTH_MS = String(REAUTH_MS)
	delete createRequire(import.meta.url).cache?.[HANDLERS]
	const handlers = createRequire(import.meta.url)(HANDLERS)
	const state = { access: {}, calls: [], failing: new Set() }
	const server = http.createServer()
	const io = new Server(server, { maxHttpBufferSize: 1e6 })
	for (const site of sites) {
		io.of(`/${site}`)
			.use((socket, next) => {
				socket.user = socket.handshake.auth.user
				socket.frappe_request = async (url, args) => {
					state.calls.push({ user: socket.user, url, args })
					if (state.failing.has(socket.user)) throw new Error("web server unreachable")
					const access = state.access[socket.user] ?? null
					if (access === "disabled") return { ok: false, status: 403 }
					return { ok: true, json: async () => ({ message: { access } }) }
				}
				next()
			})
			.on("connection", handlers)
	}
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
	const url = `http://127.0.0.1:${server.address().port}`
	const clients = []
	return {
		state,
		limits: handlers.limits,
		async client(user, site = "site-a") {
			const socket = connect(`${url}/${site}`, {
				auth: { user },
				transports: ["websocket"],
				forceNew: true,
			})
			await new Promise((resolve, reject) => {
				socket.once("connect", resolve)
				socket.once("connect_error", reject)
			})
			const got = []
			for (const event of [
				"oqiva:sync",
				"oqiva:awareness",
				"oqiva:peer_left",
				"oqiva:access_changed",
			]) {
				socket.on(event, (message) => got.push({ event, ...message }))
			}
			socket.got = got
			socket.join = (board) => socket.emitWithAck("oqiva:join", { board })
			clients.push(socket)
			return socket
		},
		async close() {
			for (const c of clients) c.close()
			await io.close()
		},
	}
}

const bytes = (n) => new Uint8Array(n).fill(7)
const onlyEvents = (socket, event) => socket.got.filter((m) => m.event === event)

describe("joining", () => {
	it("T6.1: a person with no access is told so, and hears nothing from the room", async () => {
		const s = await startServer()
		s.state.access = { editor: "edit", stranger: null }
		const editor = await s.client("editor")
		const stranger = await s.client("stranger")
		assert.equal((await editor.join("b1")).access, "edit")
		assert.deepEqual(await stranger.join("b1"), { access: null })
		editor.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(10) })
		editor.emit("oqiva:awareness", { board: "b1", data: bytes(10) })
		await wait(150)
		assert.equal(stranger.got.length, 0)
		// and cannot speak into it either
		stranger.emit("oqiva:sync", { board: "b1", kind: "step1", data: bytes(5) })
		await wait(100)
		assert.equal(onlyEvents(editor, "oqiva:sync").length, 0)
		await s.close()
	})

	it("refuses made-up board names without asking the web server", async () => {
		const s = await startServer()
		s.state.access = { editor: "edit" }
		const editor = await s.client("editor")
		for (const board of ["../x", "a b", "", "x".repeat(200), 5, null, { $ne: 1 }]) {
			assert.deepEqual(await editor.emitWithAck("oqiva:join", { board }), { access: null })
		}
		assert.equal(s.state.calls.length, 0)
		await s.close()
	})

	it("asks the web server for the access of the connected person, naming the board", async () => {
		const s = await startServer()
		s.state.access = { editor: "comment" }
		const editor = await s.client("editor")
		const reply = await editor.join("b9")
		assert.equal(reply.access, "comment")
		assert.deepEqual(s.state.calls[0], {
			user: "editor",
			url: "/api/method/oqiva.api.realtime.authorize",
			args: { board: "b9" },
		})
		await s.close()
	})

	it("treats an unreachable or refusing web server as no access", async () => {
		const s = await startServer()
		s.state.access = { a: "edit", b: "disabled" }
		s.state.failing.add("a")
		for (const user of ["a", "b"]) {
			const c = await s.client(user)
			assert.deepEqual(await c.join("b1"), { access: null })
		}
		await s.close()
	})

	it("tells new arrivals who is already there, and everyone when someone leaves or goes", async () => {
		const s = await startServer()
		s.state.access = { one: "edit", two: "view", three: "view" }
		const one = await s.client("one")
		const two = await s.client("two")
		const three = await s.client("three")
		const first = await one.join("b1")
		const second = await two.join("b1")
		assert.deepEqual(first.peers, [])
		assert.deepEqual(second.peers, [one.id])
		await three.join("b1")
		two.emit("oqiva:leave", { board: "b1" })
		await wait(100)
		assert.equal(onlyEvents(one, "oqiva:peer_left").filter((m) => m.id === two.id).length, 1)
		const threeId = three.id // a client forgets its id once it is closed
		three.close()
		await wait(150)
		assert.equal(onlyEvents(one, "oqiva:peer_left").filter((m) => m.id === threeId).length, 1)
		await s.close()
	})
})

describe("who may write", () => {
	it("T6.2: a viewer or commenter can ask for state but never send state or updates", async () => {
		const s = await startServer()
		s.state.access = { editor: "edit", viewer: "view", commenter: "comment" }
		const editor = await s.client("editor")
		const viewer = await s.client("viewer")
		const commenter = await s.client("commenter")
		for (const c of [editor, viewer, commenter]) await c.join("b1")
		for (const who of [viewer, commenter]) {
			who.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(20) })
			who.emit("oqiva:sync", { board: "b1", kind: "step2", data: bytes(20) })
		}
		await wait(2 * REAUTH_MS) // beyond one re-check, as a tampered client would try
		viewer.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(20) })
		await wait(150)
		assert.equal(
			onlyEvents(editor, "oqiva:sync").length,
			0,
			"nothing a viewer wrote should reach an editor",
		)
		viewer.emit("oqiva:sync", { board: "b1", kind: "step1", data: bytes(20) })
		await wait(150)
		assert.equal(onlyEvents(editor, "oqiva:sync").filter((m) => m.kind === "step1").length, 1)
		await s.close()
	})

	it("an editor's updates and a targeted reply reach the right people", async () => {
		const s = await startServer()
		s.state.access = { editor: "edit", other: "edit", viewer: "view" }
		const editor = await s.client("editor")
		const other = await s.client("other")
		const viewer = await s.client("viewer")
		for (const c of [editor, other, viewer]) await c.join("b1")
		editor.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(30) })
		await wait(150)
		assert.equal(onlyEvents(other, "oqiva:sync").length, 1)
		assert.equal(onlyEvents(viewer, "oqiva:sync").length, 1)
		assert.equal(onlyEvents(editor, "oqiva:sync").length, 0, "the sender does not hear itself")
		assert.equal(onlyEvents(other, "oqiva:sync")[0].from, editor.id)
		other.emit("oqiva:sync", { board: "b1", kind: "step2", data: bytes(30), to: viewer.id })
		await wait(150)
		assert.equal(onlyEvents(viewer, "oqiva:sync").filter((m) => m.kind === "step2").length, 1)
		assert.equal(
			onlyEvents(editor, "oqiva:sync").length,
			0,
			"a targeted reply is for one person only",
		)
		await s.close()
	})

	it("a message to somebody who is not in the room goes nowhere", async () => {
		const s = await startServer()
		s.state.access = { editor: "edit", outsider: "edit" }
		const editor = await s.client("editor")
		const outsider = await s.client("outsider")
		await editor.join("b1")
		await outsider.join("b2") // a different board
		editor.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(10), to: outsider.id })
		await wait(150)
		assert.equal(outsider.got.length, 0)
		await s.close()
	})

	it("ignores unknown kinds, empty data and boards that were never joined", async () => {
		const s = await startServer()
		s.state.access = { editor: "edit", other: "edit" }
		const editor = await s.client("editor")
		const other = await s.client("other")
		await editor.join("b1")
		await other.join("b1")
		for (const message of [
			{ board: "b1", kind: "bogus", data: bytes(5) },
			{ board: "b1", kind: "update" },
			{ board: "b1", kind: "update", data: null },
			{ board: "b-not-joined", kind: "update", data: bytes(5) },
			null,
			"text",
		]) {
			editor.emit("oqiva:sync", message)
		}
		await wait(150)
		assert.equal(other.got.length, 0)
		await s.close()
	})
})

describe("size and speed", () => {
	it("T6.3: awareness over 8 KB is dropped, and more than 30 a second is throttled", async () => {
		const s = await startServer()
		s.state.access = { a: "view", b: "view" }
		const a = await s.client("a")
		const b = await s.client("b")
		await a.join("b1")
		await b.join("b1")
		a.emit("oqiva:awareness", { board: "b1", data: bytes(s.limits.MAX_AWARENESS_BYTES + 1) })
		a.emit("oqiva:awareness", { board: "b1", data: bytes(s.limits.MAX_AWARENESS_BYTES) })
		await wait(150)
		assert.equal(onlyEvents(b, "oqiva:awareness").length, 1)
		const before = onlyEvents(b, "oqiva:awareness").length
		for (let i = 0; i < 80; i++) a.emit("oqiva:awareness", { board: "b1", data: bytes(10) })
		await wait(400)
		const arrived = onlyEvents(b, "oqiva:awareness").length - before
		assert.ok(arrived <= s.limits.MAX_AWARENESS_PER_SECOND, `${arrived} arrived in one burst`)
		assert.ok(arrived >= 20, "the throttle should not swallow ordinary traffic")
		await s.close()
	})

	it("T6.7: a sync payload over 900 KB is not relayed (the sender saves over HTTP instead)", async () => {
		const s = await startServer()
		s.state.access = { a: "edit", b: "edit" }
		const a = await s.client("a")
		const b = await s.client("b")
		await a.join("b1")
		await b.join("b1")
		a.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(s.limits.MAX_SYNC_BYTES + 1) })
		await wait(300)
		assert.equal(onlyEvents(b, "oqiva:sync").length, 0)
		a.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(s.limits.MAX_SYNC_BYTES) })
		await wait(400)
		assert.equal(onlyEvents(b, "oqiva:sync").length, 1, "a payload at the limit still goes through")
		await s.close()
	})
})

describe("access that changes while connected", () => {
	it("T6.4: a revoked editor who ignores the notice is cut off within the re-check window", async () => {
		const s = await startServer()
		s.state.access = { editor: "edit", revoked: "edit" }
		const editor = await s.client("editor")
		const revoked = await s.client("revoked")
		await editor.join("b1")
		await revoked.join("b1")
		revoked.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(10) })
		await wait(100)
		assert.equal(onlyEvents(editor, "oqiva:sync").length, 1)
		s.state.access.revoked = null // the share is revoked
		// A tampered client keeps writing as if nothing happened.
		const started = Date.now()
		let cutOff = null
		while (Date.now() - started < 3 * REAUTH_MS + 500 && cutOff === null) {
			const before = onlyEvents(editor, "oqiva:sync").length
			revoked.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(10) })
			await wait(60)
			if (onlyEvents(editor, "oqiva:sync").length === before && Date.now() - started > REAUTH_MS)
				cutOff = Date.now() - started
		}
		assert.ok(cutOff !== null, "the writes should have stopped")
		assert.ok(cutOff <= 2 * REAUTH_MS + 400, `cut off after ${cutOff} ms`)
		const settled = onlyEvents(editor, "oqiva:sync").length
		for (let i = 0; i < 5; i++)
			revoked.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(10) })
		await wait(200)
		assert.equal(onlyEvents(editor, "oqiva:sync").length, settled)
		assert.ok(
			onlyEvents(revoked, "oqiva:access_changed").some((m) => m.access === null),
			"the honest client is told",
		)
		assert.ok(
			onlyEvents(editor, "oqiva:peer_left").some((m) => m.id === revoked.id),
			"the room is told they left",
		)
		await s.close()
	})

	it("a downgrade to view stops writes and tells the client its new level", async () => {
		const s = await startServer()
		s.state.access = { editor: "edit", lowered: "edit" }
		const editor = await s.client("editor")
		const lowered = await s.client("lowered")
		await editor.join("b1")
		await lowered.join("b1")
		s.state.access.lowered = "view"
		await wait(REAUTH_MS + 100)
		lowered.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(10) })
		await wait(200)
		assert.equal(onlyEvents(editor, "oqiva:sync").length, 0)
		assert.ok(onlyEvents(lowered, "oqiva:access_changed").some((m) => m.access === "view"))
		await s.close()
	})

	it("T6.5: a user disabled while connected stops writing within the window", async () => {
		const s = await startServer()
		s.state.access = { editor: "edit", leaver: "edit" }
		const editor = await s.client("editor")
		const leaver = await s.client("leaver")
		await editor.join("b1")
		await leaver.join("b1")
		s.state.access.leaver = "disabled"
		await wait(REAUTH_MS + 100)
		leaver.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(10) })
		await wait(250)
		assert.equal(onlyEvents(editor, "oqiva:sync").length, 0)
		await s.close()
	})

	it("access is not asked for again on every message, only once the last answer is stale", async () => {
		const s = await startServer()
		s.state.access = { editor: "edit", peer: "view" }
		const editor = await s.client("editor")
		const peer = await s.client("peer")
		await editor.join("b1")
		await peer.join("b1")
		const afterJoin = s.state.calls.length
		for (let i = 0; i < 25; i++)
			editor.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(10) })
		await wait(150)
		assert.equal(s.state.calls.length, afterJoin, "no extra checks inside the window")
		await wait(REAUTH_MS + 50)
		for (let i = 0; i < 10; i++)
			editor.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(10) })
		await wait(250)
		assert.equal(s.state.calls.length, afterJoin + 1, "one shared check once the answer is stale")
		await s.close()
	})
})

describe("sites", () => {
	it("T6.6: a room on one site cannot be reached from another", async () => {
		const s = await startServer({ sites: ["site-a", "site-b"] })
		s.state.access = { one: "edit", two: "edit" }
		const one = await s.client("one", "site-a")
		const two = await s.client("two", "site-b")
		await one.join("b1")
		await two.join("b1") // the same board name on another site
		one.emit("oqiva:sync", { board: "b1", kind: "update", data: bytes(10) })
		one.emit("oqiva:awareness", { board: "b1", data: bytes(10) })
		await wait(200)
		assert.equal(two.got.length, 0)
		await s.close()
	})
})

after(() => setTimeout(() => process.exit(0), 100).unref())
