// Phase 7 in the browser: version history (save, preview, restore, pin, rename), restoring while
// a peer is connected, and exporting and importing a board file.
import assert from "node:assert/strict"
import fs from "node:fs"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const A = await signedIn(browser, creds.a)
const B = await signedIn(browser, creds.b)
const C = await signedIn(browser, creds.c)
const stamp = Date.now().toString(36)
let board
const origin = {}

const shapesOf = (p) => p.locator('[data-testid="objects"] > g')
const poll = async (check, what, ms = 12000) => {
	const end = Date.now() + ms
	let last
	while (Date.now() < end) {
		try {
			last = await check()
			if (last) return last
		} catch (error) {
			last = error.message
		}
		await new Promise((r) => setTimeout(r, 150))
	}
	throw new Error(`Timed out waiting for ${what}${last ? ` (last: ${String(last).slice(0, 120)})` : ""}`)
}
const count = (who) => shapesOf(who.page).count()
const expectCount = (who, n, what) => poll(async () => (await count(who)) === n, `${n} ${what}`)
const csrf = (p) => p.evaluate(() => window.csrf_token)
async function call(who, method, data) {
	const response = await who.context.request.post(`${BASE}/api/method/oqiva.api.${method}`, {
		headers: { "x-frappe-csrf-token": await csrf(who.page) },
		data,
	})
	if (!response.ok()) throw new Error(`${method} failed: ${response.status()} ${(await response.text()).slice(0, 150)}`)
	return (await response.json()).message
}
const saved = (who) => poll(async () => /Saved|View only/.test(await who.page.locator('[data-testid="save-status"]').innerText()), "Saved")
async function open(who, key) {
	await who.page.goto(`${BASE}/oqiva/board/${board}`)
	await who.page.getByRole("button", { name: "Continue" }).click({ timeout: 2500 }).catch(() => {})
	const canvas = who.page.locator('[data-testid="board-canvas"]').first()
	await canvas.waitFor()
	const box = await canvas.boundingBox()
	origin[key] = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
async function draw(who, key, from, to) {
	const o = origin[key]
	const p = who.page
	await p.keyboard.press("Escape")
	await p.keyboard.press("r")
	await p.mouse.move(o.x + from[0], o.y + from[1])
	await p.mouse.down()
	await p.mouse.move(o.x + to[0], o.y + to[1], { steps: 6 })
	await p.mouse.up()
	await p.keyboard.press("Escape")
}
const panel = (who) => who.page.locator('[data-testid="version-panel"]')
const items = (who) => panel(who).locator('[data-testid="version-item"]')
const openHistory = async (who) => {
	if (!(await panel(who).isVisible().catch(() => false))) await who.page.getByTestId("history-button").click()
	await panel(who).waitFor()
}

await step("the owner draws a shape, and the first save keeps a version", async () => {
	const p = A.page
	await p.goto(`${BASE}/oqiva/welcome`)
	await p.getByRole("button", { name: "Continue" }).click()
	await p.getByRole("button", { name: /Switch workspace/ }).click()
	await p.getByRole("menuitem", { name: "Create workspace" }).click()
	await p.getByRole("dialog").getByLabel("Workspace name").fill(`History ${stamp}`)
	await p.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await p.getByRole("heading", { name: "Create your first board" }).waitFor()
	await p.getByRole("button", { name: "New board" }).first().click()
	await p.waitForURL(/\/oqiva\/board\//)
	board = p.url().split("/board/")[1]
	await call(A, "share.add_person", { board, person: creds.b.user, level: "edit" })
	await call(A, "share.add_person", { board, person: creds.c.user, level: "view" })
	await open(A, "A")
	await draw(A, "A", [-300, -60], [-150, 20])
	await expectCount(A, 1, "shape")
	await saved(A)
	await openHistory(A)
	await poll(async () => (await items(A).count()) >= 1, "the first automatic version")
	await shot(A.page, "p7-1-history")
})

await step("a version can be saved with a name", async () => {
	await panel(A).getByTestId("version-name").fill("One box")
	await panel(A).getByTestId("version-save").click()
	await poll(async () => (await panel(A).getByText("One box").count()) === 1, "the named version")
	assert.ok((await items(A).first().textContent()).includes("Named"))
})

await step("more work, then a preview shows the old version without changing the board", async () => {
	await draw(A, "A", [-100, -60], [50, 20])
	await draw(A, "A", [100, -60], [250, 20])
	await expectCount(A, 3, "shapes")
	await saved(A)
	const named = items(A).filter({ hasText: "One box" })
	await named.getByTestId("version-preview").click()
	const preview = A.page.getByTestId("version-preview").first()
	await A.page.locator('[role="dialog"]').waitFor()
	await poll(async () => (await A.page.locator('[role="dialog"] [data-testid="objects"] > g').count()) === 1, "one object in the preview")
	await shot(A.page, "p7-2-preview")
	await A.page.getByTestId("preview-close").click()
	await A.page.locator('[role="dialog"]').waitFor({ state: "detached" })
	assert.equal(await count(A), 3, "the board did not change")
	void preview
})

await step("a version can be pinned and renamed", async () => {
	const named = items(A).filter({ hasText: "One box" })
	await named.getByTestId("version-pin").click()
	await poll(async () => (await items(A).filter({ hasText: "One box" }).getByRole("img", { name: "Pinned" }).count()) === 1, "the pin")
	await named.getByTestId("version-rename-button").click()
	await A.page.getByTestId("version-rename").fill("Just one box")
	await A.page.getByTestId("version-rename").press("Enter")
	await poll(async () => (await panel(A).getByText("Just one box").count()) === 1, "the new name")
})

await step("a peer is connected while the owner restores: both end up the same", async () => {
	await open(B, "B")
	await poll(async () => (await count(B)) === 3, "B sees three shapes")
	const named = items(A).filter({ hasText: "Just one box" })
	await named.getByTestId("version-restore").click()
	await named.getByTestId("version-confirm").click()
	await expectCount(A, 1, "shape after the restore")
	await poll(async () => (await count(B)) === 1, "B sees the restored board")
	await shot(A.page, "p7-3-restored")
	// the board as it was is kept as a version, and the peer can carry on editing
	await poll(async () => (await panel(A).getByText(/Before restoring version/).count()) >= 1, "a Pre-restore version")
	await draw(B, "B", [100, 40], [250, 110])
	await poll(async () => (await count(A)) === 2 && (await count(B)) === 2, "both see B's new shape")
})

await step("undo brings back what was there before the restore, and keeps the peer's new shape", async () => {
	await A.page.keyboard.press("Control+z")
	await poll(async () => (await count(A)) === 4, "the three old shapes and B's for A")
	await poll(async () => (await count(B)) === 4, "the same four for B")
	await saved(A)
})

await step("a viewer sees the list but cannot preview, restore or name", async () => {
	await open(C, "C")
	await C.page.getByTestId("history-button").click()
	await poll(async () => (await items(C).count()) >= 1, "the list for the viewer")
	assert.equal(await panel(C).getByTestId("version-preview").count(), 0)
	assert.equal(await panel(C).getByTestId("version-restore").count(), 0)
	assert.equal(await panel(C).getByTestId("version-name").count(), 0)
	const refused = await C.context.request.post(`${BASE}/api/method/oqiva.api.version.begin_restore`, {
		headers: { "x-frappe-csrf-token": await csrf(C.page) },
		data: { board, version_number: 1 },
	})
	assert.equal(refused.status(), 403)
})

let file
await step("the board exports as a file", async () => {
	await A.page.getByTestId("export-button").click()
	const download = A.page.waitForEvent("download")
	await A.page.getByRole("menuitem", { name: /Board file/ }).click()
	const got = await download
	assert.match(got.suggestedFilename(), /\.oqiva\.json$/)
	file = fs.readFileSync(await got.path(), "utf8")
	const data = JSON.parse(file)
	assert.equal(data.format, "oqiva-board")
	assert.equal(data.document.objects.length, 4)
})

await step("the file imports as a new board, and a wrong file is refused", async () => {
	const p = A.page
	await p.goto(`${BASE}/oqiva/`)
	await p.getByTestId("import-input").waitFor({ state: "attached" })
	await p.getByTestId("import-input").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from("hello") })
	await p.getByText(/not an Oqiva board file/i).first().waitFor()
	await p.getByTestId("import-input").setInputFiles({ name: "Roadmap.oqiva.json", mimeType: "application/json", buffer: Buffer.from(file) })
	await p.waitForURL(/\/oqiva\/board\//)
	assert.notEqual(p.url().split("/board/")[1], board)
	await p.locator('[data-testid="board-canvas"]').first().waitFor()
	await poll(async () => (await count(A)) === 4, "four shapes in the imported board")
	await shot(p, "p7-4-imported")
})

await browser.close()
finish([...A.problems, ...B.problems].filter((m) => !/403|404|417|EXPECTATION/.test(m)))
