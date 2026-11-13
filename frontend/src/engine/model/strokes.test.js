import { describe, expect, it } from "vitest"
import {
	STROKE_LIMITS,
	boardPoints,
	capPoints,
	createStroke,
	densify,
	distanceToStroke,
	eraseFromPoints,
	localPoints,
	outlinePath,
	strokePath,
	thinPoints,
} from "./strokes"
import { parseDocument } from "./schema"
import { createDocument } from "./schema"

const line = (n = 20, step = 5) => Array.from({ length: n }, (_, i) => [i * step, 10])

describe("thinning while drawing", () => {
	it("drops points closer than the gap but keeps the first and the last", () => {
		const raw = [
			[0, 0],
			[0.1, 0],
			[0.2, 0],
			[1, 0],
			[1.1, 0],
			[5, 0],
		]
		const thin = thinPoints(raw, 0.5)
		expect(thin[0]).toEqual([0, 0])
		expect(thin[thin.length - 1]).toEqual([5, 0])
		expect(thin.length).toBeLessThan(raw.length)
		for (let i = 1; i < thin.length - 1; i++)
			expect(thin[i][0] - thin[i - 1][0]).toBeGreaterThanOrEqual(0.5)
	})

	it("never reshapes a finished stroke: thinning again with the same gap changes nothing", () => {
		const once = thinPoints(line(200, 0.3), 1)
		expect(thinPoints(once, 1)).toEqual(once)
	})

	it("caps a stroke to the point limit and keeps both ends", () => {
		const many = line(STROKE_LIMITS.maxPoints * 3 + 7, 1)
		const capped = capPoints(many)
		expect(capped.length).toBeLessThanOrEqual(STROKE_LIMITS.maxPoints)
		expect(capped[0]).toEqual(many[0])
		expect(capped[capped.length - 1]).toEqual(many[many.length - 1])
	})
})

describe("a stroke is an ordinary object", () => {
	const stroke = createStroke({
		points: [
			[100, 100],
			[200, 150],
			[300, 100],
		],
		color: "#EF4444",
		width: 8,
		ink: "pen",
		z: 3,
	})

	it("has a box with room for the pen, and points as fractions of it", () => {
		expect(stroke.kind).toBe("stroke")
		expect(stroke.x).toBe(96)
		expect(stroke.w).toBe(208)
		for (const [x, y] of stroke.points) {
			expect(x).toBeGreaterThanOrEqual(0)
			expect(x).toBeLessThanOrEqual(1)
			expect(y).toBeGreaterThanOrEqual(0)
			expect(y).toBeLessThanOrEqual(1)
		}
		expect(boardPoints(stroke).map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([
			[100, 100],
			[200, 150],
			[300, 100],
		])
	})

	it("resizes with its box: the drawing scales and the pen width stays", () => {
		const big = { ...stroke, w: stroke.w * 2, h: stroke.h * 2 }
		const a = localPoints(stroke)
		const b = localPoints(big)
		expect(b[1][0]).toBeCloseTo(a[1][0] * 2, 1)
		expect(big.style.strokeWidth).toBe(8)
	})

	it("draws the same path every time, and a dot for one point", () => {
		expect(strokePath(stroke)).toBe(strokePath({ ...stroke }))
		expect(strokePath(stroke)).toMatch(/^M/)
		expect(outlinePath([[5, 5]], 10)).toContain("a5,5")
		expect(outlinePath([], 10)).toBe("")
	})

	it("is hit near its ink and not in the empty corner of its box", () => {
		expect(distanceToStroke(stroke, 4, 4)).toBeLessThan(1) // on the first point (in the stroke's own coordinates)
		expect(distanceToStroke(stroke, 4, 54)).toBeGreaterThan(20) // the box's empty corner
	})

	it("a highlighter is wider and see-through by default", () => {
		const h = createStroke({
			points: [
				[0, 0],
				[50, 0],
			],
			ink: "highlighter",
		})
		expect(h.style.opacity).toBeLessThan(1)
		expect(h.style.strokeWidth).toBeGreaterThan(8)
	})
})

describe("erasing a polyline", () => {
	it("cuts the touched part and keeps two pieces, each with at least two points", () => {
		const result = eraseFromPoints(line(41, 5), [100, 10], [100, 10], 8)
		expect(result.changed).toBe(true)
		expect(result.pieces).toHaveLength(2)
		for (const piece of result.pieces) expect(piece.length).toBeGreaterThanOrEqual(2)
		const gapStart = result.pieces[0][result.pieces[0].length - 1][0]
		const gapEnd = result.pieces[1][0][0]
		expect(gapStart).toBeLessThan(100)
		expect(gapEnd).toBeGreaterThan(100)
		expect(gapEnd - gapStart).toBeLessThanOrEqual(16 + 6) // about the tip's width
	})

	it("cuts in the middle of a long segment, not only at its points", () => {
		const result = eraseFromPoints(
			[
				[0, 0],
				[200, 0],
			],
			[100, 0],
			[100, 0],
			10,
		)
		expect(result.pieces).toHaveLength(2)
		expect(result.pieces[0][result.pieces[0].length - 1][0]).toBeLessThanOrEqual(90 + 1)
	})

	it("changes nothing when the tip misses, and removes everything when it covers it all", () => {
		const miss = eraseFromPoints(line(10), [0, 100], [50, 100], 5)
		expect(miss.changed).toBe(false)
		expect(miss.pieces).toEqual([line(10)])
		const all = eraseFromPoints(line(10), [-10, 10], [100, 10], 5)
		expect(all.pieces).toEqual([])
	})

	it("a sweep along the stroke leaves the ends", () => {
		const result = eraseFromPoints(line(41, 5), [60, 10], [140, 10], 6)
		expect(result.pieces).toHaveLength(2)
		expect(result.pieces[0][0]).toEqual([0, 10])
	})

	it("densify adds points on long segments", () => {
		expect(
			densify(
				[
					[0, 0],
					[10, 0],
				],
				2,
			),
		).toHaveLength(6)
	})
})

describe("how a document holds strokes", () => {
	const doc = (object) => ({ ...createDocument(), objects: [object] })
	const stroke = createStroke({
		points: [
			[0, 0],
			[30, 30],
			[60, 10],
		],
		color: "#111111",
		width: 40,
	})

	it("keeps a valid stroke whole, with a pen up to 80 wide", () => {
		const { document, issues } = parseDocument(doc(stroke))
		expect(issues).toEqual([])
		expect(document.objects[0]).toMatchObject({ kind: "stroke", ink: "pen" })
		expect(document.objects[0].style.strokeWidth).toBe(40)
		expect(document.objects[0].points).toHaveLength(3)
	})

	it("drops a stroke with no points, and clamps points and width", () => {
		expect(parseDocument(doc({ ...stroke, points: [] })).document.objects).toEqual([])
		const bad = parseDocument(
			doc({
				...stroke,
				points: [
					[-3, 9],
					["a", 1],
					[0.5, 0.5],
				],
				style: { ...stroke.style, strokeWidth: 500 },
				ink: "marker",
			}),
		).document.objects[0]
		expect(bad.points).toEqual([
			[0, 1],
			[0.5, 0.5],
		])
		expect(bad.style.strokeWidth).toBe(80)
		expect(bad.ink).toBe("pen")
	})

	it("keeps the sketch flag on a shape and the board settings", () => {
		const raw = {
			...createDocument(),
			canvas: { ...createDocument().canvas, sketch: true, doubleClick: "text" },
			objects: [
				{
					id: "s",
					kind: "shape",
					shape: "rectangle",
					x: 0,
					y: 0,
					w: 50,
					h: 50,
					style: { sketch: true },
				},
			],
		}
		const { document } = parseDocument(raw)
		expect(document.canvas).toMatchObject({ sketch: true, doubleClick: "text" })
		expect(document.objects[0].style.sketch).toBe(true)
		const odd = parseDocument({ ...raw, canvas: { sketch: "yes", doubleClick: "banana" } })
			.document.canvas
		expect(odd).toMatchObject({ sketch: false, doubleClick: "shape" })
	})
})
