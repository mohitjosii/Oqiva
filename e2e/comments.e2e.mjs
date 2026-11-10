// Comments and notifications in the browser: three people on one board.
import assert from "node:assert/strict"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const A = await signedIn(browser, creds.a)
const B = await signedIn(browser, creds.b)
const C = await signedIn(browser, creds.c)
const stamp = Date.now().toString(36)
let board

const poll = async (check, what, ms = 15000) => {
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
async function call(who, method, data) {
	const csrf = await who.page.evaluate(() => window.csrf_token)
	const response = await who.context.request.post(`${BASE}/api/method/oqiva.api.${method}`, { headers: { "x-frappe-csrf-token": csrf }, data })
	if (!response.ok()) throw new Error(`${method}: ${response.status()} ${(await response.text()).slice(0, 150)}`)
	return (await response.json()).message
}
async function open(who) {
	await who.page.goto(`${BASE}/oqiva/board/${board}`)
	await who.page.getByRole("button", { name: "Continue" }).click({ timeout: 2500 }).catch(() => {})
	await who.page.locator('[data-testid="board-canvas"]').waitFor()
	await who.page.waitForTimeout(600)
}
const pins = (w) => w.page.getByTestId("comment-pin")
const threads = (w) => w.page.getByTestId("comment-thread")
const panel = async (w) => {
	if ((await w.page.getByTestId("comment-panel").count()) === 0) await w.page.getByTestId("comments-toggle").click()
	await w.page.getByTestId("comment-panel").waitFor()
}

await step("the owner makes a board with a shape and shares it", async () => {
	const p = A.page
	await p.goto(`${BASE}/oqiva/welcome`)
	await p.getByRole("button", { name: "Continue" }).click()
	await p.getByRole("button", { name: /Switch workspace/ }).click()
	await p.getByRole("menuitem", { name: "Create workspace" }).click()
	await p.getByRole("dialog").getByLabel("Workspace name").fill(`Comments ${stamp}`)
	await p.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await p.getByRole("heading", { name: "Create your first board" }).waitFor()
	await p.getByRole("button", { name: "New board" }).first().click()
	await p.waitForURL(/\/oqiva\/board\//)
	board = p.url().split("/board/")[1]
	await p.locator('[data-testid="board-canvas"]').waitFor()
	const box = await p.locator('[data-testid="board-canvas"]').boundingBox()
	await p.keyboard.press("r")
	await p.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 - 50)
	await p.mouse.down()
	await p.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, { steps: 6 })
	await p.mouse.up()
	await poll(async () => /Saved/.test(await p.locator('[data-testid="save-status"]').innerText()), "Saved")
	await call(A, "share.add_person", { board, person: creds.b.user, level: "edit" })
	await call(A, "share.add_person", { board, person: creds.c.user, level: "view" })
})

await step("everyone opens the board", async () => {
	for (const who of [B, C]) await open(who)
})

await step("clicking the comment tool on a shape opens a draft, and @ offers the people to mention", async () => {
	const p = A.page
	await p.getByTestId("comment-tool").click()
	const shape = await p.locator('[data-testid="objects"] > g').first().boundingBox()
	await p.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2)
	await p.getByTestId("comment-draft").waitFor()
	assert.equal(await p.getByTestId("comment-draft-pin").count(), 1)
	await p.getByLabel("New comment").fill(`Please check this @${creds.b.user.slice(0, 8)}`)
	await p.getByTestId("mention-list").getByRole("option").first().waitFor()
	await p.getByTestId("mention-list").getByRole("option").first().locator("button").click()
	assert.ok((await p.getByLabel("New comment").inputValue()).includes(`@${creds.b.user} `))
	await shot(p, "p5-7-draft")
})

await step("sending it adds a thread, with a pin on the shape, and the mention is bold", async () => {
	await A.page.getByTestId("comment-submit").click()
	await threads(A).first().waitFor()
	await poll(async () => (await pins(A).count()) === 1, "a pin")
	assert.equal(await A.page.getByTestId("comment-draft").count(), 0)
	assert.equal(await A.page.getByTestId("comment-text").first().locator("strong").count(), 1)
	assert.match(await A.page.getByTestId("comments-count").innerText(), /1/)
	await shot(A.page, "p5-8-thread")
})

await step("the others see the pin appear without reloading", async () => {
	for (const who of [B, C]) await poll(async () => (await pins(who).count()) === 1, "the pin to appear")
})

await step("the person mentioned is told, in the bell, and opening it marks it read", async () => {
	await poll(async () => (await B.page.getByTestId("bell-count").count()) === 1, "B's bell count", 20000)
	await B.page.getByTestId("bell").click()
	await B.page.getByTestId("bell-panel").getByText(/mentioned you/).waitFor()
	await shot(B.page, "p5-9-bell")
	// B was also told about the share itself, so there is more than one.
	const before = Number(await B.page.getByTestId("bell-count").innerText())
	assert.ok(before >= 2, `expected the share and the mention, saw ${before}`)
	await B.page.getByTestId("notification").filter({ hasText: /mentioned you/ }).click()
	await poll(async () => Number(await B.page.getByTestId("bell-count").innerText()) === before - 1, "the count to drop by one")
})

await step("a reply from another person reaches the first live, and tells them", async () => {
	await panel(B)
	await B.page.getByTestId("comment-reply").first().click()
	await B.page.getByRole("textbox", { name: "Reply" }).fill("On it")
	await B.page.getByTestId("comment-submit").click()
	await poll(async () => (await A.page.getByTestId("comment-text").count()) === 2, "the reply on A's screen")
	assert.match(await pins(A).first().innerText(), /2/)
	await poll(async () => (await A.page.getByTestId("bell-count").count()) === 1, "A's bell")
})

await step("someone who may only view can read the thread but not answer it", async () => {
	await panel(C)
	await threads(C).first().waitFor()
	assert.equal(await C.page.getByTestId("comment-reply").count(), 0)
	assert.equal(await C.page.getByTestId("comment-resolve").count(), 0)
	assert.equal(await C.page.getByTestId("comment-tool").isDisabled(), true)
})

await step("resolving moves the thread to Resolved for everyone and greys the pin", async () => {
	await B.page.getByTestId("comment-resolve").first().click()
	await poll(async () => (await A.page.getByTestId("comments-tab-resolved").innerText()).includes("(1)"), "the Resolved tab to show 1")
	await poll(async () => /bg-gray-400/.test((await pins(A).first().getAttribute("class")) || ""), "a grey pin")
	await A.page.getByTestId("comments-tab-resolved").click()
	await A.page.getByTestId("comment-resolve").first().click() // reopen
	await poll(async () => /bg-blue-600/.test((await pins(A).first().getAttribute("class")) || ""), "a blue pin again")
})

await step("a pin follows its shape when the shape moves", async () => {
	const before = await pins(A).first().boundingBox()
	const shape = await A.page.locator('[data-testid="objects"] > g').first().boundingBox()
	await A.page.mouse.move(shape.x + shape.width / 2, shape.y + shape.height / 2)
	await A.page.mouse.down()
	await A.page.mouse.move(shape.x + shape.width / 2 + 120, shape.y + shape.height / 2 + 60, { steps: 6 })
	await A.page.mouse.up()
	await poll(async () => {
		const after = await pins(A).first().boundingBox()
		return Math.abs(after.x - before.x - 120) < 4 && Math.abs(after.y - before.y - 60) < 4
	}, "the pin to move with the shape")
})

await step("text with markup is shown as text, never run", async () => {
	await A.page.getByTestId("comments-tab-open").click()
	await A.page.getByTestId("comment-reply").first().click()
	await A.page.getByRole("textbox", { name: "Reply" }).fill("<img src=x onerror=window.__pwned=1> hello & <b>bold</b>")
	await A.page.getByTestId("comment-submit").click()
	await poll(async () => (await A.page.getByTestId("comment-text").count()) === 3, "the third comment")
	assert.equal(await A.page.evaluate(() => window.__pwned), undefined)
	assert.equal(await A.page.locator('[data-testid="comment-text"] img, [data-testid="comment-text"] b').count(), 0)
})

await step("deleting your own comment removes it for everyone; a thread's first comment takes the thread", async () => {
	await A.page.getByTestId("comments-tab-open").click()
	await A.page.getByTestId("comment-delete").first().click()
	await poll(async () => (await threads(A).count()) === 0, "the thread to go")
	await poll(async () => (await pins(B).count()) === 0, "the pin to go for B")
})

await step("a comment on a shape that is later removed says so", async () => {
	const p = A.page
	await p.getByTestId("comment-tool").click()
	const shape = await p.locator('[data-testid="objects"] > g').first().boundingBox()
	await p.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2)
	await p.getByLabel("New comment").fill("About this shape")
	await p.getByTestId("comment-submit").click()
	await threads(A).first().waitFor()
	await p.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2 + 20) // select the shape
	await p.keyboard.press("Delete")
	await poll(async () => (await p.getByTestId("comment-missing").count()) === 1, "the missing-shape notice (after the board saves)", 25000)
	assert.equal(await pins(A).count(), 0, "a thread with no shape has no pin")
})

await step("the notifications page lists them, and Mark all read clears the count", async () => {
	await A.page.getByTestId("bell").click()
	await A.page.getByRole("button", { name: "See all" }).click()
	await A.page.getByTestId("notification-list").waitFor()
	await A.page.getByTestId("mark-all-read").click()
	await poll(async () => (await A.page.getByTestId("sidebar-unread").count()) === 0, "the sidebar count to clear")
	await shot(A.page, "p5-10-notifications")
})

await browser.close()
finish([...A.problems, ...B.problems, ...C.problems].filter((p) => !/net::ERR|Failed to load resource|socket|WebSocket|HTTP 417/i.test(p)))
