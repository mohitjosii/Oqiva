import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const page_url = "file://" + path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html")
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } })
await page.goto(page_url)

const fmt = (m) => `${m.avg.toFixed(1)} ms avg, ${m.p95.toFixed(1)} p95, ${m.max.toFixed(0)} max`
console.log("objects  mode      build   pan                         zoom                        drag one object")
for (const n of [300, 1000, 3000, 10000]) {
	for (const culling of [false, true]) {
		const build = await page.evaluate(([n, c]) => setup(n, c), [n, culling])
		const pan = await page.evaluate(() => pan(90))
		await page.evaluate(([n, c]) => setup(n, c), [n, culling])
		const zoom = await page.evaluate(() => zoom(90))
		await page.evaluate(([n, c]) => setup(n, c), [n, culling])
		const drag = await page.evaluate(() => drag(90))
		const mounted = await page.evaluate(() => mountedCount())
		console.log(
			`${String(n).padStart(6)}   ${culling ? "culled  " : "all     "} ${build.toFixed(0).padStart(5)} ms  ${fmt(pan).padEnd(27)} ${fmt(zoom).padEnd(27)} ${fmt(drag)}  [${mounted} mounted]`,
		)
	}
}
await browser.close()
