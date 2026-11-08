import { describe, expect, it } from "vitest"
import { snapToGuides } from "./guides"

const box = (x, y, w = 100, h = 50) => ({ x, y, w, h })

describe("smart guides", () => {
	const targets = [box(300, 0), box(0, 200)]

	it("snaps an edge to a nearby edge, and draws the guide through both", () => {
		const { dx, dy, guides } = snapToGuides(box(296, 100), targets, 6)
		expect(dx).toBe(4) // left edge 296 -> 300
		expect(dy).toBe(0)
		expect(guides.some((g) => g.x1 === 300 && g.x2 === 300)).toBe(true)
		const line = guides.find((g) => g.x1 === 300)
		expect([line.y1, line.y2]).toEqual([0, 150]) // from the top of one box to the bottom of the other
	})

	it("snaps centres to centres, and edges to centres", () => {
		expect(snapToGuides(box(303, 100, 100, 50), [box(300, 0, 100, 50)], 6).dx).toBe(-3) // left edge to left edge
		const { dx } = snapToGuides(box(347, 100, 100, 50), [box(300, 0, 100, 50)], 6)
		expect(dx).toBe(3) // left edge 347 to the other's centre 350 (and centre 397 to its right edge 400)
	})

	it("does nothing outside the snap distance, so moving on escapes it", () => {
		const { dx, dy, guides } = snapToGuides(box(310, 120), targets, 6)
		expect([dx, dy]).toEqual([0, 0])
		expect(guides).toEqual([])
	})

	it("snaps each direction on its own", () => {
		const { dx, dy } = snapToGuides(box(296, 203), targets, 6)
		expect([dx, dy]).toEqual([4, -3])
	})

	it("works against the page edges as boxes", () => {
		const page = { x: 0, y: 0, w: 1000, h: 800 }
		const { dx, dy } = snapToGuides(box(902, 746), [page], 6)
		expect([dx, dy]).toEqual([-2, 4]) // right edge 1002 to 1000; bottom edge 796 to 800
	})

	it("reports every box that lines up, without repeating a guide", () => {
		const { guides } = snapToGuides(box(300, 120), [box(300, 0), box(300, 300)], 6)
		expect(guides.filter((g) => g.x1 === 300)).toHaveLength(2) // one to each box, spanning different heights
		const same = snapToGuides(box(300, 120), [box(300, 0), box(300, 0)], 6).guides
		expect(new Set(same.map((g) => JSON.stringify(g))).size).toBe(same.length)
	})
})
