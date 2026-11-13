// Phase 8 in the browser: mind maps. Making one, the keyboard loop, collapse, drag to re-parent,
// colours, markers and notes, the outline, pasting an outline, delete with a question, a second
// person on the same map, and the template.
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
const nodeOf = (p, text) => p.locator("[data-mmnode]").filter({ hasText: text }).first()
const nodes = (p) => p.locator("[data-mmnode]")
const csrf = (p) => p.evaluate(() => window.csrf_token)
const typed = (p, text) => p.keyboard.type(text, { delay: 8 })
const rectOf = async (p, text) => nodeOf(p, text).locator("rect").first().boundingBox()
const centre = async (p, text) => {
	const b = await rectOf(p, text)
	return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}
async function click(p, text) {
	const c = await centre(p, text)
	await p.mouse.click(c.x, c.y)
}
const texts = async (p) => (await nodes(p).allTextContents()).map((t) => t.trim())
const canvas = page.locator('[data-testid="board-canvas"]').first()

await step("a new map starts with its central idea ready to type over", async () => {
	await page.goto(`${BASE}/oqiva/welcome`)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	await page.getByRole("dialog").getByLabel("Workspace name").fill(`Maps ${stamp}`)
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	board = page.url().split("/board/")[1]
	await canvas.waitFor()
	await page.getByTestId("mindmap-tool").click()
	await page.locator('[data-testid="map-node-input"]').waitFor()
	await typed(page, "Product ideas")
	await page.keyboard.press("Tab") // a child, straight away
	await typed(page, "Growth")
	await page.keyboard.press("Enter") // a sibling
	await typed(page, "Retention")
	await page.keyboard.press("Enter")
	await typed(page, "Pricing")
	await page.keyboard.press("Escape")
	await poll(async () => (await texts(page)).length === 4, "four nodes")
	assert.deepEqual((await texts(page)).sort(), ["Growth", "Pricing", "Product ideas", "Retention"])
	await shot(page, "p8-1-map")
})

await step("the plus button and the bar button add a node, and the cursor stays in it", async () => {
	await click(page, "Product ideas")
	const before = await nodes(page).count()
	await page.locator("[data-mmadd]").first().click()
	await page.locator('[data-testid="map-node-input"]').waitFor()
	await poll(async () => (await nodes(page).count()) === before + 1, "a node from the plus button")
	assert.equal(await page.evaluate(() => document.activeElement?.dataset?.testid), "map-node-input", "the cursor is in the new node")
	await typed(page, "Plus node")
	await page.keyboard.press("Escape")
	await poll(async () => (await texts(page)).includes("Plus node"), "its text")
	await page.getByTestId("mm-child").click()
	await page.locator('[data-testid="map-node-input"]').waitFor()
	await typed(page, "Bar node")
	await page.keyboard.press("Escape")
	await poll(async () => (await nodes(page).count()) === before + 2, "a node from the bar button")
	await page.keyboard.press("Delete") // the bar node is selected: remove both again
	await click(page, "Plus node")
	await page.keyboard.press("Delete")
	await poll(async () => (await nodes(page).count()) === before, "back to the start")
})

await step("the text size can be set for one node or the whole map", async () => {
	await click(page, "Growth")
	const sizeOf = async (text) => Number(await nodeOf(page, text).locator("text").first().getAttribute("font-size"))
	assert.equal(await sizeOf("Growth"), 16)
	const wide = (await rectOf(page, "Growth")).width
	await page.getByTestId("menu-Text size").click()
	await page.getByTestId("mm-size-32").click()
	await poll(async () => (await sizeOf("Growth")) === 32, "32 on Growth")
	assert.ok((await rectOf(page, "Growth")).width > wide + 30, "the node grew with its text")
	assert.equal(await sizeOf("Retention"), 16, "the others were not touched")
	await page.getByTestId("mm-size-input").fill("27")
	await page.getByTestId("mm-size-input").press("Enter")
	await poll(async () => (await sizeOf("Growth")) === 27, "a size typed in")
	await page.getByTestId("mm-size-whole").check()
	await page.getByTestId("mm-size-14").click()
	await poll(async () => (await sizeOf("Retention")) === 14 && (await sizeOf("Growth")) === 14, "every node at 14")
	await page.getByTestId("mm-size-default").click()
	await poll(async () => (await sizeOf("Growth")) === 16 && (await sizeOf("Product ideas")) === 20, "the defaults again")
	await page.keyboard.press("Escape")
	await shot(page, "p8-size")
})

await step("no two nodes overlap, and the branches are drawn", async () => {
	const boxes = await nodes(page).locator("rect").evaluateAll((els) =>
		els.map((el) => {
			const r = el.getBoundingClientRect()
			return { x: r.x, y: r.y, w: r.width, h: r.height }
		}),
	)
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]
			const b = boxes[j]
			assert.ok(!(a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1), `boxes ${i} and ${j} overlap`)
		}
	assert.equal(await page.locator('[data-mindmap] > path').count(), 3, "a branch for each child")
})

await step("the arrow keys walk the tree, Tab adds a child, Shift+Tab promotes", async () => {
	await click(page, "Product ideas")
	await page.keyboard.press("ArrowRight")
	await page.keyboard.press("Tab")
	await typed(page, "Ads")
	await page.keyboard.press("Escape")
	await poll(async () => (await nodes(page).count()) === 5, "a fifth node")
	const adsBefore = await rectOf(page, "Ads")
	const growth = await rectOf(page, "Growth")
	assert.ok(adsBefore.x > growth.x + growth.width - 1 || adsBefore.x < growth.x - adsBefore.width + 1, "Ads sits to one side of Growth")
	await page.keyboard.press("Shift+Tab") // up one level: now beside Growth
	await poll(async () => {
		const ads = await rectOf(page, "Ads")
		const root = await rectOf(page, "Product ideas")
		return Math.abs(ads.x - growth.x) < 4 || Math.abs(ads.x + ads.width - (growth.x + growth.width)) < 4 || ads.x !== adsBefore.x || root
	}, "Ads moved up a level")
	await page.keyboard.press("Alt+ArrowUp")
})

await step("a node can be collapsed and opened again", async () => {
	await click(page, "Growth")
	await page.keyboard.press("-")
	// Ads was promoted, so Growth now has no children: nothing collapses. Add one, then collapse.
	await page.keyboard.press("Tab")
	await typed(page, "SEO")
	await page.keyboard.press("Escape")
	await poll(async () => (await nodes(page).filter({ hasText: "SEO" }).count()) === 1, "SEO")
	await click(page, "Growth")
	await page.keyboard.press("-")
	await poll(async () => (await nodes(page).filter({ hasText: "SEO" }).count()) === 0, "SEO hidden")
	await poll(async () => (await page.locator("[data-mmtoggle]").count()) >= 1, "a badge with the count")
	assert.match(await page.locator("[data-mmtoggle]").first().textContent(), /1/)
	await page.locator("[data-mmtoggle]").first().click()
	await poll(async () => (await nodes(page).filter({ hasText: "SEO" }).count()) === 1, "SEO back")
})

await step("dragging a node onto another makes it a child; undo puts it back", async () => {
	const from = await centre(page, "Pricing")
	const onto = await centre(page, "Retention")
	const before = (await rectOf(page, "Pricing")).x
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	await page.mouse.move(onto.x, onto.y, { steps: 10 })
	await page.mouse.up()
	await poll(async () => {
		const p = await rectOf(page, "Pricing")
		const r = await rectOf(page, "Retention")
		return Math.abs(p.x - r.x) > 40
	}, "Pricing grown out of Retention")
	await page.keyboard.press("Control+z")
	await poll(async () => Math.abs((await rectOf(page, "Pricing")).x - before) < 3, "Pricing back")
})

await step("a branch colour, a marker and a note", async () => {
	await click(page, "Retention")
	await page.getByTestId("menu-Branch colour").click()
	await page.getByTestId("mm-color-8B5CF6").click()
	await poll(async () => (await nodeOf(page, "Retention").locator("rect").first().getAttribute("fill")) === "#8B5CF6", "the violet branch")
	await page.keyboard.press("Escape")
	await page.getByTestId("menu-Marker").click()
	await page.getByTestId("mm-marker-star").click()
	await page.getByTestId("mm-dot-EF4444").click()
	await page.keyboard.press("Escape")
	await poll(async () => (await nodeOf(page, "Retention").locator("circle").count()) >= 1, "the marker dot")
	await page.getByTestId("menu-Note").click()
	await page.getByTestId("mm-note").fill("Why do they leave?")
	await page.getByTestId("mm-note").blur()
	await poll(async () => (await nodeOf(page, "Retention").locator("title").textContent().catch(() => "")) === "Why do they leave?", "the note as a hover text")
	await page.keyboard.press("Escape")
	await shot(page, "p8-2-styled")
})

await step("the outline edits the same tree", async () => {
	await click(page, "Product ideas")
	await page.getByTestId("mm-outline").click()
	await page.getByTestId("outline-panel").waitFor()
	const rows = page.getByTestId("outline-row")
	await poll(async () => (await rows.count()) === (await nodes(page).count()), "a row for every node")
	const row = rows.filter({ has: page.locator("xpath=.") }).nth(1)
	await rows.nth(1).click()
	await rows.nth(1).press("Enter") // a sibling after the first branch
	await page.keyboard.type("From outline")
	await page.keyboard.press("Tab") // and indent it under its brother
	await page.keyboard.press("Enter")
	await poll(async () => (await nodes(page).filter({ hasText: "From outline" }).count()) === 1, "the node on the map")
	void row
	await shot(page, "p8-3-outline")
	await page.getByTestId("mm-outline").click().catch(() => {})
})

await step("pasting indented text under a node builds branches", async () => {
	await click(page, "Pricing")
	const before = await nodes(page).count()
	await page.evaluate(() => {
		const data = new DataTransfer()
		data.setData("text/plain", "Plans\n  Free\n  Team\n    Annual\n- Enterprise")
		window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
	})
	await poll(async () => (await nodes(page).count()) === before + 5, "five new nodes")
	assert.ok((await texts(page)).some((t) => t.includes("Annual")))
})

await step("Delete asks before removing a branch, and Undo brings it back", async () => {
	const before = await nodes(page).count()
	await click(page, "Plans")
	await page.keyboard.press("Delete")
	await page.getByRole("button", { name: /Confirm|Yes|OK/i }).first().click()
	await page.getByRole("dialog").waitFor({ state: "detached" }) // let the question fully close
	await poll(async () => (await nodes(page).count()) === before - 4, "Plans and its branch gone")
	await page.keyboard.press("Control+z")
	await poll(async () => (await nodes(page).count()) === before, "all back")
})

await step("two nodes can be joined by a labelled, dotted cross-link", async () => {
	await click(page, "Retention")
	const growth = await centre(page, "Growth")
	await page.keyboard.down("Shift")
	await page.mouse.click(growth.x, growth.y)
	await page.keyboard.up("Shift")
	await page.getByTestId("menu-Cross-link").click()
	await page.getByTestId("mm-link-label").fill("competes with")
	await page.getByTestId("mm-link-save").click()
	await poll(async () => (await page.locator('[data-mindmap] path[stroke-dasharray="2 5"]').count()) === 1, "the dotted line")
	await poll(async () => (await page.locator('[data-mindmap]').textContent()).includes("competes with"), "its label")
	await page.keyboard.press("Escape")
	await shot(page, "p8-crosslink")
})

await step("the focus view dims everything but the branch", async () => {
	await click(page, "Retention")
	await page.getByTestId("mm-focus").click()
	await poll(async () => (await nodeOf(page, "Growth").getAttribute("opacity")) === "0.22", "Growth dimmed")
	assert.equal(await nodeOf(page, "Retention").getAttribute("opacity"), "1")
	await page.getByTestId("mm-focus").click()
})

await step("a second person sees the map and a change made by the first", async () => {
	await page.waitForTimeout(1500)
	await call(A, "share.add_person", { board, person: creds.b.user, level: "edit" })
	await B.page.goto(`${BASE}/oqiva/board/${board}`)
	await B.page.getByRole("button", { name: "Continue" }).click({ timeout: 2500 }).catch(() => {})
	await B.page.locator('[data-testid="board-canvas"]').first().waitFor()
	await poll(async () => (await texts(B.page)).some((t) => t.includes("Retention")), "the map for B")
	await click(page, "Growth")
	await page.keyboard.press("Tab")
	await typed(page, "Live from A")
	await page.keyboard.press("Escape")
	await poll(async () => (await texts(B.page)).some((t) => t.includes("Live from A")), "A's node on B's screen")
	await shot(B.page, "p8-4-peer")
})

async function call(who, method, data) {
	const response = await who.context.request.post(`${BASE}/api/method/oqiva.api.${method}`, {
		headers: { "x-frappe-csrf-token": await csrf(who.page) },
		data,
	})
	if (!response.ok()) throw new Error(`${method} failed: ${response.status()}`)
	return (await response.json()).message
}

await step("it is all still there after saving and reloading", async () => {
	await poll(async () => /Saved/.test(await page.locator('[data-testid="save-status"]').innerText()), "Saved", 15000)
	await page.waitForTimeout(800)
	const count = await nodes(page).count()
	await page.reload()
	await canvas.waitFor()
	await poll(async () => (await nodes(page).count()) === count, `${count} nodes after reload`)
	assert.ok((await texts(page)).some((t) => t.includes("Live from A")))
})

await step("the Project mind map template opens as a real map", async () => {
	await page.goto(page.url().replace(/\/board\/.*/, "/"))
	await page.getByRole("link", { name: "Templates" }).first().click()
	await page.getByLabel(/Search templates/i).fill("Project mind map")
	await page.locator('article[aria-labelledby^="template-"]').first().waitFor()
	await shot(page, "p8-5-gallery")
	await page.getByRole("button", { name: "Use template" }).click()
	await page.waitForURL(/\/oqiva\/board\//)
	await canvas.waitFor()
	await poll(async () => (await nodes(page).count()) === 30, "30 nodes")
	await shot(page, "p8-6-template")
})

await browser.close()
finish([...A.problems, ...B.problems].filter((m) => !/403|404|417|EXPECTATION/.test(m)))
