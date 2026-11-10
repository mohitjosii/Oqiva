import fs from "node:fs"
import { chromium } from "playwright-core"

export const BASE = process.env.OQIVA_E2E_URL || "http://127.0.0.1"
const SITE = process.env.OQIVA_E2E_SITE || "frappe.com"
const SHOTS = process.env.OQIVA_E2E_SHOTS

export function credentials() {
	const path = process.env.OQIVA_E2E_CREDS
	if (!path) throw new Error("Set OQIVA_E2E_CREDS to a JSON file of test users.")
	return JSON.parse(fs.readFileSync(path, "utf8"))
}

// A browser context signed in as one test user, collecting anything that goes wrong.
export async function signedIn(browser, { user, password }) {
	// The header goes on the context, so the page and the context's own API requests both carry it.
	const context = await browser.newContext({
		viewport: { width: 1360, height: 860 },
		extraHTTPHeaders: { "x-frappe-site-name": SITE },
	})
	const login = await context.request.post(`${BASE}/api/method/login`, {
		data: { usr: user, pwd: password },
		headers: { "x-frappe-site-name": SITE },
	})
	if (!login.ok()) throw new Error(`Login failed for ${user}: ${login.status()}`)
	const page = await context.newPage()
	page.setDefaultTimeout(10000)
	page.setDefaultNavigationTimeout(20000)
	const problems = []
	page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`))
	page.on("console", (message) => {
		if (message.type() === "error") problems.push(`console: ${message.text()}`)
	})
	page.on("response", (response) => {
		if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url().replace(BASE, "")}`)
	})
	activePage = page
	return { context, page, problems }
}

export async function shot(page, name) {
	if (SHOTS) {
		fs.mkdirSync(SHOTS, { recursive: true })
		await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}) // the page may already be closed
	}
}

export async function launch() {
	return chromium.launch({ headless: true, args: ["--no-sandbox"] })
}

let failures = 0
let activePage = null
export async function step(name, work) {
	try {
		await work()
		console.log(`  ok   ${name}`)
	} catch (error) {
		failures++
		if (activePage) await shot(activePage, `FAIL-${name.replace(/\W+/g, "-").slice(0, 40)}`)
		console.log(`  FAIL ${name}\n       ${String(error.message).split("\n").slice(0, 12).join("\n       ")}`)
	}
}

export function finish(problems = []) {
	for (const problem of problems) console.log(`  warn ${problem}`)
	console.log(failures || problems.length ? `\n${failures} failed, ${problems.length} browser problems` : "\nAll steps passed")
	process.exit(failures || problems.length ? 1 : 0)
}

// A visitor who is not signed in at all.
export async function anonymous(browser) {
	const context = await browser.newContext({
		viewport: { width: 1360, height: 860 },
		extraHTTPHeaders: { "x-frappe-site-name": SITE },
	})
	const page = await context.newPage()
	page.setDefaultTimeout(10000)
	page.setDefaultNavigationTimeout(20000)
	const problems = []
	page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`))
	activePage = page
	return { context, page, problems }
}
