// Phase 5 collaboration in the browser: three people on one board through the live relay.
// Needs the bench's socket server running (it carries the live traffic).
import assert from "node:assert/strict"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const A = await signedIn(browser, creds.a)
const B = await signedIn(browser, creds.b)
const C = await signedIn(browser, creds.c)
const stamp = Date.now().toString(36)
let board
const origins = {}

const objectsOf = (p) => p.locator('[data-testid="objects"] > g')
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
const csrf = (p) => p.evaluate(() => window.csrf_token)
async function call(who, method, data) {
	const response = await who.context.request.post(`${BASE}/api/method/oqiva.api.${method}`, {
		headers: { "x-frappe-csrf-token": await csrf(who.page) },
		data,
	})
	if (!response.ok()) throw new Error(`${method} failed: ${response.status()} ${(await response.text()).slice(0, 150)}`)
	return (await response.json()).message
}
async function open(who) {
	await who.page.goto(`${BASE}/oqiva/board/${board}`)
	await who.page.getByRole("button", { name: "Continue" }).click({ timeout: 2500 }).catch(() => {})
	await who.page.locator('[data-testid="board-canvas"]').waitFor()
	const box = await who.page.locator('[data-testid="board-canvas"]').boundingBox()
	origins[who === A ? "A" : who === B ? "B" : "C"] = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
async function draw(who, key, from, to) {
	const o = origins[key]
	const p = who.page
	await p.keyboard.press("r")
	await p.mouse.move(o.x + from[0], o.y + from[1])
	await p.mouse.down()
	await p.mouse.move(o.x + to[0], o.y + to[1], { steps: 6 })
	await p.mouse.up()
}
const people = (who) => who.page.getByTestId("presence-person")

await step("the owner makes a board and shares it with two people", async () => {
	const p = A.page
	await p.goto(`${BASE}/oqiva/welcome`)
	await p.getByRole("button", { name: "Continue" }).click()
	await p.getByRole("button", { name: /Switch workspace/ }).click()
	await p.getByRole("menuitem", { name: "Create workspace" }).click()
	await p.getByRole("dialog").getByLabel("Workspace name").fill(`Collab ${stamp}`)
	await p.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await p.getByRole("heading", { name: "Create your first board" }).waitFor()
	await p.getByRole("button", { name: "New board" }).first().click()
	await p.waitForURL(/\/oqiva\/board\//)
	board = p.url().split("/board/")[1]
	await call(A, "share.add_person", { board, person: creds.b.user, level: "edit" })
	await call(A, "share.add_person", { board, person: creds.c.user, level: "view" })
})

await step("everyone opens it and sees who else is there", async () => {
	await open(A)
	await open(B)
	await open(C)
	await poll(async () => (await people(A).count()) === 2, "two other people for A")
	await poll(async () => (await people(B).count()) === 2, "two other people for B")
	await poll(async () => (await people(C).count()) === 2, "two other people for C")
	await shot(A.page, "p5-3-presence")
})

await step("a shape drawn by one person appears for the others, live", async () => {
	await draw(A, "A", [-100, -50], [100, 50])
	for (const who of [B, C]) await poll(async () => (await objectsOf(who.page).count()) === 1, "the shape")
	await shot(B.page, "p5-4-live")
})

await step("a shape moved by another person moves for the first", async () => {
	const before = await A.page.locator('[data-testid="objects"] > g').first().getAttribute("transform")
	const o = origins.B
	await B.page.mouse.move(o.x, o.y)
	await B.page.mouse.down()
	await B.page.mouse.move(o.x + 150, o.y + 80, { steps: 8 })
	await B.page.mouse.up()
	await poll(async () => (await A.page.locator('[data-testid="objects"] > g').first().getAttribute("transform")) !== before, "A to see the move")
})

await step("pointers and selections of others are shown in their colours", async () => {
	await B.page.mouse.move(origins.B.x + 250, origins.B.y - 100)
	await poll(async () => (await A.page.getByTestId("peer-cursor").count()) >= 1, "B's pointer on A's screen")
	await B.page.mouse.click(origins.B.x + 150, origins.B.y + 80) // selects the shape
	await poll(async () => (await A.page.getByTestId("peer-selection").count()) >= 1, "B's selection on A's screen")
	await shot(A.page, "p5-5-cursors")
})

await step("someone who may only view sees everything but cannot change it", async () => {
	await C.page.locator("header").getByText("View only", { exact: true }).last().waitFor()
	await draw(C, "C", [200, 100], [300, 160]).catch(() => {})
	await new Promise((r) => setTimeout(r, 1500))
	assert.equal(await objectsOf(A.page).count(), 1, "nothing C draws should reach A")
	assert.equal(await objectsOf(C.page).count(), 1)
})

await step("a person who leaves disappears from the others' view", async () => {
	await C.page.goto(`${BASE}/oqiva/`)
	await poll(async () => (await people(A).count()) === 1, "C to leave A's list")
	await open(C)
})

await step("revoking someone's access takes it away while they have the board open", async () => {
	await call(A, "share.remove_person", { board, user: creds.b.user })
	await B.page.getByText(/no longer have access/i).first().waitFor({ timeout: 20000 })
	await B.page.locator("header").getByText("No access", { exact: true }).waitFor()
	await shot(B.page, "p5-6-revoked")
	await call(A, "share.add_person", { board, person: creds.b.user, level: "edit" })
	await poll(async () => /Can edit/.test(await B.page.locator("header").innerText()), "B's edit access back", 20000)
})

await step("two people who lose the connection both keep drawing, and both shapes survive", async () => {
	await B.page.reload()
	await B.page.locator('[data-testid="board-canvas"]').waitFor()
	const box = await B.page.locator('[data-testid="board-canvas"]').boundingBox()
	origins.B = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
	await poll(async () => (await objectsOf(B.page).count()) === 1, "B to load the shape")
	await B.context.setOffline(true)
	await draw(B, "B", [-300, 150], [-200, 220])
	await draw(A, "A", [200, 150], [320, 230])
	await poll(async () => (await objectsOf(B.page).count()) === 2, "B's own shape")
	assert.equal(await objectsOf(A.page).count(), 2)
	await B.context.setOffline(false)
	// Both shapes reach both people, and both are in what the server stored.
	await poll(async () => (await objectsOf(A.page).count()) === 3, "B's shape to reach A", 25000)
	await poll(async () => (await objectsOf(B.page).count()) === 3, "A's shape to reach B", 25000)
	await poll(
		async () => {
			const loaded = await call(A, "board.load_document", { board })
			return JSON.parse(loaded.document).objects.length === 3
		},
		"the stored board to hold all three shapes",
		30000,
	)
})

await step("work done offline and saved only on this device is merged and saved on return", async () => {
	await B.context.setOffline(true)
	await draw(B, "B", [-300, -150], [-200, -90])
	await poll(async () => (await objectsOf(B.page).count()) === 4, "the offline shape")
	await B.page.waitForTimeout(500)
	await B.context.setOffline(false)
	await poll(
		async () => {
			const loaded = await call(A, "board.load_document", { board })
			return JSON.parse(loaded.document).objects.length === 4
		},
		"the offline shape to be saved",
		30000,
	)
	await poll(async () => (await objectsOf(A.page).count()) === 4, "the shape to reach A", 25000)
})

await browser.close()
// A 417 from a save is the expected stale-revision answer that makes the editor merge and retry.
const expected = /net::ERR|Failed to load resource|socket|WebSocket|HTTP 417: \/api\/method\/oqiva\.api\.board\.save_document/i
finish([...A.problems, ...B.problems].filter((p) => !expected.test(p)))
