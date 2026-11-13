// Performance in the browser (Phase 13, P13.02): a board at the default limit of 3,000 shapes, a mind
// map of 600 nodes, and ten people editing one board at once. It measures and prints; it fails only
// when something is far outside what it was when it was written. Headless Chromium draws in software, so
// the frame times are a pessimistic floor, not what a person with a graphics card sees.
//
// Needs ten test users: { "1": {user, password}, ... "10": {...} } in OQIVA_E2E_CREDS.
import assert from "node:assert/strict"
import { BASE, credentials, finish, launch, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const A = await signedIn(browser, creds["1"])
const page = A.page
page.on("pageerror", (e) => console.log("       PAGEERROR", e.message, "|", String(e.stack).split("\n").slice(1, 6).join(" | ")))
const stamp = Date.now().toString(36)
let board

async function api(who, method, data) {
	who.csrf ||= await who.page.evaluate(() => window.csrf_token)
	const csrf = who.csrf
	const r = await who.context.request.post(`${BASE}/api/method/oqiva.api.${method}`, { headers: { "x-frappe-csrf-token": csrf }, data })
	if (!r.ok()) throw new Error(`${method}: ${r.status()} ${(await r.text()).slice(0, 200)}`)
	return (await r.json()).message
}
const poll = async (check, what, ms = 20000) => {
	const end = Date.now() + ms
	let last
	while (Date.now() < end) {
		try { last = await check(); if (last) return last } catch (e) { last = e.message }
		await new Promise((r) => setTimeout(r, 100))
	}
	throw new Error(`Timed out: ${what} (last: ${String(last).slice(0, 150)})`)
}
const shapes = (p = page) => p.locator('[data-testid="objects"] > g')
const mapNodes = (p = page) => p.locator("[data-mmnode]")

function shapeDoc(count) {
	const objects = []
	for (let i = 0; i < count; i++)
		objects.push({
			id: `s${i}`, kind: "shape", shape: "rectangle", x: (i % 60) * 190, y: Math.floor(i / 60) * 120, w: 160, h: 90, rotation: 0, z: i + 1,
			style: { fill: "#DBEAFE", stroke: "#2563EB", strokeWidth: 2, dash: "solid", opacity: 1, radius: 8 },
			text: { align: "center", size: 16, color: "#1E293B", paragraphs: [{ runs: [{ t: `Shape number ${i}` }] }] },
		})
	return { schemaVersion: 1, canvas: { mode: "infinite", background: null, grid: "off" }, theme: { preset: "ocean" }, objects, connectors: [], mindmaps: [], flowcharts: [] }
}
function mapDoc(count) {
	let seed = 11
	const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
	const nodes = [{ id: "m-n0", parentId: null, order: 0, text: "Central idea", collapsed: false, color: null, marker: null, note: "" }]
	const orders = new Map()
	for (let i = 1; i < count; i++) {
		const parent = nodes[Math.floor(rand() * Math.min(nodes.length, 1 + i * 0.6))]
		const order = orders.get(parent.id) ?? 0
		orders.set(parent.id, order + 1)
		nodes.push({ id: `m-n${i}`, parentId: parent.id, order, text: `Topic ${i} ${"word ".repeat(Math.floor(rand() * 4))}`.trim(), collapsed: false, color: null, marker: null, note: "" })
	}
	return { schemaVersion: 1, canvas: { mode: "infinite", background: null, grid: "off" }, theme: { preset: "ocean" }, objects: [], connectors: [], mindmaps: [{ id: "m-map", origin: { x: 0, y: 0 }, rootId: "m-n0", layout: "both", nodes, crosslinks: [] }], flowcharts: [] }
}
// Replaces the board's content through the API. The page is closed first: a save that carries no
// collaboration state is not meant to land while someone has the board open.
async function store(who, doc) {
	who.csrf ||= await who.page.evaluate(() => window.csrf_token)
	await who.page.goto("about:blank")
	const loaded = await api(who, "board.load_document", { board })
	await api(who, "board.save_document", { board, document: JSON.stringify(doc), base_revision: loaded.revision, save_id: `perf-${Date.now()}`, crdt_state: null })
}
// A new empty board in the first workspace (each section starts clean: this device keeps a local copy of
// every board it has opened, and a board whose content is replaced behind its back is not what is being
// measured here).
async function newBoard(title) {
	A.csrf ||= await page.evaluate(() => window.csrf_token)
	const workspaces = await api(A, "workspace.list_workspaces", {})
	const list = workspaces.workspaces || workspaces
	const made = await api(A, "board.create_board", { workspace: list[0].name, title })
	board = made.name
}
async function openFresh(who) {
	const t = Date.now()
	await who.page.goto(`${BASE}/oqiva/board/${board}`)
	await who.page.getByRole("button", { name: "Continue" }).click({ timeout: 1500 }).catch(() => {})
	await who.page.locator('[data-testid="board-canvas"]').waitFor()
	return t
}
// Frame times while something moves: start, do the work, stop.
const sampler = (p) => ({
	start: () => p.evaluate(() => { window.__f = []; window.__go = true; let last = performance.now(); const tick = (t) => { window.__f.push(t - last); last = t; if (window.__go) requestAnimationFrame(tick) }; requestAnimationFrame(tick) }),
	stop: async () => {
		const frames = await p.evaluate(() => { window.__go = false; return window.__f.slice(2) })
		frames.sort((a, b) => a - b)
		const sum = frames.reduce((x, y) => x + y, 0)
		return { n: frames.length, mean: sum / frames.length, p95: frames[Math.floor(frames.length * 0.95)], max: frames.at(-1), over50: frames.filter((f) => f > 50).length }
	},
})
const fmt = (s) => `${s.n} frames, mean ${s.mean.toFixed(1)} ms, p95 ${s.p95.toFixed(1)} ms, worst ${s.max.toFixed(0)} ms, ${s.over50} over 50 ms`
const heap = (p) => p.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null))
const domNodes = (p) => p.evaluate(() => document.querySelectorAll("*").length)
const box = () => page.locator('[data-testid="board-canvas"]').first().boundingBox()

await step("setup: a board", async () => {
	await page.goto(`${BASE}/oqiva/welcome`)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	await page.getByRole("dialog").getByLabel("Workspace name").fill(`Perf ${stamp}`)
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	board = page.url().split("/board/")[1]
})

await step("3,000 shapes: opening, panning, zooming, fitting, selecting and moving all", async () => {
	await newBoard("3000 shapes")
	await store(A, shapeDoc(3000))
	const t = await openFresh(A)
	await poll(async () => (await shapes().count()) > 0, "shapes drawn", 30000)
	console.log(`       opened in ${Date.now() - t} ms; heap ${await heap(page)} MB; DOM nodes ${await domNodes(page)} (shapes in the DOM: ${await shapes().count()} of 3000)`)
	const b = await box()
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
	const s = sampler(page)
	await s.start()
	for (let i = 0; i < 80; i++) { await page.mouse.wheel(60, 40); await page.waitForTimeout(12) }
	console.log(`       panning: ${fmt(await s.stop())}`)
	await s.start()
	for (let i = 0; i < 20; i++) { await page.keyboard.down("Control"); await page.mouse.wheel(0, i < 10 ? 100 : -100); await page.keyboard.up("Control"); await page.waitForTimeout(25) }
	console.log(`       zooming: ${fmt(await s.stop())}`)
	let t0 = Date.now()
	await page.keyboard.press("Shift+Digit1")
	await poll(async () => (await shapes().count()) > 0, "after fit")
	await page.waitForTimeout(300)
	console.log(`       fit all 3,000: settled in ~${Date.now() - t0} ms; shapes in the DOM ${await shapes().count()}; DOM nodes ${await domNodes(page)}`)
	await page.keyboard.press("Control+0") // back to 100%: only what is on screen should be drawn
	await page.waitForTimeout(400)
	console.log(`       at 100%: shapes in the DOM ${await shapes().count()} of 3000; DOM nodes ${await domNodes(page)}`)
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
	await s.start()
	for (let i = 0; i < 80; i++) { await page.mouse.wheel(40, 25); await page.waitForTimeout(12) }
	console.log(`       panning at 100%: ${fmt(await s.stop())}`)
	await page.keyboard.press("Shift+Digit1")
	await page.waitForTimeout(400)
	t0 = Date.now()
	await page.keyboard.press("Control+a")
	await page.waitForTimeout(150)
	await s.start()
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
	await page.keyboard.press("ArrowRight")
	for (let i = 0; i < 10; i++) { await page.keyboard.press("Shift+ArrowDown"); await page.waitForTimeout(20) }
	console.log(`       select all + 10 nudges of 3,000 shapes: ${fmt(await s.stop())}`)
	t0 = Date.now()
	await page.keyboard.press("Control+z")
	await page.waitForTimeout(200)
	console.log(`       heap after: ${await heap(page)} MB`)
})

await step("a board that large is saved too (its change is too big for the live link, so it goes over HTTP) and reloads the same", async () => {
	await page.keyboard.press("Shift+Digit1")
	await page.keyboard.press("Control+a")
	for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight")
	const t0 = Date.now()
	await poll(async () => /Saved/.test(await page.locator('[data-testid="save-status"]').innerText()), "Saved", 40000)
	console.log(`       saved ${Date.now() - t0} ms after the move`)
	const stored = await api(A, "board.load_document", { board })
	const doc = JSON.parse(stored.document)
	assert.equal(doc.objects.length, 3000, "all 3,000 are stored")
	const moved = doc.objects.filter((o, i) => o.x !== (i % 60) * 190).length
	console.log(`       stored shapes that moved: ${moved} of 3000; crdt state stored: ${stored.crdt_state ? Math.round(stored.crdt_state.length / 1024) + " KB" : "none"}`)
	assert.ok(moved > 2900, "the move was saved")
	const errors = []
	page.on("pageerror", (e) => errors.push(e.message))
	for (let round = 1; round <= 2; round++) {
		await page.reload()
		await page.locator('[data-testid="board-canvas"]').waitFor()
		await page.keyboard.press("Shift+Digit1")
		await poll(async () => (await shapes().count()) === 3000, `3,000 shapes after reload ${round}`, 30000)
	}
	const again = JSON.parse((await api(A, "board.load_document", { board })).document)
	assert.equal(again.objects.length, 3000, "still 3,000 after two reloads")
	assert.deepEqual(errors, [], "no page errors")
})

await step("a mind map of 600 nodes", async () => {
	await newBoard("600 node map")
	await store(A, mapDoc(600))
	const t = await openFresh(A)
	await poll(async () => (await mapNodes().count()) > 0, "nodes drawn", 30000)
	console.log(`       opened in ${Date.now() - t} ms; heap ${await heap(page)} MB; DOM nodes ${await domNodes(page)} (map nodes in the DOM: ${await mapNodes().count()} of 600)`)
	await page.keyboard.press("Shift+Digit1")
	await page.waitForTimeout(400)
	console.log(`       after fit: map nodes in the DOM ${await mapNodes().count()}`)
	const b = await box()
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
	const s = sampler(page)
	await s.start()
	for (let i = 0; i < 60; i++) { await page.mouse.wheel(50, 30); await page.waitForTimeout(12) }
	console.log(`       panning: ${fmt(await s.stop())}`)
	await page.keyboard.press("Shift+Digit1") // panning moved the map out of view: bring it back
	await page.waitForTimeout(400)
	const first = mapNodes().first()
	await first.click()
	const t0 = Date.now()
	await page.keyboard.press("Tab")
	await poll(async () => (await mapNodes().count()) >= 1, "a new child")
	console.log(`       Tab (add a child) on a 600-node map settled in ~${Date.now() - t0} ms`)
})

await step("ten people editing one board at once", async () => {
	await newBoard("ten editors")
	await store(A, shapeDoc(40))
	const people = [A]
	for (let i = 2; i <= 10; i++) {
		const who = await signedIn(browser, creds[String(i)])
		await api(A, "share.add_person", { board, person: creds[String(i)].user, level: "edit" })
		// a first visit makes the person's own workspace: do that one at a time, before they open the board
		who.page.setDefaultTimeout(40000)
		await who.page.goto(`${BASE}/oqiva/welcome`)
		await who.page.getByRole("button", { name: "Continue" }).click({ timeout: 5000 }).catch(() => {})
		await who.page.waitForTimeout(300)
		people.push(who)
	}
	page.setDefaultTimeout(40000)
	const opened = Date.now()
	await Promise.all(people.map(openFresh))
	await Promise.all(people.map((who) => poll(async () => (await shapes(who.page).count()) > 0, "board drawn", 40000)))
	console.log(`       ten people opened the board in ${Date.now() - opened} ms`)
	await Promise.all(people.map((who) => who.page.keyboard.press("Shift+Digit1")))
	await page.waitForTimeout(500)
	// each person picks a different shape and duplicates it again and again
	const rounds = 15
	const started = Date.now()
	await Promise.all(
		people.map(async (who, i) => {
			const target = shapes(who.page).nth(i)
			const bb = await target.locator("rect, path").first().boundingBox()
			await who.page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2)
			for (let r = 0; r < rounds; r++) {
				await who.page.keyboard.press("Control+d")
				await who.page.waitForTimeout(150 + ((i * 37) % 90))
			}
		}),
	)
	console.log(`       ${people.length * rounds} duplicates made in ${Date.now() - started} ms`)
	const want = 40 + people.length * rounds
	const lastEdit = Date.now()
	const counts = async () => Promise.all(people.map((who) => shapes(who.page).count()))
	await Promise.all(people.map((who) => who.page.keyboard.press("Shift+Digit1")))
	await poll(async () => (await counts()).every((c) => c === want), `every screen shows ${want} shapes`, 60000).catch(async (e) => { console.log("       counts:", (await counts()).join(",")); throw e })
	console.log(`       every one of the ten screens showed all ${want} shapes ${Date.now() - lastEdit} ms after the last edit`)
	await poll(async () => /Saved/.test(await page.locator('[data-testid="save-status"]').innerText()), "Saved", 30000)
	// one more edit with everyone idle: how long until all ten screens show it
	const before = Date.now()
	await people[0].page.keyboard.press("Control+d")
	await poll(async () => (await counts()).every((c) => c === want + 1), "one more shape on all ten screens", 30000)
	console.log(`       a single new shape reached all ten screens in ${Date.now() - before} ms (nobody else busy)`)
	const storedCount = async () => JSON.parse((await api(A, "board.load_document", { board })).document).objects.length
	const settledAt = Date.now()
	let stored = await storedCount()
	console.log(`       the saved board holds ${stored} of ${want + 1} shapes straight after`)
	for (let i = 0; i < 40 && stored !== want + 1; i++) {
		await page.waitForTimeout(1000)
		stored = await storedCount()
	}
	console.log(`       the saved board holds ${stored} of ${want + 1} shapes after ${Math.round((Date.now() - settledAt) / 1000)} s`)
	assert.equal(stored, want + 1, "nothing was lost")
	for (const who of people.slice(1)) await who.context.close()
})

await browser.close()
finish([...A.problems].filter((p) => !/(HTTP|status of) (429|403|404|417)/.test(p)))
