// Phase 5 in the browser: sharing with people, share links, and what a visitor sees.
import assert from "node:assert/strict"
import { anonymous, BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const owner = await signedIn(browser, creds.a)
const page = owner.page
const stamp = Date.now().toString(36)

const shapes = page.locator('[data-testid="objects"] > g')
const canvas = page.locator('[data-testid="board-canvas"]')
const status = page.locator('[data-testid="save-status"]')
let board
let origin

const poll = async (target, check, what, ms = 10000) => {
	const end = Date.now() + ms
	let last
	while (Date.now() < end) {
		try {
			last = await check()
			if (last) return last
		} catch (error) {
			last = error.message
		}
		await target.waitForTimeout(150)
	}
	throw new Error(`Timed out waiting for ${what}${last ? ` (last: ${String(last).slice(0, 120)})` : ""}`)
}
// frappe-ui's Select is a custom combobox, not a native <select>.
async function choose(label, option) {
	await page.getByLabel(label, { exact: true }).click()
	await page.getByRole("option", { name: option, exact: true }).click()
}
const saved = () => poll(page, async () => /Saved/.test(await status.innerText()), "Saved")

// Opens the board as someone else and says what it offers.
async function openAs(who, url = `${BASE}/oqiva/board/${board}`) {
	await who.page.goto(url)
	await who.page.getByRole("button", { name: "Continue" }).click({ timeout: 2500 }).catch(() => {})
	await who.page.waitForTimeout(500)
	return who.page
}
// The access badge is the last such label in the header (the save indicator can say "View only" too).
const badge = (p) => p.locator("header").getByText(/^(Can edit|Can comment|View only)$/).last()

await step("the owner makes a board with a shape", async () => {
	await page.goto(`${BASE}/oqiva/welcome`)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	await page.getByRole("dialog").getByLabel("Workspace name").fill(`Share ${stamp}`)
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	board = page.url().split("/board/")[1]
	await canvas.waitFor()
	const box = await canvas.boundingBox()
	origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
	await page.keyboard.press("r")
	await page.mouse.move(origin.x - 100, origin.y - 50)
	await page.mouse.down()
	await page.mouse.move(origin.x + 100, origin.y + 50, { steps: 6 })
	await page.mouse.up()
	await poll(page, async () => (await shapes.count()) === 1, "one shape")
	await saved()
})

await step("someone with no access sees a not-found page", async () => {
	const b = await signedIn(browser, creds.b)
	const p = await openAs(b)
	await p.getByText(/could not be found|not found/i).first().waitFor()
	await b.context.close()
})

const people = page.getByTestId("share-people")
await step("the Share dialog adds a person by email and lists them", async () => {
	await page.getByTestId("share-button").click()
	await page.getByTestId("share-empty").waitFor()
	await page.getByLabel("Add people").fill(creds.b.user)
	await choose("Access for the new person", "Can edit")
	await page.getByRole("button", { name: "Share", exact: true }).click()
	await people.getByText("E2E B").waitFor()
	await shot(page, "p5-1-share-dialog")
})

let b
await step("that person can now open the board and edit it", async () => {
	b = await signedIn(browser, creds.b)
	const p = await openAs(b)
	await canvas.first().waitFor()
	await p.getByText("Can edit", { exact: true }).last().waitFor()
	await poll(p, async () => (await p.locator('[data-testid="objects"] > g').count()) === 1, "the shape")
})

await step("lowering them to view takes editing away at once", async () => {
	await choose("Access of E2E B", "Can view")
	await page.getByText("Access updated").first().waitFor()
	await b.page.reload()
	await b.page.locator("header").getByText("View only", { exact: true }).last().waitFor()
	assert.equal(await b.page.getByTestId("palette").getByTitle("Add picture").isDisabled(), true)
})

await step("removing them closes the board to them", async () => {
	await page.getByTitle("Remove E2E B").click()
	await page.getByText("E2E B removed").first().waitFor()
	await b.page.reload()
	await b.page.getByText(/could not be found|not found/i).first().waitFor()
})

await step("a person with no account is invited by email and listed as waiting", async () => {
	await page.getByLabel("Add people").fill(`newcomer-${stamp}@oqiva.test`)
	await page.getByRole("button", { name: "Share", exact: true }).click()
	await page.getByRole("list", { name: "Invites waiting" }).getByText(`newcomer-${stamp}@oqiva.test`).waitFor()
	await page.getByTitle(`Withdraw the invite to newcomer-${stamp}@oqiva.test`).click()
	await page.getByText("Invite withdrawn").first().waitFor()
})

let editorLink
let viewerLink
await step("an Editor link is shown once and listed with only a hint of it", async () => {
	await choose("What the link allows", "Can edit")
	await page.getByTestId("create-link").click()
	editorLink = await page.getByTestId("new-link-url").inputValue()
	assert.match(editorLink, /\/oqiva\/s\/[A-Za-z0-9_-]{40,}$/)
	const listed = await page.getByTestId("link-list").innerText()
	assert.ok(!listed.includes(editorLink.split("/s/")[1]), "the secret must not be listed")
	assert.match(listed, /Can edit/)
})

await step("a signed-in person who follows the link gets its access", async () => {
	const c = await signedIn(browser, creds.c)
	const p = c.page
	await p.goto(editorLink)
	// A brand-new account meets the welcome page first, and still ends up on the linked board.
	await p.getByRole("button", { name: "Continue" }).click({ timeout: 8000 }).catch(() => {})
	await p.waitForURL(/\/oqiva\/board\//)
	await p.locator("header").getByText("Can edit", { exact: true }).waitFor()
	await c.context.close()
})

await step("an anonymous viewing link shows the board read-only to someone who is not signed in", async () => {
	await choose("What the link allows", "Can view")
	await page.getByLabel("Anyone with the link can look").check()
	await page.getByTestId("create-link").click()
	viewerLink = await page.getByTestId("new-link-url").inputValue()
	const visitor = await anonymous(browser)
	await visitor.page.goto(viewerLink)
	await visitor.page.getByTestId("shared-board").waitFor()
	await poll(visitor.page, async () => (await visitor.page.locator('[data-testid="objects"] > g').count()) === 1, "the shape")
	assert.equal(await visitor.page.getByTestId("shared-title").count(), 1)
	assert.equal(await visitor.page.getByTestId("palette").getByTitle("Add picture").isDisabled(), true)
	assert.equal(await visitor.page.getByTestId("export-button").count(), 0, "no export for a visitor")
	await shot(visitor.page, "p5-2-visitor")
	await visitor.context.close()
})

await step("a link that needs an account sends a visitor to sign in, then back", async () => {
	await choose("What the link allows", "Can comment")
	await page.getByTestId("create-link").click()
	const url = await page.getByTestId("new-link-url").inputValue()
	const visitor = await anonymous(browser)
	await visitor.page.goto(url)
	await visitor.page.waitForURL(/\/login/)
	assert.ok(decodeURIComponent(visitor.page.url()).includes(new URL(url).pathname))
	await visitor.context.close()
})

await step("ending the anonymous link stops it for visitors, and says the same as for a made-up link", async () => {
	const row = page.getByTestId("link-list").locator("li").filter({ hasText: "no account needed" })
	await row.getByRole("button", { name: "End" }).click()
	await page.getByText(/Link ended/).first().waitFor()
	const visitor = await anonymous(browser)
	await visitor.page.goto(viewerLink)
	const ended = await visitor.page.getByTestId("link-missing").innerText()
	await visitor.page.goto(`${BASE}/oqiva/s/${"x".repeat(43)}`)
	const invented = await visitor.page.getByTestId("link-missing").innerText()
	assert.equal(ended, invented)
	await visitor.context.close()
})

await step("ending the Editor link takes access from the person who used it", async () => {
	const row = page.getByTestId("link-list").locator("li").filter({ hasText: "Can edit" })
	await row.getByRole("button", { name: "End" }).click()
	await page.getByText(/Link ended/).first().waitFor()
	const c = await signedIn(browser, creds.c)
	const p = await openAs(c)
	await p.getByText(/could not be found|not found/i).first().waitFor()
	await c.context.close()
})

await browser.close()
finish(owner.problems)
