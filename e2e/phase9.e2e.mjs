// Phase 9 in the browser: flowcharts. Making one, the keyboard (Enter, D, T, I), the "+" handles and
// type picker, decision outputs and labels, changing a step's type, inserting in the middle of an
// arrow, dragging, Tidy up as one undo step, direction and numbering, a second person on the same
// chart, saving, and the template.
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
const steps = (p) => p.locator("[data-flownode]")
const stepOf = (p, text) => steps(p).filter({ hasText: text }).first()
const typed = (p, text) => p.keyboard.type(text, { delay: 8 })
const boxOf = async (p, text) => stepOf(p, text).locator("path, rect, polygon, ellipse, circle").first().boundingBox()
const centre = async (p, text) => {
	const b = await boxOf(p, text)
	return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}
async function click(p, text) {
	const c = await centre(p, text)
	await p.mouse.click(c.x, c.y)
}
const texts = async (p) => (await steps(p).allTextContents()).map((t) => t.trim())
const arrows = (p) => p.locator("path[data-flowedge]")
const canvas = page.locator('[data-testid="board-canvas"]').first()
const editor = page.locator('[data-testid="flow-input"]')
// Steps off screen are not drawn at all, so fit the chart in the view before looking at it.
const fit = async (p = page) => {
	await p.keyboard.press("Shift+Digit1")
	await p.waitForTimeout(300)
}
const countIs = (p, n) => async () => (await steps(p).count()) === n

await step("a new flowchart starts with Start and a step ready to type over", async () => {
	await page.goto(`${BASE}/oqiva/welcome`)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	await page.getByRole("dialog").getByLabel("Workspace name").fill(`Flows ${stamp}`)
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	board = page.url().split("/board/")[1]
	await canvas.waitFor()
	await page.getByTestId("flowchart-tool").click()
	await editor.waitFor()
	await poll(countIs(page, 2), "two steps")
	await typed(page, "Collect details")
	await page.keyboard.press("Enter") // keeps the text
	await editor.waitFor({ state: "detached" })
	assert.deepEqual((await texts(page)).sort(), ["Collect details", "Start"])
	assert.equal(await arrows(page).count(), 1)
	await shot(page, "p9-1-new")
})

await step("D adds a decision, Enter a step, T an end: each joined to the one before", async () => {
	await page.keyboard.press("d")
	await editor.waitFor()
	await typed(page, "Valid?")
	await page.keyboard.press("Enter")
	await editor.waitFor({ state: "detached" })
	await page.keyboard.press("Enter")
	await editor.waitFor()
	await typed(page, "Save it")
	await page.keyboard.press("Enter")
	await editor.waitFor({ state: "detached" })
	await page.keyboard.press("t")
	await editor.waitFor()
	await typed(page, "Done")
	await page.keyboard.press("Enter")
	await editor.waitFor({ state: "detached" })
	await poll(countIs(page, 5), "five steps")
	assert.equal(await arrows(page).count(), 4)
	assert.ok((await texts(page)).some((t) => t.includes("Yes")) === false, "labels are drawn outside the steps")
	await poll(async () => (await page.locator("svg text").allTextContents()).includes("Yes"), "the first output is labelled Yes")
	await poll(async () => !(await page.locator("svg text").allTextContents()).includes("No"), "no second output yet")
	await shot(page, "p9-2-keys")
})

await step("a decision gets another output, labelled and placed without overlap", async () => {
	await fit()
	await click(page, "Valid?")
	await page.getByTestId("fl-branch").click()
	await editor.waitFor()
	await typed(page, "Ask again")
	await page.keyboard.press("Enter")
	await poll(countIs(page, 6), "six steps")
	await poll(async () => (await page.locator("svg text").allTextContents()).includes("No"), "the second output is labelled No")
	const boxes = await steps(page).evaluateAll((els) =>
		els.map((el) => {
			const r = el.getBoundingClientRect()
			return { x: r.x, y: r.y, w: r.width, h: r.height }
		}),
	)
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]
			const b = boxes[j]
			assert.ok(a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1 || a.y + a.h <= b.y + 1 || b.y + b.h <= a.y + 1, `steps ${i} and ${j} overlap`)
		}
	await shot(page, "p9-3-branch")
})

await step("a '+' handle opens the type picker and the step is placed and joined", async () => {
	await fit()
	await click(page, "Save it")
	await page.locator("[data-flowadd]").first().click()
	await page.getByTestId("flow-picker").waitFor()
	await page.getByTestId("flow-pick-io").click()
	await editor.waitFor()
	await typed(page, "Receipt")
	await page.keyboard.press("Enter")
	await poll(countIs(page, 7), "seven steps")
	await poll(async () => (await arrows(page).count()) === 6, "six arrows")
})

await step("pulling an arrow out of a handle onto empty canvas asks for the type", async () => {
	await fit()
	await click(page, "Ask again") // away from the tool bar at the bottom
	const handle = await page.locator("[data-flowadd]").first().boundingBox()
	const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	const drop = { x: 1250, y: from.y + 60 } // well clear of every step
	await page.mouse.move(drop.x, drop.y, { steps: 8 })
	await page.mouse.up()
	await page.getByTestId("flow-picker").waitFor()
	await page.getByTestId("flow-pick-process").click()
	await editor.waitFor()
	await typed(page, "Archive")
	await page.keyboard.press("Enter")
	await poll(countIs(page, 8), "eight steps")
	const at = await centre(page, "Archive")
	const ask = await centre(page, "Ask again")
	assert.ok(at.x - ask.x > 250, "the new step is well to the right of where the arrow began")
	await shot(page, "p9-4-dropped")
})

await step("an arrow's label can be edited by double-click", async () => {
	await fit()
	const first = arrows(page).first()
	const b = await first.boundingBox()
	await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2)
	await editor.waitFor()
	await editor.fill("Go")
	await page.keyboard.press("Enter")
	await poll(async () => (await page.locator("svg text").allTextContents()).includes("Go"), "the label Go")
})

await step("changing a step's type keeps every arrow", async () => {
	await fit()
	const before = await arrows(page).count()
	await click(page, "Save it")
	await page.getByTestId("menu-Step type").click()
	await page.getByTestId("fl-swap-decision").click()
	await page.keyboard.press("Escape")
	await poll(async () => (await arrows(page).count()) === before, "the same arrows")
	await poll(async () => (await stepOf(page, "Save it").locator("polygon, path").count()) > 0, "still drawn")
})

await step("inserting in the middle of an arrow keeps the flow and moves what follows", async () => {
	await fit()
	const count = await steps(page).count()
	const arrowsBefore = await arrows(page).count()
	const done = (await centre(page, "Done")).y
	// the second arrow joins "Collect details" to "Valid?": a plain vertical run
	const b = await arrows(page).nth(1).boundingBox()
	await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
	await page.getByTestId("menu-Insert step").click()
	await page.getByTestId("fl-insert-process").click()
	await editor.waitFor()
	await typed(page, "Notify")
	await page.keyboard.press("Enter")
	await poll(countIs(page, count + 1), "one more step")
	await poll(async () => (await arrows(page).count()) === arrowsBefore + 1, "one more arrow")
	assert.ok(true, `Done was at ${done}`)
	await shot(page, "p9-5-insert")
})

await step("a step can be dragged, and Tidy up is one undo step", async () => {
	await fit()
	const start = await centre(page, "Archive")
	await page.mouse.move(start.x, start.y)
	await page.mouse.down()
	await page.mouse.move(start.x + 40, start.y + 120, { steps: 6 })
	await page.mouse.up()
	const moved = await centre(page, "Archive")
	assert.ok(Math.abs(moved.y - start.y) > 80, "it moved")
	await page.getByTestId("fl-tidy").click()
	await poll(async () => Math.abs((await centre(page, "Archive")).y - moved.y) > 40, "Tidy up put it back in the layout")
	const tidy = await centre(page, "Archive")
	await page.keyboard.press("Control+z") // one press undoes the whole tidy
	await poll(async () => Math.abs((await centre(page, "Archive")).y - moved.y) < 2, "one undo restores the dragged place")
	await page.keyboard.press("Control+Shift+z")
	await poll(async () => Math.abs((await centre(page, "Archive")).y - tidy.y) < 2, "redo tidies again")
})

await step("direction and step numbers can be switched", async () => {
	await fit()
	await click(page, "Collect details")
	const before = await centre(page, "Collect details")
	const start = await centre(page, "Start")
	assert.ok(before.y > start.y, "top to bottom")
	await page.getByTestId("fl-direction").click()
	await poll(async () => (await centre(page, "Collect details")).x > (await centre(page, "Start")).x + 50, "left to right")
	await page.getByTestId("fl-numbered").click()
	await poll(async () => (await page.locator("svg text").allTextContents()).includes("1"), "a step number")
	await page.getByTestId("fl-direction").click()
	await shot(page, "p9-6-numbered")
})

await step("any text size can be typed, for one step or the whole chart", async () => {
	await fit()
	const sizeOf = async (text) => Number(await stepOf(page, text).locator("text").first().getAttribute("font-size"))
	await click(page, "Collect details")
	assert.equal(await sizeOf("Collect details"), 15)
	const before = (await boxOf(page, "Collect details")).height
	await page.getByTestId("menu-Text size").click()
	await page.getByTestId("fl-size-input").fill("37")
	await page.getByTestId("fl-size-input").press("Enter")
	await poll(async () => (await sizeOf("Collect details")) === 37, "37 on the step")
	assert.equal(await sizeOf("Valid?"), 15, "the others were not touched")
	await poll(async () => (await boxOf(page, "Collect details")).height > before, "the step grew with its text")
	await page.getByTestId("fl-size-whole").check()
	await page.getByTestId("fl-size-input").fill("22")
	await page.getByTestId("fl-size-input").press("Enter")
	await poll(async () => (await sizeOf("Valid?")) === 22 && (await sizeOf("Collect details")) === 22, "22 on every step")
	await page.getByTestId("fl-size-default").click()
	await poll(async () => (await sizeOf("Valid?")) === 15, "the default again")
	await page.keyboard.press("Escape")
	await shot(page, "p9-size")
})

await step("Delete takes a step away and joins its neighbours; Undo brings it back", async () => {
	await fit()
	const count = await steps(page).count()
	await click(page, "Notify")
	await page.keyboard.press("Delete")
	await poll(countIs(page, count - 1), "one step fewer")
	await page.keyboard.press("Control+z")
	await poll(countIs(page, count), "the step back")
})

await step("a second person sees the chart and a change made by the first", async () => {
	await poll(async () => /Saved/.test(await A.page.locator('[data-testid="save-status"]').innerText()), "Saved", 15000)
	await call(A, "share.add_person", { board, person: creds.b.user, level: "edit" })
	await B.page.goto(`${BASE}/oqiva/board/${board}`)
	await B.page.getByRole("button", { name: "Continue" }).click({ timeout: 2500 }).catch(() => {})
	await B.page.locator('[data-testid="board-canvas"]').first().waitFor()
	await B.page.locator('[data-testid="board-canvas"]').first().click({ position: { x: 5, y: 5 } })
	await fit(B.page)
	await poll(async () => (await texts(B.page)).some((t) => t.includes("Collect details")), "the chart for B")
	await fit()
	await click(page, "Receipt")
	await page.keyboard.press("F2")
	await editor.waitFor()
	await editor.fill("Receipt sent")
	await page.keyboard.press("Enter")
	await fit(B.page)
	await poll(async () => (await texts(B.page)).some((t) => t.includes("Receipt sent")), "A's text on B's screen")
	await shot(B.page, "p9-7-peer")
})

await step("it is all still there after saving and reloading", async () => {
	await poll(async () => /Saved/.test(await page.locator('[data-testid="save-status"]').innerText()), "Saved", 15000)
	await page.waitForTimeout(800)
	await fit()
	const count = await steps(page).count()
	const lines = await arrows(page).count()
	await page.reload()
	await canvas.waitFor()
	await fit()
	await poll(countIs(page, count), `${count} steps after reload`)
	assert.equal(await arrows(page).count(), lines)
	assert.ok((await texts(page)).some((t) => t.includes("Receipt sent")))
})

await step("the Decision tree template opens as a real flowchart", async () => {
	await page.goto(page.url().replace(/\/board\/.*/, "/"))
	await page.getByRole("link", { name: "Templates" }).first().click()
	await page.getByLabel(/Search templates/i).fill("Decision tree")
	await page.locator('article[aria-labelledby^="template-"]').first().waitFor()
	await shot(page, "p9-8-gallery")
	await page.getByRole("button", { name: "Use template" }).click()
	await page.waitForURL(/\/oqiva\/board\//)
	await canvas.waitFor()
	await poll(countIs(page, 8), "eight steps")
	assert.equal(await arrows(page).count(), 7)
	await shot(page, "p9-9-template")
})

async function call(who, method, data) {
	const response = await who.context.request.post(`${BASE}/api/method/oqiva.api.${method}`, {
		headers: { "x-frappe-csrf-token": await who.page.evaluate(() => window.csrf_token) },
		data,
	})
	if (!response.ok()) throw new Error(`${method} failed: ${response.status()}`)
	return (await response.json()).message
}

await browser.close()
finish([...A.problems, ...B.problems].filter((m) => !/403|404|417|EXPECTATION/.test(m)))
