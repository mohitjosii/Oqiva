import { describe, expect, it } from "vitest"
import { boundsOfObjects, corners, objectBounds, rectsIntersect, unionBounds } from "./bounds"
import { objectsInRect, pointInObject, topObjectAt } from "./hit"
import { HANDLES, handlePoint, resizeBox, rotationFor, snapAngle } from "./resize"
import {
	clampToExtent,
	createViewport,
	fitBounds,
	toBoard,
	toScreen,
	visibleRect,
	zoomAt,
	zoomStep,
} from "./viewport"

const rect = (over = {}) => ({
	id: "a",
	kind: "shape",
	shape: "rectangle",
	x: 0,
	y: 0,
	w: 100,
	h: 50,
	rotation: 0,
	...over,
})
const near = (a, b, digits = 6) => expect(a).toBeCloseTo(b, digits)

describe("viewport transform", () => {
	// Every interaction uses this one transform, so it is checked at the extremes of zoom,
	// after panning, in both directions.
	for (const scale of [0.1, 1, 4]) {
		it(`round-trips a point at ${scale * 100}% after a pan`, () => {
			const viewport = { x: -340.5, y: 128, scale }
			const point = { x: 123.4, y: -56.7 }
			const back = toBoard(viewport, toScreen(viewport, point))
			near(back.x, point.x)
			near(back.y, point.y)
		})
	}

	it("keeps the point under the cursor fixed while zooming", () => {
		const viewport = { x: 50, y: -20, scale: 1 }
		const cursor = { x: 400, y: 300 }
		const before = toBoard(viewport, cursor)
		for (const scale of [0.1, 0.5, 2, 4]) {
			const zoomed = zoomAt(viewport, cursor, scale)
			const after = toBoard(zoomed, cursor)
			near(after.x, before.x)
			near(after.y, before.y)
		}
	})

	it("clamps zoom to 10%-400% and steps in tenths", () => {
		expect(zoomAt(createViewport(), { x: 0, y: 0 }, 99).scale).toBe(4)
		expect(zoomAt(createViewport(), { x: 0, y: 0 }, 0.001).scale).toBe(0.1)
		let viewport = { x: 0, y: 0, scale: 1 }
		viewport = zoomStep(viewport, { x: 0, y: 0 }, 1)
		near(viewport.scale, 1.1)
		viewport = zoomStep({ x: 0, y: 0, scale: 0.13 }, { x: 0, y: 0 }, -1)
		near(viewport.scale, 0.1)
		near(zoomStep({ x: 0, y: 0, scale: 0.1 }, { x: 0, y: 0 }, -1).scale, 0.1)
	})

	it("reports the visible board rectangle", () => {
		const view = visibleRect({ x: -100, y: -50, scale: 2 }, { width: 800, height: 600 })
		expect(view).toEqual({ x: 50, y: 25, w: 400, h: 300 })
	})

	it("fits bounds with padding and does not blow a small shape up", () => {
		const size = { width: 1000, height: 600 }
		const fitted = fitBounds({ x: 0, y: 0, w: 100, h: 100 }, size)
		expect(fitted.scale).toBe(1)
		const big = fitBounds({ x: 0, y: 0, w: 4000, h: 1000 }, size)
		expect(big.scale).toBeLessThan(0.3)
		const centre = toScreen(big, { x: 2000, y: 500 })
		near(centre.x, 500)
		near(centre.y, 300)
		expect(fitBounds(null, size)).toEqual({ x: 500, y: 300, scale: 1 })
	})

	it("stops the view drifting more than a strip away from the content", () => {
		const size = { width: 1000, height: 600 }
		const extent = { x: 0, y: 0, w: 1280, h: 720 }
		const far = clampToExtent({ x: -99999, y: 99999, scale: 1 }, size, extent, 80)
		// at least 80px of the extent remains visible on the near side
		expect(toBoard(far, { x: 0, y: 0 }).x).toBeLessThanOrEqual(extent.w - 80)
		expect(toBoard(far, { x: 0, y: size.height }).y).toBeGreaterThanOrEqual(80)
		const inside = { x: 100, y: 50, scale: 1 }
		expect(clampToExtent(inside, size, extent, 80)).toEqual(inside)
	})
})

describe("bounds", () => {
	it("computes the box of a rotated object", () => {
		const turned = rect({ x: 0, y: 0, w: 100, h: 50, rotation: 90 })
		const box = objectBounds(turned)
		near(box.w, 50)
		near(box.h, 100)
		near(box.x + box.w / 2, 50)
		near(box.y + box.h / 2, 25)
		expect(corners(turned)).toHaveLength(4)
	})

	it("unions boxes and detects overlap", () => {
		expect(unionBounds([])).toBeNull()
		expect(
			unionBounds([
				{ x: 0, y: 0, w: 10, h: 10 },
				{ x: 20, y: 5, w: 10, h: 10 },
			]),
		).toEqual({ x: 0, y: 0, w: 30, h: 15 })
		expect(boundsOfObjects([rect(), rect({ x: 200 })])).toEqual({ x: 0, y: 0, w: 300, h: 50 })
		expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(
			false,
		)
		expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 10, h: 10 })).toBe(
			true,
		)
	})
})

describe("hit testing", () => {
	it("follows the outline of each shape", () => {
		const ellipse = rect({ shape: "ellipse", w: 100, h: 100 })
		expect(pointInObject(ellipse, { x: 50, y: 50 })).toBe(true)
		expect(pointInObject(ellipse, { x: 2, y: 2 })).toBe(false) // the empty corner
		const diamond = rect({ shape: "diamond", w: 100, h: 100 })
		expect(pointInObject(diamond, { x: 50, y: 50 })).toBe(true)
		expect(pointInObject(diamond, { x: 10, y: 10 })).toBe(false)
		const triangle = rect({ shape: "triangle", w: 100, h: 100 })
		expect(pointInObject(triangle, { x: 50, y: 90 })).toBe(true)
		expect(pointInObject(triangle, { x: 5, y: 10 })).toBe(false)
		const polygon = rect({ shape: "polygon", sides: 6, w: 100, h: 100 })
		expect(pointInObject(polygon, { x: 50, y: 50 })).toBe(true)
		expect(pointInObject(rect({ kind: "text" }), { x: 99, y: 49 })).toBe(true)
	})

	it("accounts for rotation", () => {
		const bar = rect({ x: 0, y: 0, w: 200, h: 20, rotation: 90 }) // now tall and thin around (100, 10)
		expect(pointInObject(bar, { x: 100, y: -60 })).toBe(true)
		expect(pointInObject(bar, { x: 20, y: 10 })).toBe(false)
	})

	it("widens thin shapes by the tolerance", () => {
		const line = rect({ w: 100, h: 2 })
		expect(pointInObject(line, { x: 50, y: 6 })).toBe(false)
		expect(pointInObject(line, { x: 50, y: 6 }, 5)).toBe(true)
		const triangle = rect({ shape: "triangle", w: 100, h: 100 })
		expect(pointInObject(triangle, { x: 50, y: -3 }, 5)).toBe(true)
	})

	it("picks the topmost object and selects what a marquee touches", () => {
		const below = rect({ id: "below" })
		const above = rect({ id: "above", x: 50 })
		expect(topObjectAt([below, above], { x: 60, y: 10 }).id).toBe("above")
		expect(topObjectAt([below, above], { x: 10, y: 10 }).id).toBe("below")
		expect(topObjectAt([below, above], { x: 500, y: 500 })).toBeNull()
		const picked = objectsInRect([below, above, rect({ id: "far", x: 900 })], {
			x: 90,
			y: 0,
			w: 20,
			h: 20,
		})
		expect(picked.map((o) => o.id)).toEqual(["below", "above"])
	})
})

describe("resizing", () => {
	it("keeps the opposite corner fixed", () => {
		const box = resizeBox(rect({ w: 100, h: 50 }), "se", { x: 150, y: 90 })
		expect(box).toEqual({ x: 0, y: 0, w: 150, h: 90 })
		const fromNorthWest = resizeBox(rect({ x: 10, y: 10, w: 100, h: 50 }), "nw", { x: 0, y: 0 })
		expect(fromNorthWest).toEqual({ x: 0, y: 0, w: 110, h: 60 })
	})

	it("moves only one axis for an edge handle", () => {
		expect(resizeBox(rect({ w: 100, h: 50 }), "e", { x: 180, y: 999 })).toEqual({
			x: 0,
			y: 0,
			w: 180,
			h: 50,
		})
		expect(resizeBox(rect({ w: 100, h: 50 }), "s", { x: -50, y: 80 })).toEqual({
			x: 0,
			y: 0,
			w: 100,
			h: 80,
		})
	})

	it("holds the aspect ratio when asked", () => {
		const box = resizeBox(
			rect({ w: 100, h: 50 }),
			"se",
			{ x: 300, y: 100 },
			{ keepAspect: true },
		)
		near(box.w / box.h, 2)
		const edge = resizeBox(rect({ w: 100, h: 50 }), "e", { x: 200, y: 0 }, { keepAspect: true })
		near(edge.w / edge.h, 2)
	})

	it("never goes below the minimum size", () => {
		const box = resizeBox(rect({ w: 100, h: 50 }), "se", { x: -500, y: -500 })
		expect(box.w).toBe(8)
		expect(box.h).toBe(8)
	})

	it("resizes along its own edges when rotated and keeps the opposite corner in place", () => {
		const turned = rect({ x: 0, y: 0, w: 100, h: 50, rotation: 90 })
		const anchor = handlePoint(turned, "nw")
		// the east handle of a 90-degree shape now points down the screen
		const east = handlePoint(turned, "e")
		const dragged = resizeBox(turned, "e", { x: east.x, y: east.y + 40 })
		near(dragged.w, 140)
		near(dragged.h, 50)
		const after = handlePoint({ ...turned, ...dragged }, "nw")
		near(after.x, anchor.x, 4)
		near(after.y, anchor.y, 4)
	})

	it("lists all eight handles", () => {
		expect(Object.keys(HANDLES)).toHaveLength(8)
		const p = handlePoint(rect({ w: 100, h: 50 }), "se")
		expect(p).toEqual({ x: 100, y: 50 })
	})
})

describe("rotation", () => {
	it("is upright when the pointer is straight above the centre", () => {
		const o = rect({ x: 0, y: 0, w: 100, h: 100 })
		near(rotationFor(o, { x: 50, y: -100 }), 0)
		near(rotationFor(o, { x: 200, y: 50 }), 90)
		near(rotationFor(o, { x: 50, y: 200 }), 180)
	})

	it("snaps to fifteen degree steps", () => {
		expect(snapAngle(7)).toBe(0)
		expect(snapAngle(8)).toBe(15)
		expect(snapAngle(44)).toBe(45)
		expect(snapAngle(-20)).toBe(-15)
	})
})
