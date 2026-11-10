// Phase 6 in the browser: the shape library, sticky notes, frames and sections, icons and emoji,
// links, the minimap, and templates.
import assert from "node:assert/strict"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const { page, problems } = await signedIn(browser, creds.a)
const stamp = Date.now().toString(36)

const shapes = page.locator('[data-testid="objects"] > g')
const canvas = page.locator('[data-testid="board-canvas"]')
const status = page.locator('[data-testid="save-status"]')
let origin
const poll = async (check, what, ms = 8000) => {
	const end = Date.now() + ms
	let last
	while (Date.now() < end) {
		try {
			last = await check()
			if (last) return last
		} catch (error) {
			last = error.message
		}
		await page.waitForTimeout(100)
	}
	throw new Error(`Timed out waiting for ${what}${last ? ` (last: ${String(last).slice(0, 120)})` : ""}`)
}
const expectCount = (locator, n, what) => poll(async () => (await locator.count()) === n, `${n} ${what}`)
const at = (x, y) => ({ x: origin.x + x, y: origin.y + y })
const use = async (menu) => {
	const body = page.getByTestId(`menu-body-${menu}`)
	if (!(await body.isVisible().catch(() => false))) await page.getByTestId(`menu-${menu}`).click()
	await body.waitFor()
}
// Close an open menu before pressing on the board: the menu would be in the way.
const done = async () => {
	const open = page.locator('[data-testid^="menu-body-"]')
	if (await open.count()) {
		await page.keyboard.press("Escape")
		await open.waitFor({ state: "detached" }).catch(() => {})
	}
}
const saved = () => poll(async () => /Saved|View only/.test(await status.innerText()), "Saved")
async function drag(from, to) {
	await done()
	await page.mouse.move(from.x, from.y)
	await done()
	await page.mouse.down()
	await done()
	await page.mouse.move(to.x, to.y, { steps: 10 })
	await done()
	await page.mouse.up()
}
const typed = (text) => page.keyboard.type(text, { delay: 5 })
const objects = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="objects"] > g')].length)

await step("opens a new board", async () => {
	await page.goto(`${BASE}/oqiva/welcome`)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	await page.getByRole("dialog").getByLabel("Workspace name").fill(`Six ${stamp}`)
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	await canvas.waitFor()
	await saved()
	const box = await canvas.boundingBox()
	origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
})

await step("the toolbar still has no overlapping buttons", async () => {
	const boxes = await page.locator('[data-testid="palette"] button').evaluateAll((els) =>
		els.map((el) => {
			const r = el.getBoundingClientRect()
			return { title: el.title, x: r.x, y: r.y, w: r.width, h: r.height }
		}),
	)
	assert.ok(boxes.length >= 14, `found ${boxes.length} buttons`)
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]
			const b = boxes[j]
			const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5
			assert.ok(!overlap, `${a.title} overlaps ${b.title}`)
		}
	await shot(page, "p6-1-toolbar")
})

await step("Shift+S opens the library, search narrows it, a click adds a shape to type over", async () => {
	await page.keyboard.press("Shift+S")
	const library = page.locator('[data-testid="shape-library"]')
	await library.waitFor()
	assert.ok((await library.locator("[data-preset]").count()) >= 26)
	await page.locator('[data-testid="library-search"]').fill("db")
	await expectCount(library.locator("[data-preset]"), 1, "matches for db")
	await library.locator('[data-preset="database"]').click()
	await expectCount(shapes, 1, "shapes")
	await poll(async () => (await page.locator('[data-testid="text-editor"]').count()) === 1, "the label editor")
	await typed("Orders DB")
	await page.keyboard.press("Escape")
	await poll(async () => (await shapes.nth(0).textContent()).includes("Orders DB"), "the label replaced")
	assert.ok(!(await shapes.nth(0).textContent()).includes("Database"))
	await shot(page, "p6-2-library")
})

await step("a second click adds the next shape beside the selected one, clear of it", async () => {
	await page.locator('[data-testid="library-search"]').fill("")
	await page.locator('[data-preset="server"]').first().click()
	await expectCount(shapes, 2, "shapes")
	await page.keyboard.press("Escape")
	const a = await shapes.nth(0).boundingBox()
	const b = await shapes.nth(1).boundingBox()
	assert.ok(b.x >= a.x + a.width - 1 || b.y >= a.y + a.height - 1, "the new shape overlaps the first")
})

await step("the arrow keys walk the library grid and Enter adds the shape", async () => {
	const before = await shapes.count()
	await page.locator('[data-testid="library-search"]').focus()
	await page.keyboard.press("ArrowDown")
	const first = await page.evaluate(() => document.activeElement?.dataset?.tile)
	assert.ok(first, "a tile took the focus")
	await page.keyboard.press("ArrowRight")
	const second = await page.evaluate(() => document.activeElement?.dataset?.tile)
	assert.notEqual(first, second)
	await page.keyboard.press("Enter")
	await expectCount(shapes, before + 1, "shapes after Enter")
	await page.keyboard.press("Escape")
	await page.keyboard.press("Escape")
	const count = await shapes.count()
	assert.equal(count, before + 1)
})

await step("a shape dragged from the library lands where it is dropped", async () => {
	const dragFrom = await shapes.count()
	const tile = page.locator('[data-preset="decision"]').first()
	await tile.scrollIntoViewIfNeeded()
	const from = await tile.boundingBox()
	const drop = at(250, 120)
	await done()
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
	await done()
	await page.mouse.down()
	await done()
	await page.mouse.move(drop.x, drop.y, { steps: 12 })
	await page.locator('[data-testid="shape-drag-preview"]').waitFor()
	await done()
	await page.mouse.up()
	await expectCount(shapes, dragFrom + 1, "shapes")
	await page.keyboard.press("Escape")
	const box = await shapes.nth(dragFrom).boundingBox()
	assert.ok(Math.abs(box.x + box.width / 2 - drop.x) < 6 && Math.abs(box.y + box.height / 2 - drop.y) < 6, "dropped at the pointer")
	await page.keyboard.press("Escape")
	await page.locator('[aria-label="Close the shape library"]').click()
})

await step("a sticky note takes text with a bullet, and Tab writes the next one", async () => {
	await page.keyboard.press("Escape")
	const notesFrom = await shapes.count()
	await page.keyboard.press("n")
	await done()
	await page.mouse.click(...Object.values(at(-350, -250)))
	await poll(async () => (await page.locator('[data-testid="text-editor"]').count()) === 1, "note editor")
	await typed("- first")
	await page.keyboard.press("Tab")
	await poll(async () => (await shapes.count()) === notesFrom + 2, "a second note", 4000)
	await typed("second")
	await page.keyboard.press("Escape")
	const text = await page.locator('[data-testid="objects"]').textContent()
	assert.ok(text.includes("• first") && text.includes("second"), text)
	await shot(page, "p6-3-notes")
})

await step("a frame is a named section that can be jumped to", async () => {
	await page.keyboard.press("Escape")
	await page.keyboard.press("f")
	await done()
	await drag(at(-420, 60), at(-120, 260))
	await use("Section name")
	await page.locator('[data-testid="frame-name"]').waitFor()
	await use("Section name")
	await page.locator('[data-testid="frame-name"]').fill("Plan")
	await use("Section name")
	await page.locator('[data-testid="frame-name"]').press("Tab")
	await poll(async () => (await page.locator('[data-testid="objects"]').textContent()).includes("Plan"), "the section name drawn")
	await page.keyboard.press("Escape")
	await page.locator('[data-testid="sections-button"]').click()
	await page.getByRole("menuitem", { name: "Plan" }).click()
	await shot(page, "p6-4-frame")
})

await step("a double-click on a section's name edits it, and makes no card", async () => {
	await done()
	await page.keyboard.press("Escape")
	await page.keyboard.press("Shift+1") // frame everything, so the frame's name is on screen
	await page.waitForTimeout(400)
	const before = await shapes.count()
	const name = page.locator('[data-testid="objects"] text', { hasText: "Plan" }).first()
	const box = await name.boundingBox()
	await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
	const input = page.locator('[data-testid="frame-name-input"]')
	await input.waitFor()
	await input.fill("Roadmap")
	await input.press("Enter")
	await input.waitFor({ state: "detached" })
	await poll(async () => (await page.locator('[data-testid="objects"]').textContent()).includes("Roadmap"), "the new name drawn")
	assert.equal(await shapes.count(), before, "a double-click on the name made no card")
	await page.keyboard.press("Control+z")
	await poll(async () => (await page.locator('[data-testid="objects"]').textContent()).includes("Plan"), "undo of the rename")
})

await step("icons and emoji can be placed", async () => {
	await page.keyboard.press("Escape")
	const before = await shapes.count()
	await page.locator('[data-testid="icons-button"]').click()
	await page.locator('[data-testid="icon-picker"]').waitFor()
	await page.locator('[data-testid="picker-search"]').fill("serv")
	await page.locator('[data-icon="server"]').click()
	await expectCount(shapes, before + 1, "objects after an icon")
	await page.keyboard.press("Escape")
	await page.locator('[data-testid="icons-button"]').click()
	await page.locator('[data-testid="picker-tab-emoji"]').click()
	await page.locator('[data-emoji="🚀"]').click()
	await expectCount(shapes, before + 2, "objects after an emoji")
	assert.ok((await page.locator('[data-testid="objects"]').textContent()).includes("🚀"))
})

await step("a link on an object shows a badge that opens the address", async () => {
	await page.keyboard.press("Escape")
	await done()
	const first = await shapes.filter({ hasText: "Orders DB" }).first().boundingBox()
	await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2)
	await use("Link")
	await page.locator('[data-testid="link-url"]').fill("javascript:alert(1)")
	await use("Link")
	await page.locator('[data-testid="link-add"]').click()
	await page.getByRole("alert").filter({ hasText: "web address" }).waitFor()
	await use("Link")
	await page.locator('[data-testid="link-url"]').fill("example.com/docs")
	await use("Link")
	await page.locator('[data-testid="link-add"]').click()
	await page.locator('[data-testid="link-badge"]').waitFor()
	const popup = page.waitForEvent("popup", { timeout: 5000 }).catch(() => null)
	await page.locator('[data-testid="link-badge"]').click()
	const opened = await popup
	assert.ok(opened && opened.url().startsWith("https://example.com/docs"), `opened ${opened?.url()}`)
	await opened.close()
	await shot(page, "p6-5-link")
})

await step("the minimap shows the board and moves the view", async () => {
	await done()
	await page.keyboard.press("Escape")
	const map = page.locator('[data-testid="minimap"]')
	await map.waitFor()
	await page.locator('[data-testid="minimap-view"]').waitFor()
	const mark = page.locator('[data-testid="objects"] > g').filter({ hasText: "Orders DB" }).first()
	const before = await mark.boundingBox()
	const mapBox = await map.boundingBox()
	await page.mouse.click(mapBox.x + 12, mapBox.y + 12)
	await poll(async () => {
		const after = await mark.boundingBox().catch(() => null)
		return !after || Math.abs(after.x - before.x) > 3 || Math.abs(after.y - before.y) > 3
	}, "the board scrolling under the view")
	await shot(page, "p6-6-minimap")
})

await step("everything is still there after saving and reloading", async () => {
	await saved()
	await page.waitForTimeout(800)
	await page.keyboard.press("Shift+1") // frame everything, so every object is drawn and can be counted
	await page.waitForTimeout(400)
	const count = await shapes.count()
	await page.reload()
	await canvas.waitFor()
	await poll(async () => (await shapes.count()) === count, `${count} objects after reload`)
	const text = await page.locator('[data-testid="objects"]').textContent()
	assert.ok(text.includes("Orders DB") && text.includes("Plan") && text.includes("🚀"))
	await page.locator('[data-testid="link-badge"]').waitFor()
})

await step("the templates page lists the templates, and one makes a board", async () => {
	await page.getByRole("link", { name: /Back|Home/ }).first().click().catch(() => {})
	await page.goto(page.url().replace(/\/board\/.*/, "/"))
	await page.getByRole("link", { name: "Templates" }).first().click()
	await page.getByRole("heading", { name: "Templates" }).first().waitFor()
	await poll(async () => (await page.locator('article[aria-labelledby^="template-"]').count()) >= 19, "19 template cards")
	await shot(page, "p6-7-templates")
	await page.getByLabel(/Search templates/i).fill("kanban")
	await expectCount(page.locator('article[aria-labelledby^="template-"]'), 1, "kanban card")
	await page.locator('article[aria-labelledby^="template-"]').getByRole("button", { name: /Use template/ }).click()
	await page.waitForURL(/\/oqiva\/board\//)
	await canvas.waitFor()
	await poll(async () => (await shapes.count()) === 7, "the kanban board's 7 objects")
	await shot(page, "p6-8-kanban")
})

await step("every template opens as an editable board", async () => {
	const names = ["Dashboard wireframe", "Mobile app flow", "Entity relationships", "Sign-in screen", "Retrospective", "Web application architecture", "Incident response", "Customer journey"]
	for (const [i, name] of names.entries()) {
		await page.goto(page.url().replace(/\/board\/.*/, "/"))
		await page.getByRole("link", { name: "Templates" }).first().click()
		await page.getByLabel(/Search templates/i).fill(name)
		await expectCount(page.locator('article[aria-labelledby^="template-"]'), 1, `card for ${name}`)
		await page.getByRole("button", { name: "Use template" }).click()
		await page.waitForURL(/\/oqiva\/board\//)
		await canvas.waitFor()
		await poll(async () => (await shapes.count()) > 0, `${name} drawn`)
		await page.waitForTimeout(500)
		await shot(page, `p6-t${i}-${name.replace(/\W+/g, "-").toLowerCase()}`)
	}
})

await browser.close()
finish(problems)
