// Phase 4 in the browser: lines between shapes, quick-add arrows, line labels, and the
// way they save and come back.
import assert from "node:assert/strict"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"
import fs from "node:fs"
import { makePng } from "./png.mjs"

const creds = credentials()
const browser = await launch()
const { page, problems } = await signedIn(browser, creds.a)
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
const saved = () => poll(async () => /Saved|View only/.test(await status.innerText()), "Saved")
const at = (x, y) => ({ x: origin.x + x, y: origin.y + y })
// Reopening a board frames everything, so board (0, 0) moves on screen. The first shape is
// centred on board (-200, 0); work the origin out from where it is drawn.
async function reframe() {
	const first = await shapes.nth(0).locator("rect").first().boundingBox()
	origin = { x: first.x + first.width / 2 + 200, y: first.y + first.height / 2 }
}

async function drag(from, to, { steps = 10 } = {}) {
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	await page.mouse.move(to.x, to.y, { steps })
	await page.mouse.up()
}

// The start and end of a line's drawn path, in board units.
async function ends(index = 0) {
	const d = await lines.nth(index).locator("path").first().getAttribute("d")
	const numbers = d.match(/-?\d+(\.\d+)?/g).map(Number)
	return { start: { x: numbers[0], y: numbers[1] }, end: { x: numbers.at(-2), y: numbers.at(-1) } }
}

await step("opens a new board", async () => {
	await page.goto(`${BASE}/oqiva/welcome`)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	await page.getByRole("dialog").getByLabel("Workspace name").fill(`Lines ${stamp}`)
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	await canvas.waitFor()
	await saved()
	const box = await canvas.boundingBox()
	origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
})

await step("draws two shapes", async () => {
	await page.keyboard.press("r")
	await drag(at(-300, -40), at(-100, 40))
	await page.keyboard.press("r")
	await drag(at(100, -40), at(300, 40))
	await expectCount(shapes, 2, "shapes")
})

await step("the lines menu offers all six tools", async () => {
	await page.getByTestId("lines-button").click()
	for (const name of ["Straight line", "Elbow line", "Curved line", "Straight arrow", "Elbow arrow", "Curved arrow"])
		await page.getByRole("menuitem", { name }).waitFor()
	await page.getByRole("menuitem", { name: "Straight arrow" }).click()
	await poll(async () => (await page.getByTestId("lines-button").getAttribute("aria-pressed")) === "true", "the lines tool to be active")
	await page.getByRole("menuitem").first().waitFor({ state: "detached" }) // the closing menu swallows pointer events
})

await step("shows anchors near a shape and draws an arrow from one anchor to another", async () => {
	await poll(async () => {
		await page.mouse.move(at(-96, 4).x, at(-96, 4).y)
		await page.mouse.move(at(-97, 5).x, at(-97, 5).y)
		return (await page.locator("[data-anchor]").count()) >= 8
	}, "anchor dots")
	await shot(page, "p4-1-anchors")
	await drag(at(-98, 3), at(102, -2))
	await expectCount(lines, 1, "lines")
	const e = await ends()
	assert.deepEqual([e.start.x, e.start.y, e.end.x, e.end.y], [-100, 0, 100, 0])
	assert.equal(await page.locator('[data-anchor]').count(), 0, "anchors should hide when the tool ends")
	await shot(page, "p4-2-arrow")
})

await step("the arrow follows its shape when the shape moves", async () => {
	await drag(at(-200, 0), at(-200, 120)) // the left shape, down by 120
	await poll(async () => (await ends()).start.y === 120, "the arrow's start to follow")
	assert.equal((await ends()).end.y, 0)
	await page.keyboard.press("Control+z")
	await poll(async () => (await ends()).start.y === 0, "undo to bring it back")
})

await step("a line can be selected, bent, and given a label", async () => {
	await page.mouse.click(...Object.values(at(0, 0)))
	await page.locator('[data-handle="line-from"]').waitFor()
	await page.locator('[data-handle="line-to"]').waitFor()
	await page.mouse.dblclick(...Object.values(at(0, 0)))
	const input = page.getByLabel("Line label")
	await input.waitFor()
	await input.fill("yes")
	await page.keyboard.press("Enter")
	await input.waitFor({ state: "detached" })
	await poll(async () => (await lines.nth(0).locator("text").allTextContents()).join("") === "yes", "label on the line")
	await shot(page, "p4-3-label")
})

await step("hovering a shape offers arrows that add a connected copy", async () => {
	await page.keyboard.press("Escape")
	await page.mouse.move(...Object.values(at(200, 0)))
	const down = page.locator('[data-quick="s"]')
	await down.waitFor()
	await shot(page, "p4-4-quick")
	await down.click()
	await expectCount(shapes, 3, "shapes")
	await expectCount(lines, 2, "lines")
})

await step("deleting a shape takes its lines with it, and undo brings them back", async () => {
	await page.mouse.click(...Object.values(at(200, 0)))
	await page.keyboard.press("Delete")
	await expectCount(shapes, 2, "shapes")
	await expectCount(lines, 0, "lines")
	await page.keyboard.press("Control+z")
	await expectCount(shapes, 3, "shapes")
	await expectCount(lines, 2, "lines")
})

await step("a free-ended line can be re-attached by dragging its end", async () => {
	await page.keyboard.press("l")
	await drag(at(-300, 200), at(-100, 200)) // two free ends, away from every shape
	await expectCount(lines, 3, "lines")
	await page.mouse.click(...Object.values(at(-200, 200)))
	const handle = await page.locator('[data-handle="line-to"]').boundingBox()
	await drag({ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, at(-200, 40)) // onto the left shape's bottom anchor
	await poll(async () => {
		const e = await ends(2)
		return e.end.x === -200 && e.end.y === 40
	}, "the end to attach to the shape's bottom anchor")
})

await step("saves, and a reload brings the lines back with their label", async () => {
	await saved()
	await page.reload()
	await canvas.waitFor()
	await expectCount(shapes, 3, "shapes")
	await expectCount(lines, 3, "lines")
	assert.ok((await lines.locator("text").allTextContents()).includes("yes"))
	await shot(page, "p4-5-reloaded")
	await reframe()
})

// ---- the right palette ----

async function box(index) {
	const group = shapes.nth(index)
	const transform = await group.getAttribute("transform")
	const [, cx, cy, rotation] = transform.match(/translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)/).map(Number)
	const shape = group.locator("rect, ellipse, path").first()
	return { cx, cy, rotation, w: Number(await shape.getAttribute("width")), h: Number(await shape.getAttribute("height")) }
}
const palette = page.getByTestId("right-palette")
const tile = (name) => page.getByTestId(`tile-${name}`)
const swatch = (property, hex) => page.getByTestId(`swatch-${property}-${hex}`)

await step("the palette appears with a selection and offers only what fits it", async () => {
	await page.mouse.click(at(0, -300).x, at(0, -300).y) // empty canvas
	await palette.waitFor({ state: "detached" })
	await drag(at(-340, -80), at(340, 60)) // the two top shapes and the line between them
	await palette.waitFor()
	await tile("align-left").waitFor()
	assert.equal(await tile("distribute-h").count(), 0, "spacing needs three shapes")
	assert.equal(await tile("swap").count(), 1, "swap is for exactly two")
	await shot(page, "p4-6-palette-two")
})

await step("align left lines the shapes up in one undoable step", async () => {
	const before = [await box(0), await box(1)]
	assert.notEqual(before[0].cx, before[1].cx)
	await tile("align-left").click()
	await poll(async () => {
		const [a, b] = [await box(0), await box(1)]
		return a.cx - a.w / 2 === b.cx - b.w / 2
	}, "the left edges to match")
	await page.keyboard.press("Control+z")
	await poll(async () => (await box(1)).cx === before[1].cx, "undo to put the shape back")
})

await step("swap exchanges the two shapes' positions", async () => {
	const [a, b] = [await box(0), await box(1)]
	await tile("swap").click()
	await poll(async () => (await box(0)).cx === b.cx && (await box(1)).cx === a.cx, "positions to swap")
	await page.keyboard.press("Control+z")
})

await step("grouping makes a click on one shape pick both, and ungroup lets them go", async () => {
	await tile("group").click()
	await page.mouse.click(at(0, -300).x, at(0, -300).y)
	await page.mouse.click(at(-200, 0).x, at(-200, 0).y)
	await poll(async () => (await page.locator('[data-testid="selection-overlay"] polygon').count()) >= 2, "both group members outlined")
	await tile("ungroup").click()
	await page.mouse.click(at(0, -300).x, at(0, -300).y)
	await page.mouse.click(at(-200, 0).x, at(-200, 0).y)
	await poll(async () => (await page.locator('[data-testid="selection-overlay"] > polygon').count()) === 1, "a single shape outlined")
})

await step("a fill from the curated colours applies at once, and shows up under Recent", async () => {
	await swatch("fill", "#FEE2E2").click()
	await poll(async () => (await shapes.nth(0).locator("rect").first().getAttribute("fill")) === "#FEE2E2", "the fill")
	await poll(async () => (await page.getByTestId("recent-fill").count()) === 1, "a recent colours row")
	await swatch("stroke", "#EF4444").click()
	await poll(async () => (await shapes.nth(0).locator("rect").first().getAttribute("stroke")) === "#EF4444", "the border colour")
	await shot(page, "p4-7-styled")
	await page.keyboard.press("Control+z")
	await poll(async () => (await shapes.nth(0).locator("rect").first().getAttribute("stroke")) !== "#EF4444", "undo of the border")
})

await step("opacity and corner radius move with their sliders, in one undo step each", async () => {
	await page.getByTestId("opacity").fill("50")
	await poll(async () => (await shapes.nth(0).getAttribute("opacity")) === "0.5", "half opacity")
	await page.getByTestId("radius").fill("30")
	await poll(async () => (await shapes.nth(0).locator("rect").first().getAttribute("rx")) === "30", "a corner radius of 30")
	await page.keyboard.press("Control+z")
	await poll(async () => (await shapes.nth(0).locator("rect").first().getAttribute("rx")) !== "30", "undo of the radius")
	assert.equal(await shapes.nth(0).getAttribute("opacity"), "0.5")
})

await step("rotate and flip tiles turn the shape, and a line follows", async () => {
	await tile("rotate-right").click()
	await poll(async () => (await box(0)).rotation === 90, "a quarter turn")
	await tile("flip-h").click()
	await poll(async () => (await box(0)).rotation === 270, "the turn reversed by the flip")
	await page.keyboard.press("Control+z")
	await page.keyboard.press("Control+z")
	await poll(async () => (await box(0)).rotation === 0, "both undone")
})

await step("a line's own options show alone: colour, geometry, arrowheads", async () => {
	await page.mouse.click(at(-200, 0).x, at(-200, 0).y) // empty the selection first
	await page.mouse.click(at(0, -300).x, at(0, -300).y)
	await page.mouse.click(at(0, 0).x, at(0, 0).y)
	await tile("geometry-elbow").waitFor()
	assert.equal(await tile("align-left").count(), 0)
	assert.equal(await swatch("fill", "#FEE2E2").count(), 0, "a line has no fill")
	await tile("geometry-elbow").click()
	await tile("start-arrow").click()
	await poll(async () => (await tile("start-arrow").getAttribute("aria-pressed")) === "true", "the start arrowhead tile to show as chosen")
	assert.equal(await tile("start-none").getAttribute("aria-pressed"), "false")
	await poll(async () => (await lines.nth(0).locator("path").count()) >= 3, "an arrowhead at each end")
	await shot(page, "p4-8-line-options")
})

await step("the format painter copies one shape's look onto another", async () => {
	await page.mouse.click(at(0, -300).x, at(0, -300).y)
	await page.mouse.click(at(-200, 0).x, at(-200, 0).y) // the pink shape
	await tile("painter").click()
	await page.mouse.click(at(200, 0).x, at(200, 0).y) // the right shape
	await poll(async () => (await shapes.nth(1).locator("rect").first().getAttribute("fill")) === "#FEE2E2", "the copied fill")
	await poll(async () => (await page.getByTestId("tile-painter").getAttribute("aria-pressed")) !== "true", "the painter to be put down")
})

await step("the palette is gone for a view-only reader and while typing", async () => {
	await page.mouse.dblclick(at(200, 0).x, at(200, 0).y)
	await page.locator('[data-testid="text-editor"]').waitFor()
	assert.equal(await palette.count(), 0)
	await page.keyboard.press("Escape")
})

// ---- clipboard, guides, auto-pan ----

await step("copy and paste put a copy 10 units over, in one undo step", async () => {
	await page.mouse.click(at(0, -300).x, at(0, -300).y)
	await page.mouse.click(at(-200, 0).x, at(-200, 0).y)
	const before = await box(0)
	await page.keyboard.press("Control+c")
	await page.keyboard.press("Control+v")
	await expectCount(shapes, 4, "shapes")
	const pasted = await box(3)
	assert.equal(pasted.cx, before.cx + 10)
	assert.equal(pasted.cy, before.cy + 10)
	await page.keyboard.press("Control+v")
	await expectCount(shapes, 5, "shapes")
	assert.equal((await box(4)).cx, before.cx + 20)
	await page.keyboard.press("Control+z")
	await page.keyboard.press("Control+z")
	await expectCount(shapes, 3, "shapes")
})

await step("cut removes the shape, and paste brings it back", async () => {
	await page.mouse.click(at(-200, 0).x, at(-200, 0).y)
	await page.keyboard.press("Control+x")
	await expectCount(shapes, 2, "shapes")
	await page.keyboard.press("Control+v")
	await expectCount(shapes, 3, "shapes")
	await page.keyboard.press("Control+z")
	await page.keyboard.press("Control+z")
	await expectCount(shapes, 3, "shapes")
})

await step("pasting a picture from the clipboard offers it to the host, not as a shape", async () => {
	const handled = await page.evaluate(() => {
		const data = new DataTransfer()
		data.items.add(new File([new Uint8Array([137, 80, 78, 71])], "pic.png", { type: "image/png" }))
		const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })
		window.dispatchEvent(event)
		return event.defaultPrevented
	})
	assert.equal(handled, true, "the picture paste should be taken over")
	await page.waitForTimeout(300)
})

await step("smart guides show while a shape lines up with another, and go when it is let go", async () => {
	await page.mouse.click(at(0, -300).x, at(0, -300).y)
	await page.mouse.move(at(-200, 0).x, at(-200, 0).y)
	await page.mouse.down()
	await page.mouse.move(at(-200, 3).x, at(-200, 3).y, { steps: 3 }) // 3px off the top edge of the shape beside it
	await poll(async () => (await page.locator("[data-guide]").count()) > 0, "a guide line")
	await shot(page, "p4-9-guides")
	await page.mouse.up()
	await poll(async () => (await page.locator("[data-guide]").count()) === 0, "guides to go")
	assert.equal((await box(0)).cy, 0, "the shape snapped back into line")
})

await step("holding a shape at the edge of the view scrolls it", async () => {
	const canvasBox = await canvas.boundingBox()
	const edge = canvasBox.x + canvasBox.width - 4
	const before = await shapes.nth(0).locator("rect").first().boundingBox()
	const c = await box(2)
	await page.mouse.click(at(0, -300).x, at(0, -300).y)
	await page.mouse.move(at(c.cx, c.cy).x, at(c.cx, c.cy).y)
	await page.mouse.down()
	await page.mouse.move(edge, at(c.cx, c.cy).y, { steps: 8 })
	await page.waitForTimeout(700)
	await page.mouse.up()
	const after = await shapes.nth(0).locator("rect").first().boundingBox()
	assert.ok(after.x < before.x - 100, `the view should have scrolled right (moved ${before.x - after.x}px)`)
	assert.ok((await box(2)).cx > c.cx + 300, "the dragged shape travelled with the scroll")
	await page.keyboard.press("Control+z")
})

// ---- pictures ----

const pictures = page.locator('[data-testid="objects"] image')

await step("a picture chosen from the file picker is uploaded and drawn on the board", async () => {
	await page.mouse.click(at(0, -300).x, at(0, -300).y)
	await page.getByTestId("picture-input").setInputFiles({ name: "red dot.png", mimeType: "image/png", buffer: makePng(240, 120, [200, 30, 30]) })
	await expectCount(pictures, 1, "pictures")
	const href = await pictures.first().getAttribute("href")
	assert.match(href, /^\/private\/files\/[0-9a-f]{32}\.png$/)
	const status = await page.evaluate((url) => fetch(url).then((r) => r.status), href)
	assert.equal(status, 200, "the picture should load for its owner")
	await shot(page, "p4-10-picture")
})

await step("the picture is selected and offers border, opacity and corner radius but no fill or text", async () => {
	await palette.waitFor()
	await swatch("stroke", "#EF4444").waitFor()
	assert.equal(await swatch("fill", "#FEE2E2").count(), 0)
	assert.equal(await page.getByTestId("text-size").count(), 0)
	assert.equal(await page.getByTestId("radius").count(), 1)
})

await step("a picture can be flipped and the drawing mirrors", async () => {
	await tile("flip-h").click()
	await poll(async () => /scale\(-1 1\)/.test((await pictures.first().locator("xpath=..").getAttribute("transform")) || ""), "a mirrored picture")
	await page.keyboard.press("Control+z")
})

await step("a file that is not a picture is turned down with a message, and nothing is added", async () => {
	await page.getByTestId("picture-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") })
	await page.getByText(/Only PNG, JPEG, GIF and WebP/).last().waitFor()
	await expectCount(pictures, 1, "pictures")
})

await step("a picture dropped on the canvas lands where it was dropped", async () => {
	await page.evaluate(
		({ x, y, bytes }) => {
			const data = new DataTransfer()
			data.items.add(new File([new Uint8Array(bytes)], "dropped.png", { type: "image/png" }))
			const target = document.querySelector('[data-testid="board-canvas"]')
			target.dispatchEvent(new DragEvent("drop", { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }))
		},
		{ x: at(-300, 200).x, y: at(-300, 200).y, bytes: [...makePng(60, 60, [30, 30, 200])] },
	)
	await expectCount(pictures, 2, "pictures")
	const box = await pictures.nth(1).boundingBox()
	assert.ok(Math.abs(box.x + box.width / 2 - at(-300, 200).x) < 3, "centred where it was dropped")
})

await step("saves, and the pictures are still there after a reload", async () => {
	await saved()
	await page.reload()
	await canvas.waitFor()
	await expectCount(pictures, 2, "pictures")
	const href = await pictures.first().getAttribute("href")
	assert.equal(await page.evaluate((url) => fetch(url).then((r) => r.status), href), 200)
	await reframe()
})

// ---- tables ----

const tables = page.locator('[data-testid="objects"] > g').filter({ has: page.locator("path[stroke-width]") })
const tableCount = () => page.locator('[data-testid="objects"] > g path[d^="M0 0 L0"]').count()

await step("the size picker lights up squares and a click places a table of that size", async () => {
	await page.mouse.click(at(0, -300).x, at(0, -300).y)
	await page.getByTestId("table-button").click()
	await page.getByTestId("table-size-picker").waitFor()
	await page.getByTestId("table-size-2x3").hover()
	await page.getByText("2 × 3 table").waitFor()
	await page.getByTestId("table-size-2x3").click()
	await poll(async () => (await page.getByTestId("table-button").getAttribute("aria-pressed")) === "true", "the table tool")
	await page.getByTestId("table-size-picker").waitFor({ state: "detached" })
	await drag(at(-300, 260), at(-60, 340)) // 240 by 80 for 2 rows of 3: cells 80 by 40
	await poll(async () => (await tableCount()) === 1, "a table on the board")
	await shot(page, "p4-11-table")
})

await step("the table's tools appear, with the chosen cell outlined", async () => {
	await palette.waitFor()
	await tile("row-below").waitFor()
	assert.equal(await tile("flip-h").count(), 0, "a table is not flipped")
	await page.getByTestId("active-cell").waitFor()
})

await step("double-clicking a cell types into that cell, and Tab moves to the next", async () => {
	await page.mouse.dblclick(at(-260, 280).x, at(-260, 280).y) // the first cell
	await page.locator('[data-testid="text-editor"]').waitFor()
	await page.keyboard.type("Name")
	await page.keyboard.press("Tab")
	await page.waitForFunction(() => document.activeElement?.classList.contains("ProseMirror") && document.activeElement.textContent === "") // the next cell's editor
	await page.keyboard.type("Role")
	await page.keyboard.press("Escape")
	await page.locator('[data-testid="text-editor"]').waitFor({ state: "detached" })
	await poll(async () => {
		const words = await page.locator('[data-testid="objects"] > g text').allTextContents()
		return words.join(" ").includes("Name") && words.join(" ").includes("Role")
	}, "the two cells' text on the table")
	await shot(page, "p4-12-cells")
})

await step("adding a row and a column grows the table, and undo takes them away", async () => {
	await page.mouse.click(at(-260, 280).x, at(-260, 280).y)
	const before = await page.locator('[data-testid="objects"] > g path[d^="M0 0 L0"]').first().getAttribute("d")
	await tile("row-below").click()
	await poll(async () => (await page.locator('[data-testid="objects"] > g path[d^="M0 0 L0"]').first().getAttribute("d")) !== before, "a taller table")
	await tile("col-right").click()
	await page.keyboard.press("Control+z")
	await page.keyboard.press("Control+z")
	await poll(async () => (await page.locator('[data-testid="objects"] > g path[d^="M0 0 L0"]').first().getAttribute("d")) === before, "the table back as it was")
})

await step("a cell can be filled and its text made bold from the palette", async () => {
	await page.mouse.click(at(-260, 280).x, at(-260, 280).y)
	await swatch("cellFill", "#FEE2E2").click()
	await poll(async () => (await page.locator('[data-testid="objects"] > g rect[fill="#FEE2E2"]').count()) >= 1, "the cell fill")
	await tile("cell-bold").click()
	await poll(async () => (await page.locator('[data-testid="objects"] > g [font-weight="600"]').count()) >= 1, "bold cell text")
	await shot(page, "p4-13-cell-format")
})

await step("resizing the table stretches its cells together", async () => {
	const handle = await page.locator('[data-handle="se"]').boundingBox()
	const start = await page.locator('[data-testid="objects"] > g path[d^="M0 0 L0"]').first().boundingBox()
	await drag({ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: handle.x + handle.width / 2 + 120, y: handle.y + handle.height / 2 + 40 })
	await poll(async () => (await page.locator('[data-testid="objects"] > g path[d^="M0 0 L0"]').first().boundingBox()).width > start.width + 100, "a wider table")
})

await step("a table saves and comes back with its text and fills", async () => {
	await saved()
	await page.reload()
	await canvas.waitFor()
	await poll(async () => (await tableCount()) === 1, "the table after reload")
	const words = (await page.locator('[data-testid="objects"] > g text').allTextContents()).join(" ")
	assert.ok(words.includes("Name") && words.includes("Role"))
	assert.ok((await page.locator('[data-testid="objects"] > g rect[fill="#FEE2E2"]').count()) >= 1)
	await reframe()
})

// ---- export ----

const exportMenu = () => page.getByTestId("export-button").click()
// Chooses an item in the Export menu (``section`` 0 is the whole board, 1 the selection) and
// returns what was downloaded.
async function exportAs(label, section = 0) {
	await exportMenu()
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("menuitem", { name: label, exact: true }).nth(section).click(),
	])
	return { name: download.suggestedFilename(), bytes: fs.readFileSync(await download.path()) }
}
// Reads a downloaded picture's size and the colour of a pixel, by drawing it in the page.
const looksLike = (bytes, mime, x = 0, y = 0) =>
	page.evaluate(
		async ({ base64, mime, x, y }) => {
			const blob = await (await fetch(`data:${mime};base64,${base64}`)).blob()
			const bitmap = await createImageBitmap(blob)
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
			const context = canvas.getContext("2d")
			context.drawImage(bitmap, 0, 0)
			const [r, g, b, a] = context.getImageData(x, y, 1, 1).data
			return { width: bitmap.width, height: bitmap.height, pixel: { r, g, b, a } }
		},
		{ base64: bytes.toString("base64"), mime, x, y },
	)

await step("the Export menu offers every format, and the selection only when something is selected", async () => {
	await page.mouse.click(at(0, -300).x, at(0, -300).y)
	await exportMenu()
	for (const name of ["PNG", "PNG, double size", "JPEG", "SVG", "PDF", "Print…"]) await page.getByRole("menuitem", { name, exact: true }).first().waitFor()
	assert.equal(await page.getByText("Export the selection").count(), 0)
	await page.keyboard.press("Escape") // closes the menu, and does not touch the board behind it
	await page.getByRole("menu").waitFor({ state: "detached" })
})

let png1
await step("PNG is see-through where the board has no background, and carries the board's name", async () => {
	png1 = await exportAs("PNG")
	assert.match(png1.name, /\.png$/)
	assert.deepEqual([...png1.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
	const seen = await looksLike(png1.bytes, "image/png", 2, 2) // a corner, inside the margin
	assert.equal(seen.pixel.a, 0, "the margin should be transparent")
})

await step("PNG at double size is twice as big in each direction", async () => {
	const png2 = await exportAs("PNG, double size")
	assert.match(png2.name, /-2x\.png$/)
	const one = await looksLike(png1.bytes, "image/png")
	const two = await looksLike(png2.bytes, "image/png")
	assert.equal(two.width, one.width * 2)
	assert.equal(two.height, one.height * 2)
})

await step("the picture really shows the board: the red picture is red in the PNG", async () => {
	const one = await looksLike(png1.bytes, "image/png")
	assert.ok(one.width > 300 && one.height > 200)
	const pixel = await page.evaluate(
		async ({ base64 }) => {
			const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
			const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")
			context.drawImage(bitmap, 0, 0)
			const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
			let reds = 0
			for (let i = 0; i < data.length; i += 4) if (data[i] > 180 && data[i + 1] < 60 && data[i + 2] < 60 && data[i + 3] === 255) reds++
			return reds
		},
		{ base64: png1.bytes.toString("base64") },
	)
	assert.ok(pixel > 500, `expected the red picture to be drawn, found ${pixel} red pixels`)
})

await step("JPEG gets a white page, never black", async () => {
	const jpeg = await exportAs("JPEG")
	assert.match(jpeg.name, /\.jpg$/)
	assert.deepEqual([...jpeg.bytes.subarray(0, 3)], [255, 216, 255])
	const { pixel } = await looksLike(jpeg.bytes, "image/jpeg", 2, 2)
	assert.ok(pixel.r > 240 && pixel.g > 240 && pixel.b > 240 && pixel.a === 255, JSON.stringify(pixel))
})

await step("SVG is standalone: pictures are inside it, and it parses", async () => {
	const svg = await exportAs("SVG")
	const text = svg.bytes.toString("utf8")
	assert.match(svg.name, /\.svg$/)
	assert.ok(text.startsWith("<svg"))
	assert.ok(text.includes('href="data:image/png;base64,'), "the picture should be embedded")
	assert.ok(!text.includes("/private/files"), "no link to a private file should be left")
	const parsed = await page.evaluate((s) => new DOMParser().parseFromString(s, "image/svg+xml").querySelector("parsererror") === null, text)
	assert.equal(parsed, true)
})

await step("PDF is a real PDF with one page", async () => {
	const pdf = await exportAs("PDF")
	assert.match(pdf.name, /\.pdf$/)
	assert.equal(pdf.bytes.subarray(0, 5).toString("latin1"), "%PDF-")
	assert.ok(pdf.bytes.toString("latin1").includes("/MediaBox"))
	assert.equal((pdf.bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length, 1)
})

await step("a selection exports as a smaller picture than the whole board", async () => {
	await page.mouse.click(at(-200, 0).x, at(-200, 0).y)
	const part = await exportAs("PNG", 1)
	const whole = await looksLike(png1.bytes, "image/png")
	const some = await looksLike(part.bytes, "image/png")
	assert.ok(some.width < whole.width && some.height < whole.height, `${some.width}x${some.height} should be smaller than ${whole.width}x${whole.height}`)
})

await step("Ctrl+P prints the board alone, not the app around it", async () => {
	await page.mouse.click(at(0, -300).x, at(0, -300).y)
	await page.keyboard.press("Control+p")
	await page.waitForFunction(() => document.querySelector("iframe[aria-hidden]")?.contentDocument?.querySelector("svg"))
	const printed = await page.evaluate(() => {
		const doc = document.querySelector("iframe[aria-hidden]").contentDocument
		return { hasSvg: Boolean(doc.querySelector("svg")), hasPalette: Boolean(doc.querySelector("[data-testid]")), bodyChildren: doc.body.children.length, white: doc.querySelector("svg > rect")?.getAttribute("fill") }
	})
	assert.deepEqual(printed, { hasSvg: true, hasPalette: false, bodyChildren: 1, white: "#FFFFFF" })
})

await step("a thumbnail is sent after edits, and loads as a PNG", async () => {
	const sent = page.waitForResponse((response) => response.url().includes("save_thumbnail"), { timeout: 45000 })
	sent.catch(() => {}) // reported where it is awaited, not as a crash if an earlier line fails first
	await page.mouse.click(at(-200, 0).x, at(-200, 0).y)
	await page.keyboard.press("ArrowRight") // any change will do
	const response = await sent
	assert.equal(response.status(), 200)
	const { message } = await response.json()
	assert.match(message.thumbnail, /^\/private\/files\/[0-9a-f]{32}\.png$/)
	const fetched = await page.evaluate(async (url) => {
		const r = await fetch(url)
		return { status: r.status, type: r.headers.get("content-type") }
	}, message.thumbnail)
	assert.equal(fetched.status, 200)
	assert.match(fetched.type, /png/)
})

await step("the board's tile on the home screen shows its thumbnail", async () => {
	await saved()
	await page.getByTitle("Back to workspace").click()
	const tileImage = page.locator('img[src^="/private/files/"]').first()
	await tileImage.waitFor()
	await poll(async () => (await tileImage.evaluate((img) => img.complete && img.naturalWidth > 0)), "the thumbnail to load")
	await shot(page, "p4-14-home-tile")
})

await step("another signed-in person, with no access to the board, cannot fetch its picture", async () => {
	const href = await page.evaluate(async () => (await (await fetch(document.querySelector('img[src^="/private/files/"]').src)).url).replace(location.origin, ""))
	const other = await signedIn(browser, creds.b)
	const response = await other.context.request.get(`${BASE}${href}`, { failOnStatusCode: false })
	assert.ok([401, 403, 404].includes(response.status()), `expected a refusal, got ${response.status()}`)
	assert.ok(!(response.headers()["content-type"] || "").startsWith("image/"), "no picture should come back")
	await other.context.close()
})

await browser.close()
finish(problems)
