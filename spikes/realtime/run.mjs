// Drives the real Frappe socket server (with realtime/handlers.js loaded) from several
// users at once, and checks what the relay lets through. See the README for setup.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { io } from "socket.io-client"
import * as Y from "yjs"

const WEB = process.env.OQIVA_WEB || "http://127.0.0.1:8000"
const SOCKET = process.env.OQIVA_SOCKET || "http://127.0.0.1:9101"
const SITE = process.env.OQIVA_SITE || "frappe.com"
const REAUTH_MS = Number(process.env.OQIVA_REAUTH_MS || 2000)
const BENCH = process.env.OQIVA_BENCH || "/home/frappe/frappe-bench"
const creds = JSON.parse(fs.readFileSync(process.env.OQIVA_E2E_CREDS, "utf8"))
const { board } = JSON.parse(fs.readFileSync(process.env.OQIVA_SPIKE, "utf8"))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (check, ms = 5000) => {
	const end = Date.now() + ms
	while (Date.now() < end) {
		if (await check()) return true
		await wait(50)
	}
	return false
}

async function login({ user, password }) {
	const response = await fetch(`${WEB}/api/method/login`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-frappe-site-name": SITE },
		body: JSON.stringify({ usr: user, pwd: password }),
	})
	const sid = response.headers.getSetCookie().find((c) => c.startsWith("sid="))
	if (!sid) throw new Error(`login failed for ${user}`)
	return sid.split(";")[0]
}

// A person in the room: a socket, a Y.Doc, and the sync protocol on top.
async function person(name, who, doc = new Y.Doc()) {
	const cookie = await login(who)
	const socket = io(`${SOCKET}/${SITE}`, {
		transports: ["websocket"],
		extraHeaders: { cookie, "x-frappe-site-name": SITE, origin: SOCKET },
		forceNew: true,
		reconnection: false,
	})
	await new Promise((resolve, reject) => {
		socket.on("connect", resolve)
		socket.on("connect_error", (error) => reject(new Error(`${name}: ${error.message}`)))
	})
	const p = { name, socket, doc, access: null, id: null, log: { peerLeft: [], changed: [], awareness: [], syncIn: 0 } }
	doc.on("update", (update, origin) => {
		if (origin !== "remote") socket.emit("oqiva:sync", { board, kind: "update", data: update })
	})
	socket.on("oqiva:sync", ({ kind, data, from }) => {
		p.log.syncIn++
		if (kind === "step1") {
			socket.emit("oqiva:sync", { board, kind: "step2", data: Y.encodeStateAsUpdate(doc, new Uint8Array(data)), to: from })
		} else {
			Y.applyUpdate(doc, new Uint8Array(data), "remote")
		}
	})
	socket.on("oqiva:peer_left", (m) => p.log.peerLeft.push(m.id))
	socket.on("oqiva:access_changed", (m) => p.log.changed.push(m))
	socket.on("oqiva:awareness", (m) => p.log.awareness.push(m))
	p.join = async () => {
		const reply = await socket.emitWithAck("oqiva:join", { board })
		p.access = reply.access
		p.id = reply.id
		if (reply.access) socket.emit("oqiva:sync", { board, kind: "step1", data: Y.encodeStateVector(doc) })
		return reply
	}
	return p
}

const objects = (p) => p.doc.getMap("objects")
let failed = 0
function check(name, ok, detail = "") {
	if (!ok) failed++
	console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`)
}

// The run ends by revoking b, so give b the edit share back before each run.
execFileSync(
	"bench",
	[
		"--site", SITE, "execute", "frappe.share.add",
		"--args", JSON.stringify(["Oqiva Board", board, creds.b.user]),
		// bench execute reads --kwargs as a Python literal, so this is not JSON.
		"--kwargs", "{'read': 1, 'write': 1, 'comment': 1, 'share': 0, 'notify': 0, 'flags': {'ignore_share_permission': True}}",
	],
	{ cwd: BENCH, stdio: "ignore" },
)

const a = await person("a (editor)", creds.a)
const b = await person("b (editor)", creds.b)
const c = await person("c (viewer)", creds.c)
const d = await person("d (outsider)", creds.d)

console.log("join")
check("owner gets edit", (await a.join()).access === "edit")
check("share-edit user gets edit", (await b.join()).access === "edit")
check("share-view user gets view", (await c.join()).access === "view")
check("outsider is told no access", (await d.join()).access === null)
check("a bad board name is refused", (await a.socket.emitWithAck("oqiva:join", { board: "../etc" })).access === null)

console.log("initial sync of a 1,000-object board")
for (let i = 0; i < 1000; i++) {
	objects(a).set(`o${i}`, JSON.stringify({ id: i, x: i * 3, y: i * 2, w: 160, h: 90, text: `Shape ${i}`, fill: "#fff" }))
}
await wait(500)
const state = Y.encodeStateAsUpdate(a.doc)
console.log(`       encoded state: ${(state.byteLength / 1024).toFixed(0)} KB (limit ${(900).toFixed(0)} KB per message)`)
const late = await person("late joiner", creds.b)
const started = Date.now()
await late.join()
const synced = await until(() => objects(late).size === 1000)
check("a late editor receives all 1,000 objects", synced, `${Date.now() - started} ms`)
late.socket.disconnect()

console.log("live updates")
objects(a).set("live", "from a")
check("editor update reaches the other editor", await until(() => objects(b).get("live") === "from a"))
check("editor update reaches the viewer", await until(() => objects(c).get("live") === "from a"))
await wait(300)
check("the outsider receives nothing", objects(d).size === 0 && d.log.syncIn === 0)

console.log("writes that must be refused")
objects(c).set("hack", "from the viewer")
d.socket.emit("oqiva:sync", { board, kind: "update", data: Y.encodeStateAsUpdate(new Y.Doc()) })
await wait(1200)
check("a viewer's update never reaches an editor", !objects(a).has("hack") && !objects(b).has("hack"))
check("the viewer's own copy stays local", objects(c).get("hack") === "from the viewer")
const big = new Uint8Array(950 * 1024)
a.socket.emit("oqiva:sync", { board, kind: "update", data: big })
await wait(800)
const syncBefore = b.log.syncIn
a.socket.emit("oqiva:sync", { board, kind: "update", data: new Uint8Array(1024) })
check("an over-size update is dropped, normal ones still flow", await until(() => b.log.syncIn === syncBefore + 1))
a.socket.emit("oqiva:awareness", { board, data: new Uint8Array(8 * 1024 + 1) })
for (let i = 0; i < 100; i++) a.socket.emit("oqiva:awareness", { board, data: new Uint8Array(32) })
await wait(800)
check("oversize awareness is dropped and the rest throttled to 30/s", b.log.awareness.length > 0 && b.log.awareness.length <= 31, `${b.log.awareness.length} delivered of 101`)

console.log("leaving and coming back")
const bId = b.id
b.socket.disconnect()
check("the others are told when someone leaves", await until(() => a.log.peerLeft.includes(bId)))
for (let i = 0; i < 5; i++) objects(a).set(`while-away-${i}`, "x")
const back = await person("b again", creds.b, b.doc)
await back.join()
check("a returning editor catches up on what they missed", await until(() => objects(back).has("while-away-4")))
check("and their own later edits flow again", (objects(back).set("after-return", "y"), await until(() => objects(a).get("after-return") === "y")))

console.log(`revoking access (re-check window ${REAUTH_MS} ms)`)
objects(back).set("before-revoke", "ok")
check("before revocation the editor's update is relayed", await until(() => objects(a).get("before-revoke") === "ok"))
execFileSync("bench", ["--site", SITE, "execute", "frappe.share.remove", "--args", JSON.stringify(["Oqiva Board", board, creds.b.user])], {
	cwd: BENCH,
	stdio: "ignore",
})
await wait(REAUTH_MS + 400)
objects(back).set("after-revoke", "should not arrive")
await wait(1500)
check("after the re-check window the revoked editor's update is dropped", !objects(a).has("after-revoke"))
check("and they are told their access ended", back.log.changed.some((m) => m.access === null))
objects(back).set("later", "still nothing")
await wait(800)
check("they stay out of the room", !objects(a).has("later"))

for (const p of [a, c, d, back]) p.socket.disconnect()
console.log(failed ? `\n${failed} checks failed` : "\nAll checks passed")
process.exit(failed ? 1 : 0)
