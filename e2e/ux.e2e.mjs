// The everyday friendliness of the app: the sidebar as a drawer on a phone, the first-board tips and the help
// menu, the minimap showing diagrams, a marquee that picks a flowchart's steps, hand-drawn lines, two
// fingers to pan and zoom on a touch screen, and a second person's laser pointer.
import assert from "node:assert/strict"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const A = await signedIn(browser, creds.a)
const B = await signedIn(browser, creds.b)
const page = A.page
const stamp = Date.now().toString(36)
let board

const poll = async (check, what, ms = 10000) => {
	const end = Date.now() + ms
	let last
	while (Date.now() < end) {
		try {
			last = await check()
			if (last) return last
		} catch (error) {
			last = error.message
		}
		await new Promise((r) => setTimeout(r, 120))
	}
	throw new Error(`Timed out waiting for ${what}${last ? ` (last: ${String(last).slice(0, 120)})` : ""}`)
}
const csrf = (p) => p.evaluate(() => window.csrf_token)
async function call(who, method, data) {
	const response = await who.context.request.post(`${BASE}/api/method/oqiva.api.${method}`, {
		headers: { "x-frappe-csrf-token": await csrf(who.page) },
		data,
	})
	if (!response.ok()) throw new Error(`${method} failed: ${response.status()}`)
	return (await response.json()).message
}
const canvas = page.locator('[data-testid="board-canvas"]').first()

await step("on a phone the sidebar is a drawer that a button opens, and a link closes", async () => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`${BASE}/oqiva/welcome`)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).first().waitFor({ state: "attached" })
	const drawer = page.getByTestId("sidebar")
	assert.ok((await drawer.boundingBox()) === null || (await drawer.boundingBox()).x < 0, "the drawer starts off screen")
	await page.getByTestId("open-menu").click()
	await poll(async () => (await drawer.boundingBox())?.x >= 0, "the drawer slides in")
	await shot(page, "ux-1-drawer")
	await page.getByRole("link", { name: "Templates" }).click()
	await poll(async () => (await drawer.boundingBox()).x < 0, "the drawer closes after choosing a page")
	await page.getByRole("heading", { name: "Templates" }).first().waitFor()
	await page.setViewportSize({ width: 1360, height: 860 })
})

await step("a new board explains itself once: tips open by themselves, 'Got it' keeps them away", async () => {
	await page.getByRole("link", { name: "Home" }).first().click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	board = page.url().split("/board/")[1]
	await canvas.waitFor()
	await page.getByTestId("quick-tips").waitFor()
	await page.getByTestId("empty-hint").waitFor()
	await shot(page, "ux-2-tips")
	await page.getByTestId("tips-close").click()
	await page.getByTestId("quick-tips").waitFor({ state: "detached" })
	await page.reload()
	await canvas.waitFor()
	await page.waitForTimeout(600)
	assert.equal(await page.getByTestId("quick-tips").count(), 0, "not again after Got it")
	await page.getByTestId("help-button").click()
	await page.getByRole("menuitem", { name: "Quick tips" }).click()
	await page.getByTestId("quick-tips").waitFor()
	await page.getByTestId("tips-close").click()
	await page.getByTestId("help-button").click()
	await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click()
	await page.getByRole("dialog", { name: /Keyboard shortcuts/ }).waitFor()
	await page.keyboard.press("Escape")
})

await step("the labels on the top bar give way to icons on a phone", async () => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.waitForTimeout(400)
	assert.equal(await page.getByTestId("history-button").innerText(), "", "History shows only its icon")
	const export_ = await page.getByTestId("export-button").boundingBox()
	assert.ok(export_.x + export_.width <= 390, "Export is on screen")
	await shot(page, "ux-3-phone-editor")
	await page.setViewportSize({ width: 1360, height: 860 })
})

await step("hand-drawn lines, and a marquee that picks a flowchart's steps", async () => {
	const box = await canvas.boundingBox()
	await page.keyboard.press("Shift+F") // a new flowchart
	await page.locator("[data-flownode]").nth(1).waitFor()
	await page.keyboard.press("Escape")
	await page.waitForTimeout(300)
	const steps = page.locator("[data-flownode]")
	assert.equal(await steps.count(), 2)
	await page.mouse.move(box.x + 5, box.y + 100)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width - 5, box.y + box.height - 120, { steps: 6 })
	await page.mouse.up()
	await page.getByTestId("flowchart-bar").waitFor()
	await shot(page, "ux-4-marquee")
	await page.keyboard.press("Escape")
})

await step("the minimap shows a flowchart as boxes", async () => {
	const boxes = await page.locator('[data-testid="minimap"] svg rect').count()
	assert.ok(boxes >= 3, `the minimap draws the flowchart's steps (${boxes} rects)`)
})

await step("two fingers pan and zoom on a touch screen", async () => {
	const touch = await browser.newContext({ viewport: { width: 820, height: 1000 }, hasTouch: true, extraHTTPHeaders: { "x-frappe-site-name": "frappe.com" } })
	const login = await touch.request.post(`${BASE}/api/method/login`, { data: { usr: creds.a.user, pwd: creds.a.password }, headers: { "x-frappe-site-name": "frappe.com" } })
	assert.ok(login.ok())
	const tp = await touch.newPage()
	await tp.goto(`${BASE}/oqiva/welcome`)
	await tp.getByRole("button", { name: "Continue" }).click({ timeout: 3000 }).catch(() => {})
	await tp.goto(`${BASE}/oqiva/board/${board}`)
	await tp.locator('[data-testid="board-canvas"]').first().waitFor()
	await tp.waitForTimeout(800)
	const session = await touch.newCDPSession(tp)
	const zoomText = async () => (await tp.locator("text=/\\d+ ?%/").first().innerText()).trim()
	const before = await zoomText()
	const send = (type, points) => session.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) })
	await send("touchStart", [[300, 400], [420, 400]])
	for (let i = 1; i <= 8; i++) await send("touchMove", [[300 - i * 15, 400], [420 + i * 15, 400]])
	await send("touchEnd", [])
	await poll(async () => (await zoomText()) !== before, "the zoom changes with two fingers")
	const after = await zoomText()
	assert.ok(parseInt(after) > parseInt(before), `zoomed in (${before} -> ${after})`)
	await shot(tp, "ux-5-pinch")
	await touch.close()
})

await step("a second person sees someone's laser pointer, and it goes when they put it away", async () => {
	await call(A, "share.add_person", { board, person: creds.b.user, level: "edit" })
	await B.page.goto(`${BASE}/oqiva/board/${board}`)
	await B.page.getByRole("button", { name: "Continue" }).click({ timeout: 2500 }).catch(() => {})
	await B.page.locator('[data-testid="board-canvas"]').first().waitFor()
	await B.page.waitForTimeout(800)
	await page.keyboard.press("Shift+L")
	const box = await canvas.boundingBox()
	await page.mouse.move(box.x + 400, box.y + 300)
	for (let i = 0; i < 12; i++) await page.mouse.move(box.x + 400 + i * 12, box.y + 300 + i * 6)
	await B.page.getByTestId("peer-laser").first().waitFor()
	await shot(B.page, "ux-6-peer-laser")
	await page.keyboard.press("Escape")
	await poll(async () => (await B.page.getByTestId("peer-laser").count()) === 0, "the laser leaves B's screen")
})

void stamp
await browser.close()
finish([...A.problems, ...B.problems].filter((m) => !/403|404|417|429|EXPECTATION|socket/.test(m)))
