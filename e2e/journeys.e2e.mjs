// Journey A (Phase 13, P13.04): a brand-new person, from the first visit to getting their work out and
// back. One run, in the order a person would do it: welcome, a workspace, a board from a template, edit
// it, comment on it, rename it, export it, come back later, tidy up with the Trash. The other journeys
// of the plan are in the suites that already do them in detail:
//   B  sharing            phase5.e2e.mjs (people, links, anonymous viewers) and collab.e2e.mjs (live)
//   C  offline            collab.e2e.mjs ("two people who lose the connection", "work done offline")
//   D  revoke while open  collab.e2e.mjs ("revoking someone's access ... while they have the board open")
import assert from "node:assert/strict"
import fs from "node:fs"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const A = await signedIn(browser, creds.a)
const page = A.page
const stamp = Date.now().toString(36)
const title = `My first board ${stamp}`
let board

const poll = async (check, what, ms = 15000) => {
	const end = Date.now() + ms
	let last
	while (Date.now() < end) {
		try { last = await check(); if (last) return last } catch (e) { last = e.message }
		await new Promise((r) => setTimeout(r, 150))
	}
	throw new Error(`Timed out: ${what} (last: ${String(last).slice(0, 150)})`)
}
const shapes = () => page.locator('[data-testid="objects"] > g')
const canvas = page.locator('[data-testid="board-canvas"]').first()
const saved = async () => /Saved/.test(await page.locator('[data-testid="save-status"]').innerText())

await step("the first visit explains Oqiva and makes a workspace for the person", async () => {
	await page.goto(`${BASE}/oqiva/`)
	await page.waitForURL(/\/oqiva\/welcome/)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
})

await step("a board is made from a template and opens ready to use", async () => {
	await page.getByRole("link", { name: "Templates" }).first().click()
	await page.getByLabel(/Search templates/i).fill("kanban")
	await page.locator('article[aria-labelledby^="template-"]').first().waitFor()
	await page.locator('article[aria-labelledby^="template-"]').getByRole("button", { name: /Use template/ }).click()
	await page.waitForURL(/\/oqiva\/board\//)
	board = page.url().split("/board/")[1]
	await canvas.waitFor()
	await poll(async () => (await shapes().count()) === 21, "the template's 21 shapes")
	await shot(page, "journey-1-template")
})

await step("a card's text is changed by double-clicking it", async () => {
	await page.keyboard.press("Shift+Digit1")
	await page.waitForTimeout(400)
	const card = shapes().nth(8)
	const b = await card.locator("rect, path").first().boundingBox()
	await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2)
	await page.locator('[data-testid="text-editor"]').waitFor()
	await page.keyboard.press("Control+a")
	await page.keyboard.type("Ship the first release")
	await page.keyboard.press("Escape")
	await poll(async () => (await page.locator('[data-testid="objects"]').first().textContent()).includes("Ship the first release"), "the new text")
})

await step("the board is renamed from its title", async () => {
	await page.locator("header").getByText(/Untitled|Kanban/i).first().click()
	await page.keyboard.press("Control+a")
	await page.keyboard.type(title)
	await page.keyboard.press("Enter")
	await poll(async () => (await page.locator("header").innerText()).includes(title), "the new title in the header")
})

await step("a comment is left on a card", async () => {
	await page.getByTestId("comment-tool").click()
	const b = await shapes().nth(8).locator("rect, path").first().boundingBox()
	await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
	await page.getByTestId("comment-draft").waitFor()
	await page.getByLabel("New comment").fill("Is this date realistic?")
	await page.getByTestId("comment-submit").click()
	await page.getByTestId("comment-pin").first().waitFor()
})

await step("the board is exported as a picture", async () => {
	await page.keyboard.press("Escape")
	await page.getByTestId("export-button").click()
	const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "PNG", exact: true }).first().click()])
	const bytes = fs.readFileSync(await download.path())
	assert.equal(bytes.subarray(1, 4).toString(), "PNG", "a PNG file")
	assert.ok(bytes.length > 5000, "not an empty picture")
	assert.ok(download.suggestedFilename().includes(stamp), `named after the board: ${download.suggestedFilename()}`)
})

await step("everything is saved, and the same board comes back after the page is closed and opened again", async () => {
	await poll(saved, "Saved", 20000)
	await page.goto(`${BASE}/oqiva/`)
	await page.getByRole("heading", { name: title }).first().waitFor()
	await page.getByRole("heading", { name: title }).first().click()
	await canvas.waitFor()
	await page.keyboard.press("Shift+Digit1")
	await poll(async () => (await shapes().count()) === 21, "21 shapes after coming back")
	assert.ok((await page.locator('[data-testid="objects"]').first().textContent()).includes("Ship the first release"))
	await page.getByTestId("comment-pin").first().waitFor()
})

await step("the person signs in again on a new device and finds the board under Recent", async () => {
	const again = await signedIn(browser, creds.a)
	await again.page.goto(`${BASE}/oqiva/`)
	await again.page.getByRole("heading", { name: title }).first().waitFor()
	await again.context.close()
})

await step("the board goes to the Trash and comes back", async () => {
	await page.goto(`${BASE}/oqiva/`)
	await page.getByRole("button", { name: `Actions for ${title}` }).click()
	await page.getByRole("menuitem", { name: "Move to Trash" }).click()
	await page.getByRole("button", { name: "Confirm" }).click()
	await page.getByRole("link", { name: "Trash" }).click()
	await page.getByRole("button", { name: `Actions for ${title}` }).click()
	await page.getByRole("menuitem", { name: "Restore" }).click()
	await page.getByRole("heading", { name: "Trash is empty" }).waitFor()
	await page.getByRole("link", { name: "Home" }).click()
	await page.getByRole("heading", { name: title }).first().waitFor()
})

await browser.close()
finish([...A.problems])
