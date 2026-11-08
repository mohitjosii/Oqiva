import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createConnector, createImage, createObject, createTable } from "../model/factories"
import { createDocument } from "../model/schema"
import { createStore } from "../store/createStore"
import { exportBoard } from "./exporter"
import { inlinePictures } from "./pictures"
import {
	collectItems,
	exportArea,
	exportBackground,
	fitScale,
	isEmpty,
	MAX_PIXELS,
	MAX_SIDE,
	PADDING,
} from "./scene"
import { buildSvg, MISSING_PICTURE } from "./svg"
import { createThumbnailer, renderThumbnail } from "./thumbnail"

const files = vi.hoisted(() => ({ downloads: [], prints: [] }))
vi.mock("./files", () => ({
	downloadBlob: (blob, name) => files.downloads.push({ blob, name }),
	printSvg: (svg, title) => files.prints.push({ svg, title }),
}))

const measure = (text, style) => text.length * style.size * 0.5
const box = (id, x, y, w = 100, h = 60, over = {}) => ({
	...createObject("rectangle", { x, y, w, h }, { theme: "ocean", z: 1 }),
	id,
	...over,
})
const line = (id, from, to) => ({ ...createConnector({ from, to, theme: "ocean", z: 1 }), id })
const board = (objects = [], connectors = [], canvas = {}) => {
	const store = createStore({
		...createDocument(),
		canvas: { ...createDocument().canvas, ...canvas },
		objects: objects.map((o, i) => ({ ...o, z: i + 1 })),
		connectors,
	})
	store.state.size = { width: 1000, height: 700 }
	return store
}
const parse = (svg) => new DOMParser().parseFromString(svg, "image/svg+xml")
// jsdom's Blob has no text(), so read it the long way.
const readText = (blob) =>
	new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result)
		reader.onerror = () => reject(reader.error)
		reader.readAsText(blob)
	})

describe("which background each format gets", () => {
	it("leaves PNG and SVG see-through, and gives white to the formats that cannot be", () => {
		const none = { background: null }
		expect(exportBackground(none, "png")).toBeNull()
		expect(exportBackground(none, "svg")).toBeNull()
		for (const format of ["jpeg", "pdf", "print", "thumbnail"])
			expect(exportBackground(none, format)).toBe("#FFFFFF")
	})

	it("uses the board's own background in every format", () => {
		const warm = { background: "#FFF8E7" }
		for (const format of ["png", "svg", "jpeg", "pdf", "print", "thumbnail"])
			expect(exportBackground(warm, format)).toBe("#FFF8E7")
	})
})

describe("what an export holds", () => {
	const a = box("a", 0, 0)
	const b = box("b", 300, 0)
	const c = box("c", 600, 0)
	const ab = line("ab", { objectId: "a", anchor: "e" }, { objectId: "b", anchor: "w" })
	const bc = line("bc", { objectId: "b", anchor: "e" }, { objectId: "c", anchor: "w" })

	it("takes everything for the board", () => {
		const items = collectItems(board([a, b, c], [ab, bc]))
		expect(items.objects).toHaveLength(3)
		expect(items.connectors).toHaveLength(2)
	})

	it("takes the selection, with a line only when both its shapes are selected", () => {
		const store = board([a, b, c], [ab, bc])
		store.select(["a", "b"])
		const items = collectItems(store, "selection")
		expect(items.objects.map((o) => o.id)).toEqual(["a", "b"])
		expect(items.connectors.map((l) => l.id)).toEqual(["ab"])
	})

	it("takes a selected line even when its shapes are not selected", () => {
		const store = board([a, b], [ab])
		store.select(["ab"])
		const items = collectItems(store, "selection")
		expect(items.objects).toHaveLength(0)
		expect(items.connectors).toHaveLength(1)
		expect(isEmpty(collectItems(board(), "board"))).toBe(true)
	})

	it("frames the content with a margin on an unbounded board", () => {
		const store = board([a, b])
		const area = exportArea(store, collectItems(store))
		expect(area).toEqual({
			x: -PADDING,
			y: -PADDING,
			w: 400 + PADDING * 2,
			h: 60 + PADDING * 2,
		})
	})

	it("frames only the selection for a selection export", () => {
		const store = board([a, b, c])
		store.select(["c"])
		const area = exportArea(store, collectItems(store, "selection"), "selection")
		expect([area.x, area.w]).toEqual([600 - PADDING, 100 + PADDING * 2])
	})

	it("frames the page of a preset board, and only the content for a selection on it", () => {
		const store = board([a], [], { mode: "preset", preset: "16:9" })
		expect(exportArea(store, collectItems(store))).toEqual({ x: 0, y: 0, w: 1280, h: 720 })
		store.select(["a"])
		expect(exportArea(store, collectItems(store, "selection"), "selection").w).toBe(
			100 + PADDING * 2,
		)
	})

	it("counts a free line, which may lie outside every shape", () => {
		const free = line("f", { x: -500, y: 400 }, { x: -400, y: 500 })
		const store = board([a], [free])
		const area = exportArea(store, collectItems(store))
		expect(area.x).toBe(-500 - PADDING)
		expect(area.y + area.h).toBe(500 + PADDING)
	})

	it("never makes a picture smaller than a minimum", () => {
		const store = board([box("tiny", 0, 0, 5, 5)])
		expect(exportArea(store, collectItems(store)).w).toBeGreaterThanOrEqual(40)
		expect(exportArea(board(), collectItems(board()))).toBeNull()
	})
})

describe("how big a picture can be", () => {
	it("keeps the scale asked for when it fits", () => {
		expect(fitScale(800, 600, 2)).toEqual({ scale: 2, reduced: false })
	})

	it("reduces a side that is too long", () => {
		const { scale, reduced } = fitScale(MAX_SIDE * 2, 100, 1)
		expect(reduced).toBe(true)
		expect(MAX_SIDE * 2 * scale).toBeCloseTo(MAX_SIDE)
	})

	it("reduces a picture with too many pixels", () => {
		const { scale, reduced } = fitScale(7000, 7000, 1)
		expect(reduced).toBe(true)
		expect(7000 * 7000 * scale * scale).toBeLessThanOrEqual(MAX_PIXELS + 1)
	})
})

describe("the SVG", () => {
	const draw = (store, options = {}, scope = "board") => {
		const items = collectItems(store, scope)
		return buildSvg(items, exportArea(store, items, scope), { measure, ...options })
	}

	it("is well-formed, sized to the area, with the shapes and a line in it", () => {
		const store = board(
			[box("a", 0, 0), box("b", 300, 0)],
			[line("ab", { objectId: "a", anchor: "e" }, { objectId: "b", anchor: "w" })],
		)
		const svg = draw(store)
		const doc = parse(svg)
		expect(doc.querySelector("parsererror")).toBeNull()
		const root = doc.documentElement
		expect(root.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg")
		expect(root.getAttribute("viewBox")).toBe("-24 -24 448 108")
		expect([root.getAttribute("width"), root.getAttribute("height")]).toEqual(["448", "108"])
		expect(doc.querySelectorAll("g[clip-path] > g").length).toBe(3) // two shapes and one line
	})

	it("has a background rectangle only when there is a background", () => {
		const store = board([box("a", 0, 0)])
		expect(parse(draw(store)).querySelector("svg > rect")).toBeNull()
		const rect = parse(draw(store, { background: "#FFFFFF" })).querySelector("svg > rect")
		expect(rect.getAttribute("fill")).toBe("#FFFFFF")
		expect(rect.getAttribute("width")).toBe("148")
	})

	it("clips everything to the area, so a page export shows only the page", () => {
		const doc = parse(
			draw(board([box("a", 5000, 5000)], [], { mode: "preset", preset: "16:9" })),
		)
		expect(doc.querySelector("clipPath rect").getAttribute("width")).toBe("1280")
	})

	it("carries text, escaped, and nothing that could run", () => {
		const text = {
			align: "center",
			size: 16,
			color: "#111111",
			paragraphs: [{ runs: [{ t: 'a <b> & "c"' }] }],
		}
		const svg = draw(board([box("a", 0, 0, 300, 80, { text })]))
		expect(svg).toContain(
			'a &lt;b&gt; &amp; "c"'.replace(/"/g, "&quot;").replace(/&quot;c&quot;/, '"c"'),
		)
		const doc = parse(svg)
		expect(doc.querySelector("parsererror")).toBeNull()
		expect(doc.querySelector("script")).toBeNull()
		expect(doc.querySelectorAll("*[onload], *[onclick]")).toHaveLength(0)
	})

	it("embeds a picture's data, or the placeholder when it is missing", () => {
		const picture = {
			...createImage({
				src: "/private/files/a.png",
				size: { w: 100, h: 50 },
				center: { x: 50, y: 25 },
				z: 1,
			}),
			id: "p",
		}
		const store = board([picture])
		const embedded = draw(store, {
			images: new Map([["/private/files/a.png", "data:image/png;base64,AAAA"]]),
		})
		expect(parse(embedded).querySelector("image").getAttribute("href")).toBe(
			"data:image/png;base64,AAAA",
		)
		expect(embedded).not.toContain("/private/files")
		const missing = draw(store, { images: new Map() })
		expect(parse(missing).querySelector("image").getAttribute("href")).toBe(MISSING_PICTURE)
		expect(
			parse(draw(store, { images: null }))
				.querySelector("image")
				.getAttribute("href"),
		).toBe(MISSING_PICTURE)
	})

	it("draws a table's cells and lines", () => {
		const table = {
			...createTable({ rows: 2, cols: 2, center: { x: 100, y: 50 }, theme: "ocean", z: 1 }),
			id: "t",
		}
		table.table.fills[0][0] = "#FEE2E2"
		const doc = parse(draw(board([table])))
		expect(doc.querySelector('rect[fill="#FEE2E2"]')).not.toBeNull()
		expect(doc.querySelector("path[d^='M0 0 L0']")).not.toBeNull()
	})

	it("draws a selection export from only the selected things", () => {
		const store = board([box("a", 0, 0), box("b", 300, 0)])
		store.select(["b"])
		const doc = parse(draw(store, {}, "selection"))
		expect(doc.querySelectorAll("g[clip-path] > g")).toHaveLength(1)
		expect(doc.documentElement.getAttribute("viewBox")).toBe("276 -24 148 108")
	})

	it("places a line whose shape is not part of the export", () => {
		const store = board(
			[box("a", 0, 0), box("b", 300, 0)],
			[line("ab", { objectId: "a", anchor: "e" }, { objectId: "b", anchor: "w" })],
		)
		store.select(["ab"])
		const doc = parse(draw(store, {}, "selection"))
		expect(doc.querySelectorAll("g[clip-path] > g")).toHaveLength(1)
	})
})

describe("fetching pictures", () => {
	const picture = (src) => ({
		...createImage({ src, size: { w: 10, h: 10 }, center: { x: 0, y: 0 }, z: 1 }),
		id: src,
	})
	const reply = (status, type, body = "x") => ({
		ok: status < 400,
		status,
		blob: async () => new Blob([body], { type }),
	})

	it("turns each picture into data, once, and lists the ones it could not get", async () => {
		const seen = []
		const fetcher = async (url) => {
			seen.push(url)
			if (url.includes("gone")) return reply(404, "text/html")
			if (url.includes("page")) return reply(200, "text/html")
			if (url.includes("boom")) throw new Error("network")
			return reply(200, "image/png")
		}
		const objects = [
			picture("/private/files/ok.png"),
			picture("/private/files/ok.png"),
			picture("/private/files/gone.png"),
			picture("/private/files/page.png"),
			picture("/private/files/boom.png"),
			box("a", 0, 0),
		]
		const { images, missing } = await inlinePictures(objects, fetcher)
		expect([...images.keys()]).toEqual(["/private/files/ok.png"])
		expect(images.get("/private/files/ok.png")).toMatch(/^data:image\/png;base64,/)
		expect(missing.sort()).toEqual([
			"/private/files/boom.png",
			"/private/files/gone.png",
			"/private/files/page.png",
		])
		expect(seen.filter((u) => u.includes("ok.png"))).toHaveLength(1)
	})

	it("fetches nothing when there are no pictures", async () => {
		const fetcher = vi.fn()
		expect(await inlinePictures([box("a", 0, 0)], fetcher)).toEqual({
			images: new Map(),
			missing: [],
		})
		expect(fetcher).not.toHaveBeenCalled()
	})
})

describe("exporting", () => {
	let notices
	const notify = {
		error: (m) => notices.push(["error", m]),
		warning: (m) => notices.push(["warning", m]),
		success: (m) => notices.push(["success", m]),
	}
	const host = (over = {}) => ({
		exports: {
			prepare: vi.fn(async (format) => ({
				filename: format === "print" ? "Plan" : `Plan.${format}`,
			})),
		},
		...over,
	})

	beforeEach(() => {
		notices = []
		files.downloads.length = 0
		files.prints.length = 0
		vi.stubGlobal("fetch", async () => ({
			ok: false,
			status: 404,
			blob: async () => new Blob(),
		}))
	})
	afterEach(() => vi.unstubAllGlobals())

	it("says so, without asking the server, when there is nothing to export", async () => {
		const h = host()
		expect(
			await exportBoard({ store: board(), host: h, format: "svg", notify, measure }),
		).toBeNull()
		expect(notices[0][1]).toMatch(/nothing on the board/)
		const store = board([box("a", 0, 0)])
		expect(
			await exportBoard({
				store,
				host: h,
				format: "svg",
				scope: "selection",
				notify,
				measure,
			}),
		).toBeNull()
		expect(notices[1][1]).toMatch(/Select something/)
		expect(h.exports.prepare).not.toHaveBeenCalled()
	})

	it("downloads an SVG under the name the server chose, after the server has recorded it", async () => {
		const h = host()
		const result = await exportBoard({
			store: board([box("a", 0, 0)]),
			host: h,
			format: "svg",
			notify,
			measure,
		})
		expect(h.exports.prepare).toHaveBeenCalledWith("svg", "board")
		expect(result.filename).toBe("Plan.svg")
		expect(files.downloads).toHaveLength(1)
		expect(files.downloads[0].name).toBe("Plan.svg")
		expect(files.downloads[0].blob.type).toBe("image/svg+xml")
		expect(
			parse(await readText(files.downloads[0].blob)).querySelector("parsererror"),
		).toBeNull()
		expect(notices).toEqual([])
	})

	it("keeps a see-through board see-through in SVG, and white for print", async () => {
		const store = board([box("a", 0, 0)])
		await exportBoard({ store, host: host(), format: "svg", notify, measure })
		expect(
			parse(await readText(files.downloads[0].blob)).querySelector("svg > rect"),
		).toBeNull()
		await exportBoard({ store, host: host(), format: "print", notify, measure })
		expect(files.prints).toHaveLength(1)
		expect(files.prints[0].title).toBe("Plan")
		expect(parse(files.prints[0].svg).querySelector("svg > rect").getAttribute("fill")).toBe(
			"#FFFFFF",
		)
	})

	it("stops and says why when the server refuses", async () => {
		const refusal = Object.assign(new Error("You hit the rate limit."), { name: "ApiError" })
		const h = host({ exports: { prepare: vi.fn(async () => Promise.reject(refusal)) } })
		expect(
			await exportBoard({
				store: board([box("a", 0, 0)]),
				host: h,
				format: "svg",
				notify,
				measure,
			}),
		).toBeNull()
		expect(notices).toEqual([["error", "You hit the rate limit."]])
		expect(files.downloads).toHaveLength(0)
	})

	it("warns, and still exports, when a picture cannot be loaded", async () => {
		const picture = {
			...createImage({
				src: "/private/files/gone.png",
				size: { w: 10, h: 10 },
				center: { x: 0, y: 0 },
				z: 1,
			}),
			id: "p",
		}
		const result = await exportBoard({
			store: board([picture]),
			host: host(),
			format: "svg",
			notify,
			measure,
		})
		expect(result.missing).toEqual(["/private/files/gone.png"])
		expect(notices[0][0]).toBe("warning")
		expect(files.downloads).toHaveLength(1)
	})

	it("exports a selection under the selection scope", async () => {
		const store = board([box("a", 0, 0), box("b", 300, 0)])
		store.select(["a"])
		const h = host()
		await exportBoard({ store, host: h, format: "svg", scope: "selection", notify, measure })
		expect(h.exports.prepare).toHaveBeenCalledWith("svg", "selection")
		expect((await readText(files.downloads[0].blob)).match(/<g transform/g)).toHaveLength(1)
	})
})

describe("the thumbnail", () => {
	it("is nothing for an empty board", async () => {
		expect(await renderThumbnail(board(), measure)).toBeNull()
	})
})

describe("sending thumbnails no more than every 30 seconds", () => {
	let clock
	let timers
	let saved
	const make = (over = {}) =>
		createThumbnailer({
			render: async () => "blob",
			save: async (blob) => saved.push([clock, blob]),
			now: () => clock,
			schedule: (fn, wait) => {
				const timer = { fn, at: clock + wait }
				timers.push(timer)
				return timer
			},
			cancel: (timer) => (timers = timers.filter((t) => t !== timer)),
			...over,
		})
	// Moves the clock on and runs whatever is due.
	const advance = async (ms) => {
		clock += ms
		for (const timer of timers.filter((t) => t.at <= clock)) {
			timers = timers.filter((t) => t !== timer)
			await timer.fn()
		}
	}

	beforeEach(() => {
		clock = 100_000
		timers = []
		saved = []
	})

	it("waits for edits to settle before the first one", async () => {
		const t = make()
		t.request()
		await advance(1999)
		expect(saved).toHaveLength(0)
		await advance(1)
		expect(saved).toHaveLength(1)
	})

	it("holds the next one back until 30 seconds after the last, however many edits come", async () => {
		const t = make()
		t.request()
		await advance(2000)
		for (let i = 0; i < 20; i++) t.request()
		await advance(10_000)
		expect(saved).toHaveLength(1)
		await advance(20_000) // 30s since the first attempt
		expect(saved).toHaveLength(2)
		expect(saved[1][0] - saved[0][0]).toBeGreaterThanOrEqual(30_000)
	})

	it("sends nothing when nothing changed again", async () => {
		const t = make()
		t.request()
		await advance(2000)
		await advance(60_000)
		expect(saved).toHaveLength(1)
		expect(t.pending).toBe(false)
	})

	it("carries on quietly when drawing or sending fails", async () => {
		const failing = make({ render: async () => Promise.reject(new Error("canvas")) })
		failing.request()
		await advance(2000)
		expect(saved).toHaveLength(0)
		const failingSave = make({ save: async () => Promise.reject(new Error("offline")) })
		failingSave.request()
		await advance(2000)
		failingSave.request()
		await advance(30_000)
		expect(saved).toHaveLength(0)
	})

	it("does not send an empty board's missing picture", async () => {
		const t = make({ render: async () => null })
		t.request()
		await advance(2000)
		expect(saved).toHaveLength(0)
	})

	it("stops when disposed", async () => {
		const t = make()
		t.request()
		t.dispose()
		await advance(60_000)
		expect(saved).toHaveLength(0)
		t.request()
		expect(timers).toHaveLength(0)
	})
})
