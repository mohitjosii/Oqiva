// Drives the canvas editor as a person would: draw, move, resize, rotate, type, undo, zoom,
// reload, and what happens when someone else saves first or when you may only look.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const { page, context, problems } = await signedIn(browser, creds.a)
const stamp = Date.now().toString(36)

const objects = page.locator('[data-testid="objects"] > g')
const canvas = page.locator('[data-testid="board-canvas"]')
const status = page.locator('[data-testid="save-status"]')
let origin // the page coordinates of board (0, 0)
let boardName

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
const count = () => objects.count()
const expectCount = (n) => poll(async () => (await count()) === n, `${n} objects (have ${"?"})`)
const saved = () => poll(async () => /Saved|View only/.test(await status.innerText()), "Saved")

async function geometry(index) {
	const group = objects.nth(index)
	const transform = await group.getAttribute("transform")
	const [, cx, cy, rotation] = transform.match(/translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)/).map(Number)
	const shape = group.locator("rect, ellipse, path").first()
	return { cx, cy, rotation, w: Number(await shape.getAttribute("width")), h: Number(await shape.getAttribute("height")) }
}

async function drag(from, to, { shift = false, steps = 10 } = {}) {
	await page.mouse.move(from.x, from.y)
	if (shift) await page.keyboard.down("Shift")
	await page.mouse.down()
	await page.mouse.move(to.x, to.y, { steps })
	await page.mouse.up()
	if (shift) await page.keyboard.up("Shift")
}

await step("opens a new board in the editor with its tools and a Saved indicator", async () => {
	await page.goto(`${BASE}/oqiva/welcome`)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	await page.getByRole("dialog").getByLabel("Workspace name").fill(`Editor ${stamp}`)
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	boardName = page.url().split("/board/")[1]
	await canvas.waitFor()
	await page.locator('[data-testid="palette"]').waitFor()
	await saved()
	const box = await canvas.boundingBox()
	origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
	await shot(page, "e1-empty-board")
})

await step("draws a rectangle by dragging, in any direction", async () => {
	await page.keyboard.press("r")
	await drag({ x: origin.x + 100, y: origin.y + 60 }, { x: origin.x - 100, y: origin.y - 60 })
	await expectCount(1)
	const g = await geometry(0)
	assert.deepEqual([g.cx, g.cy, g.w, g.h, g.rotation], [0, 0, 200, 120, 0])
	await shot(page, "e2-rectangle")
})

await step("moves it by dragging, as one undo step", async () => {
	await drag({ x: origin.x, y: origin.y }, { x: origin.x + 200, y: origin.y + 50 })
	const g = await geometry(0)
	assert.deepEqual([g.cx, g.cy], [200, 50])
	await page.keyboard.press("Control+z")
	assert.equal((await geometry(0)).cx, 0)
	await page.keyboard.press("Control+Shift+z")
	assert.equal((await geometry(0)).cx, 200)
})

await step("resizes from a corner handle", async () => {
	const handle = page.locator('[data-handle="se"]')
	const box = await handle.boundingBox()
	await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: origin.x + 400, y: origin.y + 160 })
	const g = await geometry(0)
	assert.deepEqual([g.w, g.h], [300, 170])
})

await step("rotates from the rotation handle, snapping with shift", async () => {
	const g = await geometry(0)
	const handle = await page.locator('[data-handle="rotate"]').boundingBox()
	await drag(
		{ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
		{ x: origin.x + g.cx + 300, y: origin.y + g.cy + 4 },
		{ shift: true },
	)
	assert.equal((await geometry(0)).rotation, 90)
	await shot(page, "e3-rotated")
})

await step("types text into a shape, then finds it drawn in the shape", async () => {
	const g = await geometry(0)
	await page.mouse.dblclick(origin.x + g.cx, origin.y + g.cy)
	await page.locator('[data-testid="text-editor"]').waitFor()
	await page.keyboard.type("Hello world")
	await shot(page, "e4a-editing")
	await page.keyboard.press("Escape")
	await page.locator('[data-testid="text-editor"]').waitFor({ state: "detached" })
	await poll(async () => (await objects.nth(0).locator("text").allTextContents()).join(" ").includes("Hello world"), "the text on the shape")
	await shot(page, "e4-text")
})

await step("formats text bold from the toolbar", async () => {
	const g = await geometry(0)
	await page.mouse.dblclick(origin.x + g.cx, origin.y + g.cy)
	await page.locator('[data-testid="text-editor"]').waitFor()
	await page.keyboard.press("Control+a")
	await page.getByRole("button", { name: "Bold" }).click()
	await page.getByRole("button", { name: "Align left" }).click()
	await page.keyboard.press("Escape")
	await poll(async () => (await objects.nth(0).locator('tspan[font-weight="600"]').count()) > 0, "bold text")
	await shot(page, "e5-bold")
})

await step("undoes the formatting and the typing, one edit at a time, and redoes them", async () => {
	await page.keyboard.press("Control+z")
	await poll(async () => (await objects.nth(0).locator('tspan[font-weight="600"]').count()) === 0, "bold undone")
	await page.keyboard.press("Control+z")
	await poll(async () => (await objects.nth(0).locator("text").count()) === 0, "text undone")
	await page.keyboard.press("Control+Shift+z")
	await page.keyboard.press("Control+Shift+z")
	await poll(async () => (await objects.nth(0).locator('tspan[font-weight="600"]').count()) > 0, "bold redone")
})

await step("a text box that is left empty leaves nothing behind", async () => {
	const before = await count()
	await page.keyboard.press("Escape") // deselect
	await page.keyboard.press("t")
	await drag({ x: origin.x - 300, y: origin.y - 200 }, { x: origin.x - 100, y: origin.y - 200 })
	await page.locator('[data-testid="text-editor"]').waitFor()
	await page.keyboard.press("Escape")
	await page.locator('[data-testid="text-editor"]').waitFor({ state: "detached" })
	await expectCount(before)
})

await step("adds a text box with text", async () => {
	const before = await count()
	await page.keyboard.press("t")
	await drag({ x: origin.x - 300, y: origin.y - 200 }, { x: origin.x - 100, y: origin.y - 200 })
	await page.locator('[data-testid="text-editor"]').waitFor()
	await page.keyboard.type("A note")
	await page.keyboard.press("Escape")
	await expectCount(before + 1)
	await poll(async () => (await page.locator('[data-testid="objects"] text').allTextContents()).join(" ").includes("A note"), "the note text")
})

await step("double-clicking empty canvas adds nothing", async () => {
	const before = await count()
	await page.mouse.dblclick(origin.x + 300, origin.y - 250)
	await page.waitForTimeout(400)
	assert.equal(await page.locator('[data-testid="text-editor"]').count(), 0, "no editor opened")
	await expectCount(before)
})

await step("duplicates and deletes, and brings a deleted shape back with undo", async () => {
	await page.mouse.click(origin.x + 200, origin.y + 50) // the rotated rectangle
	const before = await count()
	await page.keyboard.press("Control+d")
	await expectCount(before + 1)
	await page.keyboard.press("Delete")
	await expectCount(before)
	await page.keyboard.press("Control+z")
	await expectCount(before + 1)
})

await step("selects several with a marquee and nudges them with the arrow keys", async () => {
	await page.keyboard.press("Escape")
	await drag({ x: origin.x - 450, y: origin.y - 320 }, { x: origin.x + 600, y: origin.y + 420 })
	const before = await geometry(0)
	await page.keyboard.press("ArrowRight")
	await page.keyboard.press("Shift+ArrowDown")
	const after = await geometry(0)
	assert.deepEqual([after.cx - before.cx, after.cy - before.cy], [1, 10])
	await page.keyboard.press("Escape")
})

await step("zooms in tenths, with the keyboard, and fits everything", async () => {
	const level = page.locator('[data-testid="zoom-level"]')
	await page.keyboard.press("Control+0")
	await poll(async () => (await level.innerText()).trim() === "100%", "100%")
	await page.getByRole("button", { name: "Zoom in" }).click()
	await poll(async () => (await level.innerText()).trim() === "110%", "110%")
	await page.keyboard.press("Control+-")
	await page.keyboard.press("Control+-")
	await poll(async () => (await level.innerText()).trim() === "90%", "90%")
	await page.keyboard.press("Shift+1")
	await poll(async () => Number.parseInt(await level.innerText()) > 0, "fit")
	await shot(page, "e6-fit")
})

await step("zooms at the cursor with ctrl and the wheel, and pans with the wheel", async () => {
	await page.keyboard.press("Control+0")
	const first = await objects.nth(0).locator("rect, ellipse, path").first().boundingBox()
	const point = { x: first.x + first.width / 2, y: first.y + first.height / 2 }
	await page.mouse.move(point.x, point.y)
	await page.keyboard.down("Control")
	await page.mouse.wheel(0, -300)
	await page.keyboard.up("Control")
	const object = objects.nth(0)
	await poll(async () => {
		const box = await object.locator("rect, ellipse, path").first().boundingBox()
		return Math.abs(box.x + box.width / 2 - point.x) < 6 && box.width > first.width + 20
	}, "the shape staying under the cursor while it grows")
	const before = await objects.nth(0).locator("rect, ellipse, path").first().boundingBox()
	await page.mouse.wheel(0, 120)
	await poll(async () => (await objects.nth(0).locator("rect, ellipse, path").first().boundingBox()).y < before.y - 50, "panning up")
	await page.keyboard.press("Shift+1")
})

await step("shows the grid and a preset page from the canvas settings", async () => {
	await page.getByRole("button", { name: "Canvas settings" }).click()
	await page.getByRole("menuitem", { name: "Dense grid" }).click()
	await page.locator('[data-testid="grid"]').waitFor()
	await page.getByRole("button", { name: "Canvas settings" }).click()
	await page.getByRole("menuitem", { name: /A4 portrait/ }).click()
	await shot(page, "e7-a4-grid")
	await page.getByRole("button", { name: "Canvas settings" }).click()
	await page.getByRole("menuitem", { name: "Infinite canvas" }).click()
})

await step("saves on its own, and a reload brings everything back", async () => {
	await saved()
	const before = await count()
	const text = (await page.locator('[data-testid="objects"] text').allTextContents()).join(" ")
	await page.reload()
	await canvas.waitFor()
	await expectCount(before)
	assert.equal((await page.locator('[data-testid="objects"] text').allTextContents()).join(" "), text)
	await page.locator('[data-testid="grid"]').waitFor()
	await shot(page, "e8-reloaded")
})

await step("a board with 1,000 shapes draws only the ones on screen", async () => {
	const csrf = await page.evaluate(() => window.csrf_token)
	const rev = await (await context.request.get(`${BASE}/api/method/oqiva.api.board.get_revision?board=${boardName}`)).json()
	const shapes = Array.from({ length: 1000 }, (_, i) => ({
		id: `bulk${i}`,
		kind: "shape",
		shape: "rectangle",
		x: (i % 40) * 200,
		y: Math.floor(i / 40) * 130,
		w: 160,
		h: 90,
		rotation: 0,
		z: i + 1,
		style: { fill: "#E7F0FE", stroke: "#2563EB", strokeWidth: 2, dash: "solid", opacity: 1, radius: 8 },
		text: { align: "center", size: 16, color: "#1E3A8A", paragraphs: [{ runs: [{ t: `Shape ${i}` }] }] },
	}))
	const document = JSON.stringify({ schemaVersion: 1, canvas: { mode: "infinite", background: null, grid: "off" }, theme: { preset: "ocean" }, objects: shapes, connectors: [], mindmaps: [], flowcharts: [] })
	const response = await context.request.post(`${BASE}/api/method/oqiva.api.board.save_document`, {
		headers: { "x-frappe-csrf-token": csrf },
		data: { board: boardName, document, base_revision: rev.message.revision, save_id: `bulk${stamp}` },
	})
	if (!response.ok()) throw new Error(`bulk save failed: ${response.status()} ${(await response.text()).slice(0, 200)}`)
	await page.reload()
	await canvas.waitFor()
	await poll(async () => (await count()) > 0, "shapes")
	const everything = await count() // opened framed to fit, so every shape is on screen
	const texts = await page.locator('[data-testid="objects"] text').count()
	if (everything < 1000) throw new Error(`only ${everything} shapes drawn when all are on screen`)
	if (texts !== 0) throw new Error(`${texts} text labels drawn when zoomed far out; they should be skipped`)
	await page.keyboard.press("Control+0")
	await poll(async () => (await count()) < 200, "off-screen shapes to be skipped at 100%")
	const mounted = await count()
	if (mounted > 200) throw new Error(`${mounted} of 1000 shapes were drawn at 100%`)
	await shot(page, "e9-thousand-100")
	await page.keyboard.press("Shift+1")
	await page.keyboard.press("Control+a")
	await shot(page, "e10-thousand-fit")
})

await step("stops saving and says so when someone else saved first", async () => {
	const problemsBefore = problems.length
	const csrf = await page.evaluate(() => window.csrf_token)
	const rev = await (await context.request.get(`${BASE}/api/method/oqiva.api.board.get_revision?board=${boardName}`)).json()
	const ours = rev.message.revision
	const document = JSON.stringify({ schemaVersion: 1, canvas: { mode: "infinite", background: null, grid: "off" }, theme: { preset: "ocean" }, objects: [], connectors: [], mindmaps: [], flowcharts: [] })
	const response = await context.request.post(`${BASE}/api/method/oqiva.api.board.save_document`, {
		headers: { "x-frappe-csrf-token": csrf },
		data: { board: boardName, document, base_revision: ours, save_id: `other${stamp}` },
	})
	if (!response.ok()) throw new Error(`other save failed: ${response.status()}`)
	await page.keyboard.press("Escape")
	await page.keyboard.press("r")
	await drag({ x: origin.x + 100, y: origin.y + 100 }, { x: origin.x + 160, y: origin.y + 150 })
	await page.getByRole("alert").filter({ hasText: "changed somewhere else" }).waitFor({ timeout: 10000 })
	await shot(page, "e11-conflict")
	problems.splice(problemsBefore) // the refused save is the point of this step
})

await step("a view-only user can look around but not change anything", async () => {
	execFileSync(
		"bench",
		[
			"--site", process.env.OQIVA_E2E_SITE || "frappe.com", "execute", "frappe.share.add",
			"--args", JSON.stringify(["Oqiva Board", boardName, creds.b.user]),
			"--kwargs", "{'read': 1, 'write': 0, 'comment': 0, 'share': 0, 'notify': 0, 'flags': {'ignore_share_permission': True}}",
		],
		{ cwd: process.env.OQIVA_BENCH || "/home/frappe/frappe-bench", stdio: "ignore" },
	)
	const viewer = await signedIn(browser, creds.b)
	const view = viewer.page
	await view.goto(`${BASE}/oqiva/welcome`)
	await view.getByRole("button", { name: "Continue" }).click()
	await view.goto(`${BASE}/oqiva/board/${boardName}`)
	await view.locator('[data-testid="board-canvas"]').waitFor()
	await view.getByText("View only").first().waitFor()
	await view.locator('[data-testid="objects"] > g').first().waitFor()
	await view.waitForTimeout(500) // let the rest of the board finish drawing before counting
	const mounted = await view.locator('[data-testid="objects"] > g').count()
	await view.keyboard.press("r")
	await view.keyboard.press("Control+a")
	await view.keyboard.press("Delete")
	await view.mouse.dblclick(600, 400)
	await view.waitForTimeout(500)
	if ((await view.locator('[data-testid="objects"] > g').count()) !== mounted) throw new Error("a view-only user changed the board")
	if ((await view.locator('[data-testid="text-editor"]').count()) !== 0) throw new Error("a view-only user could edit text")
	if ((await view.locator("[data-handle]").count()) !== 0) throw new Error("a view-only user was offered resize handles")
	if (!(await view.getByRole("button", { name: "Shapes" }).isDisabled())) throw new Error("the shapes tool was not disabled")
	await shot(view, "e12-view-only")
	problems.push(...viewer.problems.filter((p) => !p.includes("404")))
})

await browser.close()
finish(problems)
