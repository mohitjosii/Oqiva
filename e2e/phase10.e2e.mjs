// Phase 10 in the browser: the whiteboard. The empty-board hint, the pen, highlighter, eraser (ink
// and object modes) and laser, pen width typed in, hand-drawn style for the board and for one shape,
// double-click adding nothing, a second person seeing strokes and cuts, saving, and the Whiteboard template.
import assert from "node:assert/strict"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const A = await signedIn(browser, creds.a)
const B = await signedIn(browser, creds.b)
const stamp = Date.now().toString(36)
let board
const page = A.page

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
const canvas = page.locator('[data-testid="board-canvas"]').first()
const objects = (p) => p.locator('[data-testid="objects"] > g')
const count = (p) => objects(p).count()
const countIs = (p, n) => async () => (await count(p)) === n
const csrf = (p) => p.evaluate(() => window.csrf_token)
async function call(who, method, data) {
	const response = await who.context.request.post(`${BASE}/api/method/oqiva.api.${method}`, {
		headers: { "x-frappe-csrf-token": await csrf(who.page) },
		data,
	})
	if (!response.ok()) throw new Error(`${method} failed: ${response.status()}`)
	return (await response.json()).message
}
let origin
async function stroke(p, points) {
	await p.waitForTimeout(250) // let a closing menu or a tool change settle, as a person would
	await p.mouse.move(origin.x + points[0][0], origin.y + points[0][1])
	await p.mouse.down()
	for (const [x, y] of points.slice(1)) await p.mouse.move(origin.x + x, origin.y + y, { steps: 3 })
	await p.mouse.up()
}
const line = (y, from = 100, to = 500) => [
	[from, y],
	[(from + to) / 2, y + 12],
	[to, y],
]
const chooseDraw = async (name) => {
	await page.getByTestId("draw-button").click()
	await page.getByRole("menuitem", { name }).click()
}
const toolBar = () => page.getByTestId("draw-bar")

await step("a new board shows a hint, which goes when the pen draws something", async () => {
	await page.goto(`${BASE}/oqiva/welcome`)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	await page.getByRole("dialog").getByLabel("Workspace name").fill(`Whiteboard ${stamp}`)
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	board = page.url().split("/board/")[1]
	await canvas.waitFor()
	const box = await canvas.boundingBox()
	origin = { x: box.x, y: box.y + 60 }
	await page.getByTestId("empty-hint").waitFor()
	await chooseDraw(/^Pen/)
	await toolBar().waitFor()
	await stroke(page, line(150))
	await poll(countIs(page, 1), "one stroke")
	assert.equal(await page.getByTestId("empty-hint").count(), 0, "the hint went")
	await shot(page, "p10-1-pen")
})

await step("the pen stays on, so another stroke needs no new click; width is typed in", async () => {
	await stroke(page, line(230))
	await poll(countIs(page, 2), "two strokes")
	const field = page.getByTestId("ink-width")
	assert.equal(await field.inputValue(), "4")
	await field.fill("23")
	await field.press("Enter")
	assert.equal(await field.inputValue(), "23")
	await stroke(page, line(330))
	await poll(countIs(page, 3), "a wide stroke")
	const wide = await objects(page).nth(2).boundingBox()
	const thin = await objects(page).nth(1).boundingBox()
	assert.ok(wide.height > thin.height + 8, `the wide stroke is thicker (${wide.height} vs ${thin.height})`)
	await field.fill("999")
	await field.press("Enter")
	assert.equal(await field.inputValue(), "80", "held to the largest width")
	await field.fill("4")
	await field.press("Enter")
})

await step("keys switch tools: P, E, Shift+H, Shift+L; the bar follows", async () => {
	await page.keyboard.press("e")
	await page.getByTestId("eraser-mode-ink").waitFor()
	await page.keyboard.press("H", { shift: true }).catch(() => {})
	await page.keyboard.press("Shift+H")
	await poll(async () => (await page.getByTestId("ink-width").inputValue()) === "18", "highlighter width")
	await page.keyboard.press("Shift+L")
	await poll(async () => (await toolBar().count()) === 0, "no options for the laser")
	await page.keyboard.press("p")
	await toolBar().waitFor()
	await page.keyboard.press("Escape")
	await poll(async () => (await toolBar().count()) === 0, "back to select")
})

await step("the highlighter is see-through", async () => {
	await page.keyboard.press("Shift+H")
	await stroke(page, line(420))
	await poll(countIs(page, 4), "a highlighter stroke")
	const opacity = await objects(page).nth(3).getAttribute("opacity")
	assert.ok(Number(opacity) < 1, `opacity ${opacity}`)
	await shot(page, "p10-2-highlighter")
})

await step("the laser leaves a trail that is never saved", async () => {
	await page.keyboard.press("Shift+L")
	await page.mouse.move(origin.x + 200, origin.y + 500)
	await page.mouse.move(origin.x + 260, origin.y + 520, { steps: 5 })
	await page.getByTestId("laser-dot").waitFor()
	await shot(page, "p10-3-laser")
	assert.equal(await count(page), 4, "nothing was added")
	await page.keyboard.press("Escape")
	await poll(async () => (await page.getByTestId("laser-dot").count()) === 0, "the laser went with the tool")
})

await step("the eraser cuts a stroke in two, and Undo joins it again", async () => {
	await page.keyboard.press("e")
	await page.getByTestId("eraser-size-m").click()
	const before = await count(page)
	await stroke(page, [
		[300, 110],
		[300, 190],
	])
	await poll(countIs(page, before + 1), "two pieces for one stroke")
	await page.keyboard.press("Escape")
	await page.keyboard.press("Control+z")
	await poll(countIs(page, before), "one stroke again")
	await page.keyboard.press("Control+Shift+z")
	await poll(countIs(page, before + 1), "cut again")
	await shot(page, "p10-4-erased")
})

await step("object mode removes the whole stroke under the tip", async () => {
	await page.keyboard.press("e")
	await page.getByTestId("eraser-mode-object").click()
	const before = await count(page)
	await stroke(page, [
		[150, 220],
		[160, 225],
	])
	await poll(countIs(page, before - 1), "a whole stroke gone")
	await page.keyboard.press("Escape")
	await page.keyboard.press("Control+z")
	await poll(countIs(page, before), "and back")
})

await step("a drawing can be selected and moved like any object, and deleted", async () => {
	const before = await count(page)
	const target = await objects(page).last().boundingBox()
	await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2)
	await page.keyboard.press("ArrowRight")
	await page.keyboard.press("Delete")
	await poll(countIs(page, before - 1), "the stroke deleted")
	await page.keyboard.press("Control+z")
	await poll(countIs(page, before), "and restored")
})

await step("the hand-drawn style can be set for the board and for one shape", async () => {
	await page.keyboard.press("r")
	await stroke(page, [
		[600, 100],
		[800, 220],
	])
	const rects = () => page.locator('[data-testid="objects"] > g > rect').count()
	await poll(async () => (await rects()) === 1, "a clean rectangle")
	await page.getByTestId("draw-button").click()
	await page.getByRole("menuitem", { name: "Hand-drawn outlines" }).click()
	await poll(async () => (await rects()) === 0, "the rectangle is hand-drawn now")
	await shot(page, "p10-5-sketch")
	// one shape can go against the board
	const shape = page.locator('[data-testid="objects"] > g').last()
	const box = await shape.boundingBox()
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
	await page.getByRole("button", { name: "Hand-drawn style" }).click()
	await page.getByTestId("sketch-off").click()
	await poll(async () => (await rects()) === 1, "this shape is clean again")
	await page.keyboard.press("Escape")
})

await step("double-clicking empty canvas adds nothing, and the Draw menu has no double-click setting", async () => {
	await page.keyboard.press("Escape")
	await page.getByTestId("draw-button").click()
	assert.equal(await page.getByRole("menuitem", { name: /Double-click/ }).count(), 0)
	await page.keyboard.press("Escape")
	const before = await count(page)
	await page.waitForTimeout(400) // the menu has closed
	await page.mouse.dblclick(origin.x + 700, origin.y + 420)
	await page.waitForTimeout(400)
	assert.equal(await page.locator('[data-testid="text-editor"]').count(), 0, "no editor opened")
	assert.equal(await count(page), before)
})

await step("a second person sees the drawing, and a cut made by them", async () => {
	await poll(async () => /Saved/.test(await page.locator('[data-testid="save-status"]').innerText()), "Saved", 15000)
	await call(A, "share.add_person", { board, person: creds.b.user, level: "edit" })
	await B.page.goto(`${BASE}/oqiva/board/${board}`)
	await B.page.getByRole("button", { name: "Continue" }).click({ timeout: 2500 }).catch(() => {})
	await B.page.locator('[data-testid="board-canvas"]').first().waitFor()
	const mine = await count(page)
	await poll(async () => (await count(B.page)) === mine, "the same drawing for B")
	// B's view may sit somewhere else on the board, so aim at where B actually sees a stroke
	const target = await objects(B.page).nth(1).boundingBox()
	await B.page.keyboard.press("e")
	await B.page.getByTestId("eraser-mode-ink").click()
	await B.page.getByTestId("eraser-size-l").click()
	await B.page.waitForTimeout(250)
	const cx = target.x + target.width / 2
	await B.page.mouse.move(cx, target.y - 20)
	await B.page.mouse.down()
	await B.page.mouse.move(cx, target.y + target.height + 20, { steps: 6 })
	await B.page.mouse.up()
	await B.page.waitForTimeout(500)
	await poll(async () => (await count(page)) === mine + 1, "B's cut on A's screen")
	await shot(B.page, "p10-6-peer")
})

await step("it is all still there after saving and reloading, including the style settings", async () => {
	await poll(async () => /Saved/.test(await page.locator('[data-testid="save-status"]').innerText()), "Saved", 15000)
	await page.waitForTimeout(800)
	const n = await count(page)
	await page.reload()
	await canvas.waitFor()
	await poll(countIs(page, n), `${n} objects after reload`)
	await page.getByTestId("draw-button").click()
	const item = page.getByRole("menuitem", { name: "Hand-drawn outlines" })
	assert.ok((await item.locator("svg, span").count()) > 0, "the board is still hand-drawn (a tick shows)")
	await page.keyboard.press("Escape")
})

await step("the Whiteboard template opens ready to use", async () => {
	await page.goto(page.url().replace(/\/board\/.*/, "/"))
	await page.getByRole("link", { name: "Templates" }).first().click()
	await page.getByLabel(/Search templates/i).fill("Whiteboard")
	await page.locator('article[aria-labelledby^="template-"]').first().waitFor()
	await page.getByRole("button", { name: "Use template" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	await canvas.waitFor()
	await poll(countIs(page, 3), "its three notes")
	const before = await count(page)
	await page.mouse.dblclick(origin.x + 700, origin.y + 460)
	await page.waitForTimeout(400)
	assert.equal(await page.locator('[data-testid="text-editor"]').count(), 0, "no editor opened")
	assert.equal(await count(page), before, "nothing was added")
	await shot(page, "p10-7-template")
})

await browser.close()
finish([...A.problems, ...B.problems].filter((m) => !/403|404|417|EXPECTATION/.test(m)))
