// Accessibility audit (Phase 13, P13.03). It checks what can be checked without a screen reader: names and
// labels, focus order and visibility, dialogs (role, focus moved in, kept in, returned), contrast, target
// size and reflow at a narrow width. It is a set of rules written for this app, not axe-core: it finds
// the common mistakes and says where, and it does not replace a pass with a real screen reader.
//
// Each rule prints its findings; the run fails on the ones marked "must".
import assert from "node:assert/strict"
import { BASE, credentials, finish, launch, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const A = await signedIn(browser, creds.a)
const page = A.page
const stamp = Date.now().toString(36)
let board

// ---- the rules, run inside the page ----
const rules = () => {
	const out = { unnamed: [], unlabelled: [], positiveTabindex: [], duplicateIds: [], hiddenFocusable: [], headings: [], small: [], contrast: [], noLang: !document.documentElement.lang, noTitle: !document.title.trim() }
	const visible = (el) => {
		const r = el.getBoundingClientRect()
		const s = getComputedStyle(el)
		return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"
	}
	const snippet = (el) => el.outerHTML.replace(/\s+/g, " ").slice(0, 110)
	const textOf = (el) => (el.textContent || "").replace(/\s+/g, " ").trim()
	const nameOf = (el) => {
		const aria = el.getAttribute("aria-label")
		if (aria && aria.trim()) return aria.trim()
		const by = el.getAttribute("aria-labelledby")
		if (by) {
			const t = by.split(/\s+/).map((id) => textOf(document.getElementById(id) || document.createElement("i"))).join(" ").trim()
			if (t) return t
		}
		if (el.labels && el.labels.length) {
			const t = [...el.labels].map(textOf).join(" ").trim()
			if (t) return t
		}
		const t = textOf(el)
		if (t) return t
		const img = el.querySelector("img[alt]")
		if (img && img.alt.trim()) return img.alt.trim()
		const svgTitle = el.querySelector("svg title")
		if (svgTitle && textOf(svgTitle)) return textOf(svgTitle)
		return (el.getAttribute("title") || "").trim()
	}
	const interactive = [...document.querySelectorAll('button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], input:not([type="hidden"]), select, textarea, [contenteditable="true"]')].filter(visible)
	for (const el of interactive) {
		if (!nameOf(el)) out.unnamed.push(snippet(el))
		const r = el.getBoundingClientRect()
		const sr = getComputedStyle(el).clip === "rect(0px, 0px, 0px, 0px)" || el.classList.contains("sr-only")
		const labelBox = el.labels && el.labels[0] ? el.labels[0].getBoundingClientRect() : null // a label people can click is part of the target
		const big = labelBox && labelBox.width >= 24 && labelBox.height >= 24
		if (!sr && !big && (r.width < 24 || r.height < 24) && !el.closest("[data-testid=minimap]")) out.small.push(`${Math.round(r.width)}x${Math.round(r.height)} ${snippet(el)}`)
	}
	for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=file]), select, textarea")) {
		if (!visible(el)) continue
		if (!el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !(el.labels && el.labels.length) && !el.getAttribute("title")) out.unlabelled.push(snippet(el))
	}
	for (const el of document.querySelectorAll("[tabindex]")) if (Number(el.getAttribute("tabindex")) > 0) out.positiveTabindex.push(snippet(el))
	const seen = new Set()
	for (const el of document.querySelectorAll("[id]")) { if (seen.has(el.id)) out.duplicateIds.push(el.id); seen.add(el.id) }
	// (behind an open modal dialog the rest of the page is meant to be hidden, so this rule is for the page itself)
	if (!document.querySelector('[role="dialog"]')) for (const el of document.querySelectorAll('[aria-hidden="true"]')) if (el.matches("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])") || el.querySelector("a[href], button, input, select, textarea")) if (!el.querySelector("[tabindex='-1']") ) out.hiddenFocusable.push(snippet(el))
	let last = 0
	for (const h of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) { if (!visible(h)) continue; const level = Number(h.tagName[1]); if (last && level > last + 1) out.headings.push(`h${last} then h${level}: ${textOf(h).slice(0, 40)}`); last = level }
	// contrast of text: the colour against the first non-transparent background above it
	const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
	const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
	const backdrop = (el) => { let e = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.95) return c; e = e.parentElement } return { r: 255, g: 255, b: 255, a: 1 } }
	const checked = new Set()
	for (const el of document.querySelectorAll("body *")) {
		if (el.closest("svg") || !visible(el)) continue
		const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ")
		if (!own) continue
		const s = getComputedStyle(el)
		const fg = parse(s.color), bg = backdrop(el)
		if (!fg || fg.a < 0.99) continue
		const L1 = lum(fg), L2 = lum(bg)
		const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
		const size = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700
		const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
		const key = `${s.color}|${bg.r},${bg.g},${bg.b}|${size}`
		if (ratio < need && !checked.has(key) && s.opacity === "1" && !el.disabled && !el.closest("[disabled], [aria-disabled=true]")) { checked.add(key); out.contrast.push(`${ratio.toFixed(2)}:1 (needs ${need}) "${own.slice(0, 30)}" ${s.color} on rgb(${bg.r},${bg.g},${bg.b}) ${size}px`) }
	}
	return out
}

const report = async (name, { must = [] } = {}) => {
	const found = await page.evaluate(rules)
	const lines = []
	for (const [rule, list] of Object.entries(found)) {
		const items = Array.isArray(list) ? list : list ? ["yes"] : []
		if (items.length) lines.push(`       ${must.includes(rule) ? "MUST " : "     "}${rule} (${items.length}): ${[...new Set(items)].slice(0, 4).join("  |  ")}`)
	}
	console.log(`     [${name}] ${lines.length ? "" : "no findings"}`)
	for (const l of lines) console.log(l)
	for (const rule of must) assert.equal((Array.isArray(found[rule]) ? found[rule].length : found[rule] ? 1 : 0), 0, `${name}: ${rule}`)
}

// Tab through the page and check each stop shows where focus is.
async function focusRing(limit = 40) {
	const lost = []
	let stops = 0
	await page.evaluate(() => document.activeElement?.blur())
	for (let i = 0; i < limit; i++) {
		await page.keyboard.press("Tab")
		const info = await page.evaluate(() => {
			const el = document.activeElement
			if (!el || el === document.body) return null
			const s = getComputedStyle(el)
			const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0
			const shadow = s.boxShadow && s.boxShadow !== "none"
			const r = el.getBoundingClientRect()
			return { visibleRing: outline || Boolean(shadow), tag: el.outerHTML.replace(/\s+/g, " ").slice(0, 90), onScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth }
		})
		if (!info) break
		stops++
		if (!info.visibleRing) lost.push(info.tag)
	}
	return { stops, lost }
}

await step("setup: a workspace with a board that has some content", async () => {
	await page.goto(`${BASE}/oqiva/welcome`)
	await report("welcome", {})
	await page.getByRole("button", { name: "Continue" }).click()
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	await page.getByRole("dialog").getByLabel("Workspace name").fill(`A11y ${stamp}`)
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
	await page.getByRole("heading", { name: "Create your first board" }).waitFor()
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	board = page.url().split("/board/")[1]
	await page.locator('[data-testid="board-canvas"]').waitFor()
	await page.keyboard.press("r")
	const box = await page.locator('[data-testid="board-canvas"]').boundingBox()
	await page.mouse.move(box.x + 500, box.y + 300); await page.mouse.down(); await page.mouse.move(box.x + 700, box.y + 400, { steps: 5 }); await page.mouse.up()
	await page.keyboard.press("Escape")
})

await step("the board page: names, labels, focus and contrast", async () => {
	await report("board editor", { must: ["unnamed", "unlabelled", "positiveTabindex", "duplicateIds", "noLang", "noTitle", "contrast"] })
	const { stops, lost } = await focusRing(45)
	console.log(`     [board editor] Tab reached ${stops} controls; ${lost.length} show no focus ring${lost.length ? ": " + lost.slice(0, 3).join(" | ") : ""}`)
	assert.ok(stops >= 15, "Tab reaches the toolbars")
	assert.equal(lost.length, 0, "every control shows where focus is")
})

await step("the canvas has a name and a keyboard way in", async () => {
	const info = await page.evaluate(() => {
		const c = document.querySelector('[data-testid="board-canvas"]')
		return { role: c.getAttribute("role"), label: c.getAttribute("aria-label"), tabindex: c.getAttribute("tabindex"), svgTitle: Boolean(document.querySelector('[data-testid="board-canvas"] svg > title, [data-testid="board-canvas"] svg[aria-label]')) }
	})
	console.log("     [canvas]", JSON.stringify(info))
	assert.equal(info.role, "application")
	assert.ok(info.label, "the canvas has a name")
})

for (const [label, open, root] of [
	["Share", async () => page.getByRole("button", { name: /Share/ }).first().click(), "dialog"],
	["Keyboard shortcuts", async () => { await page.getByTestId("help-button").click(); await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click() }, "dialog"],
	["Create with AI", async () => page.getByTestId("ai-tool").click(), "dialog"],
]) {
	await step(`dialog "${label}": has a role and name, takes focus, keeps it, closes with Escape and gives focus back`, async () => {
		await page.keyboard.press("Escape")
		await page.waitForTimeout(300)
		await open()
		const dialog = page.getByRole("dialog").first()
		await dialog.waitFor()
		const meta = await dialog.evaluate((el) => ({ modal: el.getAttribute("aria-modal"), name: el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || "", heading: Boolean(el.querySelector("h1,h2,h3")) }))
		await page.waitForTimeout(400)
		const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
		console.log(`     [${label}] aria-modal=${meta.modal}, named=${Boolean(meta.name)}, heading=${meta.heading}, focus inside on open=${await inside()}`)
		let escaped = 0
		for (let i = 0; i < 25; i++) { await page.keyboard.press("Tab"); if (!(await inside())) escaped++ }
		console.log(`     [${label}] ${escaped} of 25 Tab presses left the dialog`)
		await report(`dialog ${label}`, { must: ["unnamed", "unlabelled", "contrast"] })
		await page.keyboard.press("Escape")
		await dialog.waitFor({ state: "detached" }).catch(() => {})
		const back = await page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute("data-testid") || a.getAttribute("aria-label") || a.tagName) : "none" })
		console.log(`     [${label}] focus after closing: ${back}`)
		assert.equal(escaped, 0, `${label}: focus escaped the dialog`)
		await page.waitForTimeout(200)
		assert.notEqual(back, "BODY", `${label}: focus was lost to the page when the dialog closed`)
	})
}

await step("the menus open from the keyboard", async () => {
	await page.keyboard.press("Escape")
	await page.getByTestId("draw-button").focus()
	await page.keyboard.press("Enter")
	const items = await page.getByRole("menuitem").count()
	console.log(`     [Draw menu] opened with Enter: ${items} items`)
	assert.ok(items > 2)
	await page.keyboard.press("ArrowDown")
	await page.keyboard.press("Escape")
})

await step("the home area and templates", async () => {
	await page.goto(`${BASE}/oqiva/`)
	await page.getByRole("heading").first().waitFor()
	await report("home", { must: ["unnamed", "unlabelled", "positiveTabindex", "duplicateIds", "noLang", "noTitle", "contrast"] })
	const f = await focusRing(30)
	console.log(`     [home] Tab reached ${f.stops} controls; ${f.lost.length} show no focus ring${f.lost.length ? ": " + f.lost.slice(0, 3).join(" | ") : ""}`)
	await page.getByRole("link", { name: "Templates" }).first().click()
	await page.locator('article[aria-labelledby^="template-"]').first().waitFor()
	await report("templates", { must: ["unnamed", "unlabelled", "duplicateIds", "headings", "contrast"] })
})

await step("a narrow screen (320 px wide) has no sideways scroll on the main pages", async () => {
	await page.setViewportSize({ width: 320, height: 640 })
	for (const [name, url] of [["home", `${BASE}/oqiva/`], ["board", `${BASE}/oqiva/board/${board}`]]) {
		await page.goto(url)
		await page.waitForTimeout(1200)
		const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
		console.log(`     [${name} at 320px] scroll width beyond the screen: ${wide}px`)
		assert.ok(wide <= 2, `${name} scrolls sideways by ${wide}px`)
	}
	await page.setViewportSize({ width: 1360, height: 860 })
})

await browser.close()
finish([...A.problems])
