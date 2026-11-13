// Phase 12 in the browser: "Create with AI". The real server is asked first (the provider is off on a
// fresh site, so the dialog must say so honestly). After that the three endpoints are answered by the
// test, so the dialog, the waiting, the drawing as ONE undo step, the saving and the failure messages
// are checked without a provider key or a background worker. The server side is covered by the
// backend tests with a mocked provider.
import assert from "node:assert/strict"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const A = await signedIn(browser, creds.a)
const stamp = Date.now().toString(36)
const page = A.page
let board

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
const dialog = page.getByTestId("ai-dialog")
const flowSteps = page.locator("[data-flownode]")
const mapNodes = page.locator("[data-mmnode]")
const shapes = page.locator('[data-testid="objects"] > g')
const lines = page.locator('[data-testid="connectors"] > g')
const saved = () => page.locator('[data-testid="save-status"]').innerText().then((t) => /Saved/.test(t))

const FLOW = {
	state: "done",
	kind: "flowchart",
	diagram: {
		title: "Support ticket",
		nodes: [
			{ id: "s", label: "Ticket received", shape: "terminator", lane: null },
			{ id: "t", label: "Triage the ticket", shape: "process", lane: null },
			{ id: "d", label: "Can we fix it now?", shape: "decision", lane: null },
			{ id: "f", label: "Fix and reply", shape: "process", lane: null },
			{ id: "e", label: "Close ticket", shape: "terminator", lane: null },
		],
		edges: [
			{ from: "s", to: "t", label: null, style: "solid" },
			{ from: "t", to: "d", label: null, style: "solid" },
			{ from: "d", to: "f", label: "Yes", style: "solid" },
			{ from: "d", to: "t", label: "No", style: "dashed" },
			{ from: "f", to: "e", label: null, style: "solid" },
		],
	},
}
const ARCH = {
	state: "done",
	kind: "architecture",
	diagram: {
		title: "Web shop",
		nodes: [
			{ id: "u", label: "Shopper", shape: "user", lane: "Clients" },
			{ id: "w", label: "Web app", shape: "service", lane: "Clients" },
			{ id: "a", label: "API server", shape: "server", lane: "Services" },
			{ id: "q", label: "Order queue", shape: "queue", lane: "Services" },
			{ id: "d", label: "Orders database", shape: "database", lane: "Data" },
		],
		edges: [
			{ from: "u", to: "w", label: null, style: "solid" },
			{ from: "w", to: "a", label: "HTTPS", style: "solid" },
			{ from: "a", to: "q", label: null, style: "dashed" },
			{ from: "a", to: "d", label: null, style: "solid" },
		],
	},
}
const MAP = {
	state: "done",
	kind: "mindmap",
	diagram: {
		title: "Launch",
		nodes: [
			{ id: "r", label: "Product launch", shape: "process", lane: null },
			{ id: "m", label: "Marketing", shape: "process", lane: null },
			{ id: "e", label: "Engineering", shape: "process", lane: null },
			{ id: "x", label: "Email campaign", shape: "process", lane: null },
		],
		edges: [
			{ from: "r", to: "m", label: null, style: "solid" },
			{ from: "r", to: "e", label: null, style: "solid" },
			{ from: "m", to: "x", label: null, style: "solid" },
		],
	},
}

// What the test's stand-in for the server answers. ``outcome`` is what `ai.result` returns.
const fake = { on: false, outcome: null, refuse: null, asked: [] }
async function standIn() {
	await page.route("**/api/method/oqiva.api.ai.*", async (route) => {
		const method = route.request().url().split("oqiva.api.ai.")[1].split("?")[0]
		const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
		if (!fake.on) return route.continue() // the real server
		if (method === "status") return json(200, { message: { available: true, provider: "anthropic" } })
		if (method === "generate_diagram") {
			fake.asked.push(route.request().postDataJSON())
			if (fake.refuse) return json(fake.refuse.status, fake.refuse.body)
			return json(200, { message: { request_id: "r".repeat(32) } })
		}
		if (method === "result") return json(200, { message: fake.outcome ?? { state: "pending" } })
		return route.continue()
	})
}
await standIn()

async function ask(kind, text) {
	await page.getByTestId("ai-tool").click()
	await dialog.waitFor()
	await page.getByTestId("ai-prompt").waitFor()
	await page.locator("label").filter({ has: page.getByTestId(`ai-kind-${kind}`) }).click()
	assert.equal(await page.getByTestId(`ai-kind-${kind}`).isChecked(), true)
	await page.getByTestId("ai-prompt").fill(text)
	await page.getByTestId("ai-generate").click()
}

await step("a new board opens with a Create with AI button", async () => {
	await page.goto(`${BASE}/oqiva/welcome`)
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	await page.getByRole("dialog").getByLabel("Workspace name").fill(`AI ${stamp}`)
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	board = page.url().split("/board/")[1]
	await canvas.waitFor()
	await page.getByTestId("ai-tool").waitFor()
	assert.equal(await page.getByTestId("ai-tool").getAttribute("title"), "Create with AI")
})

await step("with the provider off, the real server's answer is shown as an honest not-enabled state", async () => {
	await page.getByTestId("ai-tool").click()
	await page.getByTestId("ai-off").waitFor()
	assert.match(await page.getByTestId("ai-off").innerText(), /not turned on/i)
	assert.equal(await page.getByTestId("ai-prompt").count(), 0, "no form is offered")
	await shot(page, "ai-off")
	await page.keyboard.press("Escape")
	await page.getByTestId("ai-off").waitFor({ state: "detached" })
})

await step("when enabled, the dialog offers three kinds and a description of 3 to 2000 characters", async () => {
	fake.on = true
	await page.getByTestId("ai-tool").click()
	await page.getByTestId("ai-prompt").waitFor()
	const create = page.getByTestId("ai-generate")
	assert.equal(await create.isDisabled(), true)
	await page.getByTestId("ai-prompt").fill("ab")
	assert.equal(await create.isDisabled(), true)
	await page.getByTestId("ai-prompt").fill("abc")
	assert.equal(await create.isDisabled(), false)
	assert.equal(await page.locator('input[name="ai-kind"]').count(), 3)
	// an example fills the box
	await page.getByRole("button", { name: /support ticket is handled/i }).click()
	assert.match(await page.getByTestId("ai-prompt").inputValue(), /support ticket/)
	assert.match(await dialog.innerText(), /Only the description you type here is sent/)
	await shot(page, "ai-form")
	await page.keyboard.press("Escape")
	await dialog.waitFor({ state: "detached" })
})

await step("a flowchart is waited for, drawn as one step, and one Undo takes it away", async () => {
	fake.outcome = null
	await ask("flowchart", "How a support ticket is handled")
	await page.getByTestId("ai-working").waitFor()
	assert.deepEqual(fake.asked.at(-1), { prompt: "How a support ticket is handled", kind: "flowchart", board })
	await page.waitForTimeout(300)
	assert.equal(await flowSteps.count(), 0, "nothing is drawn while it is still working")
	fake.outcome = FLOW // the next poll finds it
	await poll(async () => (await flowSteps.count()) === 5, "five steps", 12000)
	await dialog.waitFor({ state: "detached" })
	assert.equal(await page.locator("path[data-flowedge]").count(), 5)
	assert.match((await flowSteps.allTextContents()).join("|"), /Can we fix it now\?/)
	await page.getByText(/Diagram added/).first().waitFor()
	await page.keyboard.press("Shift+Digit1")
	await shot(page, "ai-flowchart")
	await canvas.click({ position: { x: 5, y: 5 } })
	await page.keyboard.press("Control+z")
	await poll(async () => (await flowSteps.count()) === 0, "all steps gone after one undo")
	await page.keyboard.press("Control+Shift+z")
	await poll(async () => (await flowSteps.count()) === 5, "all steps back after redo")
})

await step("an architecture diagram arrives as framed lanes, shapes and joined arrows", async () => {
	fake.outcome = null
	await ask("architecture", "A small web shop")
	await page.getByTestId("ai-working").waitFor()
	fake.outcome = ARCH
	await poll(async () => (await shapes.count()) === 3 + 5, "three lanes and five shapes", 12000)
	assert.equal(await lines.count(), 4)
	// it went beside the flowchart, not on top of it
	const union = async (locator) => {
		const boxes = (await locator.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))).filter((b) => b.width)
		return {
			x1: Math.min(...boxes.map((b) => b.x)),
			x2: Math.max(...boxes.map((b) => b.right)),
			y1: Math.min(...boxes.map((b) => b.y)),
			y2: Math.max(...boxes.map((b) => b.bottom)),
		}
	}
	await page.keyboard.press("Shift+Digit1")
	await page.waitForTimeout(300)
	const flowBox = await union(flowSteps)
	const archBox = await union(shapes)
	assert.ok(archBox.x1 >= flowBox.x2 || flowBox.x1 >= archBox.x2 || archBox.y1 >= flowBox.y2 || flowBox.y1 >= archBox.y2, `the two diagrams overlap: ${JSON.stringify({ flowBox, archBox })}`)
	const text = await page.locator('[data-testid="objects"]').first().textContent()
	for (const label of ["Clients", "Services", "Data", "Orders database", "Order queue"])
		assert.ok(text.includes(label), `${label} is drawn`)
	await page.keyboard.press("Shift+Digit1")
	await shot(page, "ai-architecture")
	await page.keyboard.press("Control+z")
	await poll(async () => (await shapes.count()) === 0, "the diagram gone after one undo")
	await page.keyboard.press("Control+Shift+z")
	await poll(async () => (await shapes.count()) === 8, "the diagram back")
})

await step("a mind map grows from the first node", async () => {
	fake.outcome = null
	await ask("mindmap", "Plan a product launch")
	await page.getByTestId("ai-working").waitFor()
	fake.outcome = MAP
	await poll(async () => (await mapNodes.count()) === 4, "four nodes", 12000)
	assert.match((await mapNodes.allTextContents()).join("|"), /Email campaign/)
	await page.keyboard.press("Shift+Digit1")
	await shot(page, "ai-mindmap")
})

await step("everything is saved and is still there after a reload", async () => {
	await poll(saved, "Saved", 15000)
	await page.reload()
	await canvas.waitFor()
	await page.keyboard.press("Shift+Digit1")
	await poll(async () => (await flowSteps.count()) === 5 && (await mapNodes.count()) === 4 && (await shapes.count()) === 8, "all three diagrams after the reload", 15000)
})

await step("a diagram bigger than the screen is zoomed out so all of it can be seen", async () => {
	const nodes = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, label: `Step ${i}`, shape: "process", lane: `Lane ${i % 3}` }))
	const edges = nodes.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id, label: null, style: "solid" }))
	const before = await shapes.count()
	fake.outcome = null
	await ask("architecture", "A very long chain")
	await page.getByTestId("ai-working").waitFor()
	fake.outcome = { state: "done", kind: "architecture", diagram: { title: "Long", nodes, edges } }
	await poll(async () => (await shapes.count()) === before + 60 + 3, "all 63 shapes drawn without pressing fit", 12000)
	const zoom = parseInt(await page.getByTestId("zoom-level").innerText())
	assert.ok(zoom < 60, `zoomed out to fit (was ${zoom}%)`)
	await page.keyboard.press("Control+z")
	await poll(async () => (await shapes.count()) === before, "the long diagram gone after one undo")
})

await step("a description the model got wrong says so and can be retried", async () => {
	fake.outcome = null
	await ask("flowchart", "Something odd")
	await page.getByTestId("ai-working").waitFor()
	fake.outcome = {
		state: "error",
		code: "AI_INVALID",
		message: "The generated diagram was not valid. Try describing it a little differently.",
	}
	await page.getByTestId("ai-error").waitFor({ timeout: 12000 })
	assert.match(await page.getByTestId("ai-error").innerText(), /not valid/)
	assert.equal(await page.getByTestId("ai-prompt").inputValue(), "Something odd", "the description is kept")
	assert.match(await page.getByTestId("ai-generate").innerText(), /Try again/)
	assert.equal(await flowSteps.count(), 5, "nothing was added")
	await shot(page, "ai-invalid")
})

await step("too many requests and a slow provider are explained, not hidden", async () => {
	fake.refuse = { status: 429, body: { exc_type: "RateLimitExceededError", _server_messages: "[]" } }
	await page.getByTestId("ai-generate").click()
	await poll(async () => /Wait a minute/.test(await page.getByTestId("ai-error").innerText()), "the rate-limit message")
	fake.refuse = null
	fake.outcome = { state: "error", code: "AI_TIMEOUT", message: "Diagram generation took too long. Please try again." }
	await page.getByTestId("ai-generate").click()
	await poll(async () => /too long/.test(await page.getByTestId("ai-error").innerText()), "the timeout message", 12000)
})

await step("a request in progress can be cancelled and nothing is drawn", async () => {
	fake.outcome = null
	await page.getByTestId("ai-generate").click()
	await page.getByTestId("ai-working").waitFor()
	await page.getByRole("button", { name: "Cancel" }).click()
	await page.getByTestId("ai-generate").waitFor()
	assert.equal(await page.getByTestId("ai-working").count(), 0)
	fake.outcome = FLOW
	await page.waitForTimeout(3200) // a late answer for a cancelled request is ignored
	assert.equal(await flowSteps.count(), 5)
	await page.keyboard.press("Escape")
})

await step("a person who can only view has no way to ask", async () => {
	const readonly = await page.evaluate(() => document.querySelector('[data-testid="ai-tool"]')?.disabled)
	assert.equal(readonly, false, "an editor can ask")
})

await step("on a phone the dialog fits the screen", async () => {
	await page.setViewportSize({ width: 390, height: 780 })
	await page.waitForTimeout(300)
	await page.getByTestId("ai-tool").click({ force: true })
	await page.getByTestId("ai-prompt").waitFor()
	const box = await dialog.boundingBox()
	assert.ok(box.x >= 0 && box.x + box.width <= 390 + 1, `inside the width (${JSON.stringify(box)})`)
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 391), true, "no sideways scroll")
	await shot(page, "ai-phone")
})

await browser.close()
finish([...A.problems.filter((p) => !/(HTTP|status of) (429|503)/.test(p))])
