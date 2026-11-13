import { describe, expect, it } from "vitest"
import { createObject, defaultRect } from "./factories"
import { newId } from "./ids"
import {
	CANVAS_PRESETS,
	DocumentError,
	countObjects,
	createDocument,
	pageSize,
	parseDocument,
} from "./schema"
import { SHAPE_TOOLS, TEXT_TOOL, heightForText, polygonPoints, shapePath, textArea } from "./shapes"
import { THEMES, isColor, themedStyle } from "./themes"

const raw = (objects = [], over = {}) => JSON.stringify({ ...createDocument(), objects, ...over })
const shape = (over = {}) => ({
	id: "a",
	kind: "shape",
	shape: "rectangle",
	x: 1,
	y: 2,
	w: 30,
	h: 40,
	z: 1,
	...over,
})

describe("parseDocument", () => {
	it("reads a blank document and a document with shapes", () => {
		const { document, issues } = parseDocument(
			raw([shape(), shape({ id: "b", shape: "ellipse", z: 0 })]),
		)
		expect(issues).toEqual([])
		expect(document.objects.map((o) => o.id)).toEqual(["b", "a"]) // sorted by z
		expect(document.canvas).toEqual({
			mode: "infinite",
			preset: "16:9",
			background: null,
			grid: "off",
			sketch: false,
			doubleClick: "shape",
		})
		expect(parseDocument(raw()).document.objects).toEqual([])
	})

	it("refuses input that is not a document", () => {
		for (const bad of [
			"{oops",
			"[]",
			"null",
			JSON.stringify({ objects: [] }),
			JSON.stringify({ schemaVersion: "1" }),
		]) {
			expect(() => parseDocument(bad)).toThrow(DocumentError)
		}
	})

	it("refuses a newer schema with its own code, so the editor can say so", () => {
		try {
			parseDocument(JSON.stringify({ schemaVersion: 99 }))
			expect.unreachable()
		} catch (error) {
			expect(error.code).toBe("too_new")
		}
	})

	it("clamps numbers and falls back to safe values", () => {
		const { document } = parseDocument(
			raw([
				shape({
					w: -5,
					h: 1e12,
					x: "zero",
					rotation: 725,
					style: { opacity: 9, strokeWidth: -3, dash: "wavy" },
				}),
			]),
		)
		const [a] = document.objects
		expect(a.w).toBe(1)
		expect(a.h).toBe(100000)
		expect(a.x).toBe(0)
		expect(a.rotation).toBe(5)
		expect(a.style).toMatchObject({ opacity: 1, strokeWidth: 0, dash: "solid" })
	})

	it("never lets a colour through that is not plain hex", () => {
		const { document } = parseDocument(
			raw(
				[
					shape({
						style: {
							fill: "url(http://evil.example/x)",
							stroke: "javascript:alert(1)",
						},
						text: { paragraphs: [{ runs: [{ t: "hi", c: "url(#x)" }] }], color: "red" },
					}),
				],
				{ canvas: { background: "url(http://evil.example)", grid: "dense" } },
			),
		)
		const [a] = document.objects
		expect(isColor(a.style.stroke)).toBe(true)
		expect(a.style.fill).toBeNull()
		expect(a.text.paragraphs[0].runs[0].c).toBeUndefined()
		expect(isColor(a.text.color)).toBe(true)
		expect(document.canvas.background).toBeNull()
		expect(document.canvas.grid).toBe("dense")
	})

	it("drops objects it cannot use, repeated ids, and reports them", () => {
		const { document, issues } = parseDocument(
			raw([shape(), shape({ x: 99 }), { kind: "shape" }, "junk", shape({ id: "bad id!" })]),
		)
		expect(document.objects).toHaveLength(1)
		expect(document.objects[0].x).toBe(1)
		expect(issues).toHaveLength(4)
	})

	it("keeps object kinds and settings from a newer version untouched", () => {
		const future = { id: "f1", kind: "hologram", glow: 5 }
		const { document } = parseDocument(
			JSON.stringify({ ...createDocument(), objects: [future], extras: { keep: true } }),
		)
		expect(document.objects[0]).toEqual(future)
		expect(document.extras).toEqual({ keep: true })
	})

	it("caps the amount of text and limits polygon sides", () => {
		const long = "x".repeat(20000)
		const { document } = parseDocument(
			raw([
				shape({
					shape: "polygon",
					sides: 99,
					text: { paragraphs: [{ runs: [{ t: long }] }] },
				}),
			]),
		)
		const [a] = document.objects
		expect(a.sides).toBe(12)
		expect(a.text.paragraphs[0].runs[0].t).toHaveLength(10000)
	})

	it("counts everything that is drawn", () => {
		const doc = {
			objects: [1, 2],
			connectors: [1],
			mindmaps: [{ nodes: [1, 2, 3] }],
			flowcharts: [{ nodes: [1] }],
		}
		expect(countObjects(doc)).toBe(7)
	})

	it("knows the size of each preset page", () => {
		expect(pageSize({ preset: "a4-portrait" })).toEqual({ width: 794, height: 1123 })
		expect(pageSize({ preset: "nonsense" })).toEqual({ width: 1280, height: 720 })
		expect(Object.keys(CANVAS_PRESETS)).toHaveLength(7)
	})
})

describe("factories and shapes", () => {
	it("makes ids that are unique and safe to use anywhere", () => {
		const ids = new Set(Array.from({ length: 500 }, () => newId()))
		expect(ids.size).toBe(500)
		for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
	})

	it("gives every tool a themed object", () => {
		for (const tool of SHAPE_TOOLS) {
			const object = createObject(
				tool.id,
				{ x: 0, y: 0, w: 100, h: 80 },
				{ theme: "violet", z: 3 },
			)
			expect(object.kind).toBe("shape")
			expect(object.style.stroke).toBe(THEMES.violet.stroke)
			expect(object.z).toBe(3)
		}
		const text = createObject(
			TEXT_TOOL.id,
			{ x: 0, y: 0, w: 200, h: 36 },
			{ theme: "ocean", z: 1 },
		)
		expect(text.kind).toBe("text")
		expect(text.style.stroke).toBeNull()
		expect(text.text.paragraphs).toHaveLength(1)
	})

	it("sizes a click-placed shape, square and circle being 1:1", () => {
		expect(defaultRect("rectangle", { x: 100, y: 100 })).toEqual({
			x: 20,
			y: 50,
			w: 160,
			h: 100,
		})
		const circle = defaultRect("circle", { x: 0, y: 0 })
		expect(circle.w).toBe(circle.h)
		expect(circle.w).toBe(100)
	})

	it("never makes an object smaller than the minimum", () => {
		expect(
			createObject("rectangle", { x: 0, y: 0, w: 1, h: 1 }, { theme: "ocean", z: 1 }).w,
		).toBe(8)
	})

	it("describes the outline of each shape", () => {
		const base = { w: 100, h: 100 }
		expect(polygonPoints({ ...base, shape: "triangle" })).toHaveLength(3)
		expect(polygonPoints({ ...base, shape: "diamond" })).toHaveLength(4)
		expect(polygonPoints({ ...base, shape: "polygon", sides: 7 })).toHaveLength(7)
		expect(polygonPoints({ ...base, shape: "arrow" })).toHaveLength(7)
		expect(polygonPoints({ ...base, shape: "rectangle" })).toBeNull()
		expect(shapePath({ ...base, shape: "triangle" })).toBe("M50 0 L100 100 L0 100 Z")
	})

	it("keeps text inside a padded area that fits each shape", () => {
		const rectangle = textArea({ kind: "shape", shape: "rectangle", w: 200, h: 100 })
		expect(rectangle.x).toBe(12)
		expect(rectangle.w).toBe(176)
		const diamond = textArea({ kind: "shape", shape: "diamond", w: 200, h: 100 })
		expect(diamond.w).toBeLessThan(rectangle.w)
		expect(diamond.h).toBeLessThan(rectangle.h)
		const tiny = textArea({ kind: "shape", shape: "rectangle", w: 10, h: 10 })
		expect(tiny.w).toBeGreaterThanOrEqual(20)
		expect(heightForText({ kind: "shape", shape: "rectangle" }, 40)).toBe(52)
		expect(heightForText({ kind: "shape", shape: "diamond" }, 40)).toBe(104)
	})

	it("themes shapes with a tint, an outline and readable text", () => {
		for (const theme of Object.values(THEMES)) {
			expect(isColor(theme.fill) && isColor(theme.stroke) && isColor(theme.text)).toBe(true)
		}
		expect(themedStyle("nonsense").stroke).toBe(THEMES.ocean.stroke)
	})
})
