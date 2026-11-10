// Fixes from manual testing: hover arrows reachable by the pointer and by touch, changing a shape's
// kind, the bottom toolbar's layout, and starting a comment from the tool and from the palette.
import assert from "node:assert/strict"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const { page, problems } = await signedIn(browser, creds.c)
const stamp = Date.now().toString(36)

const shapes = page.locator('[data-testid="objects"] > g')
const lines = page.locator('[data-testid="connectors"] > g')
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

await step("opens a new board", async () => {
	await page.goto(`${BASE}/oqiva/welcome`)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	await page.getByRole("dialog").getByLabel("Workspace name").fill(`Fixes ${stamp}`)
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	await canvas.waitFor()
	await poll(async () => /Saved|View only/.test(await status.innerText()), "Saved")
	const box = await canvas.boundingBox()
	origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
})

await step("the toolbar buttons do not overlap each other", async () => {
	const boxes = await page.locator('[data-testid="palette"] button').evaluateAll((els) =>
		els.map((el) => {
			const r = el.getBoundingClientRect()
			return { title: el.title, x: r.x, y: r.y, w: r.width, h: r.height }
		}),
	)
	assert.ok(boxes.length >= 10, `found ${boxes.length} buttons`)
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]
			const b = boxes[j]
			const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5
			assert.ok(!overlap, `${a.title} overlaps ${b.title}`)
		}
	await shot(page, "fx-1-toolbar")
})

await step("draws a shape and the arrow stays while the pointer travels to it", async () => {
	await page.keyboard.press("r")
	await done()
	await drag(at(-300, -40), at(-100, 40))
	await page.keyboard.press("Escape")
	await expectCount(shapes, 1, "shapes")
	await done()
	await page.mouse.move(...Object.values(at(-200, 0)))
	const right = page.locator('[data-quick="e"]')
	await right.waitFor()
	const box = await right.boundingBox()
	// move in small steps from the shape toward the arrow, through the gap
	await done()
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 })
	assert.ok(await right.isVisible(), "arrow still there")
	await right.click()
	await expectCount(shapes, 2, "shapes")
	await expectCount(lines, 1, "lines")
})

await step("a selected shape offers its arrows without hovering (touch)", async () => {
	await done()
	await page.mouse.click(...Object.values(at(-200, 0)))
	await done()
	await page.mouse.move(origin.x + 400, origin.y + 300) // pointer far away
	const down = page.locator('[data-quick="s"]')
	await down.waitFor()
	await down.click()
	await expectCount(shapes, 3, "shapes")
})

await step("the kind of a shape can be changed from the palette", async () => {
	await done()
	await page.mouse.click(...Object.values(at(-200, 0)))
	await use("Shape")
	await page.locator('[data-testid="shape-types"]').waitFor()
	await use("Shape")
	await page.locator('[data-testid="tile-shape-diamond"]').click()
	await poll(async () => (await shapes.nth(0).locator("polygon, path").count()) > 0, "diamond drawn")
	await use("Shape")
	await page.locator('[data-testid="tile-shape-polygon"]').click()
	await use("Shape")
	await page.locator('[data-testid="polygon-sides"]').click()
	await page.getByRole("menuitem", { name: "5 sides" }).click()
	await use("Shape")
	await poll(async () => (await page.locator('[data-testid="polygon-sides"]').innerText()).includes("5"), "5 sides")
	await shot(page, "fx-2-shape")
	await page.keyboard.press("Control+z")
	await page.keyboard.press("Control+z")
	await page.keyboard.press("Control+z")
})

await step("a comment starts from the toolbar tool", async () => {
	await page.keyboard.press("Escape")
	await page.locator('[data-testid="comment-tool"]').click()
	await done()
	await page.mouse.click(...Object.values(at(-200, 0)))
	const draft = page.locator('[data-testid="comment-draft"]')
	await draft.waitFor()
	await draft.getByRole("textbox").fill("First thought")
	await draft.getByRole("button", { name: /Comment|Send|Post/ }).first().click()
	await page.locator('[data-testid="comment-thread"]').first().waitFor()
	await shot(page, "fx-3-comment")
})

await step("a comment starts from the palette on a selected shape", async () => {
	await page.keyboard.press("Escape")
	await done()
	await page.mouse.click(...Object.values(at(-200, 0)))
	await page.locator('[data-testid="tile-add-comment"]').click()
	const draft = page.locator('[data-testid="comment-draft"]')
	await draft.waitFor()
	await draft.getByRole("textbox").fill("Second thought")
	await draft.getByRole("button", { name: /Comment|Send|Post/ }).first().click()
	await expectCount(page.locator('[data-testid="comment-thread"]'), 2, "threads")
})

// the touch screen: tap instead of hover
const touch = await browser.newContext({ viewport: { width: 1360, height: 860 }, hasTouch: true, storageState: await page.context().storageState(), extraHTTPHeaders: { "x-frappe-site-name": process.env.OQIVA_E2E_SITE || "frappe.com" } })
const tpage = await touch.newPage()
tpage.setDefaultTimeout(10000)
await step("on a touch screen a tap selects, then the arrow is tapped", async () => {
	await tpage.goto(page.url())
	await tpage.locator('[data-testid="board-canvas"]').waitFor()
	await tpage.waitForTimeout(800)
	const first = await tpage.locator('[data-testid="objects"] > g').nth(0).boundingBox()
	await tpage.touchscreen.tap(first.x + first.width / 2, first.y + first.height / 2)
	const arrow = tpage.locator('[data-quick="e"]')
	await arrow.waitFor()
	const before = await tpage.locator('[data-testid="objects"] > g').count()
	const b = await arrow.boundingBox()
	await tpage.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
	await poll(async () => (await tpage.locator('[data-testid="objects"] > g').count()) === before + 1, "a new card after tap")
})
await touch.close()

const curved = async (index) => /C/.test((await lines.nth(index).locator("path").first().getAttribute("d")) || "")
await step("a chosen line type sticks for the next arrows", async () => {
	await page.keyboard.press("Escape")
	const mid = await lines.nth(0).locator("path").first().boundingBox()
	await done()
	await page.mouse.click(mid.x + mid.width / 2, mid.y + mid.height / 2)
	await use("Line")
	await page.locator('[data-testid="tile-geometry-curved"]').click()
	await poll(() => curved(0), "the first line curved")
	const before = await lines.count()
	await page.keyboard.press("Escape")
	const first = await shapes.nth(0).boundingBox()
	await done()
	await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2)
	await page.locator('[data-quick="n"]').click()
	await expectCount(lines, before + 1, "lines")
	await poll(() => curved(before), "the new arrow curved without being changed")
	await shot(page, "fx-4-sticky-line")
})

await step("a table row and a column can be resized one at a time", async () => {
	await page.keyboard.press("Escape")
	await page.getByTestId("table-button").click()
	await page.getByTestId("table-size-3x3").click()
	await done()
	await drag(at(250, 100), at(450, 220))
	const table = page.locator('[data-testid="objects"] > g path[d^="M0 0 L0"]').first()
	await table.waitFor()
	const tableBox = () => page.locator('[data-testid="selection-overlay"] > polygon').first().boundingBox()
	// the border handles are transparent lines, so find them by where they are
	const centreOf = (name) =>
		page.locator(`[data-handle="${name}"]`).evaluate((el) => {
			const r = el.getBoundingClientRect()
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
		})
	await page.locator('[data-handle="row-0"]').waitFor({ state: "attached" })
	const before = await tableBox()
	const row = await centreOf("row-0")
	await done()
	await drag(row, { x: row.x, y: row.y + 40 })
	await poll(async () => Math.abs((await tableBox()).height - (before.height + 40)) < 2, "a row 40 taller")
	assert.ok(Math.abs((await tableBox()).width - before.width) < 2, "width unchanged")
	const col = await centreOf("col-0")
	await done()
	await drag(col, { x: col.x + 30, y: col.y })
	await poll(async () => Math.abs((await tableBox()).width - (before.width + 30)) < 2, "a column 30 wider")
	await shot(page, "fx-5-table-track")
	await page.keyboard.press("Control+z")
	await poll(async () => Math.abs((await tableBox()).width - before.width) < 2, "undo of the column")
})

await step("an arrow next to a free card joins it first, and the next click adds a new card", async () => {
	await done()
	await page.keyboard.press("Escape")
	await page.keyboard.press("r")
	await drag(at(300, -250), at(420, -190))
	await page.keyboard.press("Escape")
	await page.keyboard.press("r")
	await drag(at(520, -250), at(640, -190)) // a free card 100 units to its right
	await page.keyboard.press("Escape")
	const cards = await shapes.count()
	const before = await lines.count()
	await page.mouse.click(...Object.values(at(360, -220)))
	await page.locator('[data-quick="e"]').click()
	await poll(async () => (await lines.count()) === before + 1, "a line to the card next to it")
	assert.equal(await shapes.count(), cards, "no new card yet")
	await page.mouse.click(...Object.values(at(360, -220)))
	await page.locator('[data-quick="e"]').click()
	await expectCount(shapes, cards + 1, "shapes after the second click")
})

await browser.close()
finish(problems)
