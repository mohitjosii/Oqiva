import { describe, expect, it } from "vitest"
import { objectBounds } from "../geometry/bounds"
import {
	alignChanges,
	distributeChanges,
	expandToGroups,
	flipChanges,
	groupChanges,
	removeGapsChanges,
	reorderChanges,
	rotateChanges,
	sameSizeChanges,
	swapChanges,
	ungroupChanges,
} from "./arrange"

const box = (id, x, y, w = 100, h = 50, over = {}) => ({
	id,
	kind: "shape",
	x,
	y,
	w,
	h,
	rotation: 0,
	z: 1,
	...over,
})
const apply = (objects, changes) =>
	objects.map((object) => {
		const change = changes.find((c) => c.id === object.id)
		if (!change) return object
		const next = { ...object }
		for (const [key, value] of Object.entries(change.patch)) {
			if (value === undefined) delete next[key]
			else next[key] = value
		}
		return next
	})
const zs = (list) => list.map((item) => `${item.id}:${item.z}`).join(" ")

describe("stacking order", () => {
	const list = [1, 2, 3, 4].map((n) => box(`o${n}`, 0, 0, 10, 10, { z: n }))
	const order = (changes) =>
		zs([...apply(list, changes)].sort((a, b) => a.z - b.z)).replace(/:-?\d+/g, "")

	it("brings to the front and sends to the back, keeping the selection's own order", () => {
		expect(order(reorderChanges(list, ["o1", "o2"], "front"))).toBe("o3 o4 o1 o2")
		expect(order(reorderChanges(list, ["o3", "o4"], "back"))).toBe("o3 o4 o1 o2")
	})

	it("moves one step at a time, past the neighbour that is not selected", () => {
		expect(order(reorderChanges(list, ["o2"], "forward"))).toBe("o1 o3 o2 o4")
		expect(order(reorderChanges(list, ["o2"], "backward"))).toBe("o2 o1 o3 o4")
		expect(order(reorderChanges(list, ["o1", "o2"], "forward"))).toBe("o3 o1 o2 o4")
	})

	it("does nothing when there is nowhere to go", () => {
		expect(reorderChanges(list, ["o4"], "front")).toEqual([])
		expect(reorderChanges(list, ["o4"], "forward")).toEqual([])
		expect(reorderChanges(list, ["o1"], "back")).toEqual([])
		expect(
			reorderChanges(
				list,
				list.map((o) => o.id),
				"front",
			),
		).toEqual([])
	})

	it("changes only the items that actually swap places", () => {
		expect(reorderChanges(list, ["o2"], "forward")).toHaveLength(2)
	})
})

describe("align", () => {
	const items = [box("a", 0, 0, 100, 50), box("b", 200, 100, 60, 80)]
	const ref = { x: 0, y: 0, w: 300, h: 200 }

	it("lines up edges and centres against a reference box", () => {
		const moved = (mode) => apply(items, alignChanges(items, mode, ref)).map((o) => [o.x, o.y])
		expect(moved("left")).toEqual([
			[0, 0],
			[0, 100],
		])
		expect(moved("right")).toEqual([
			[200, 0],
			[240, 100],
		])
		expect(moved("center")).toEqual([
			[100, 0],
			[120, 100],
		])
		expect(moved("top")).toEqual([
			[0, 0],
			[200, 0],
		])
		expect(moved("bottom")).toEqual([
			[0, 150],
			[200, 120],
		])
		expect(moved("middle")).toEqual([
			[0, 75],
			[200, 60],
		])
	})

	it("uses the turned outline of a rotated object", () => {
		const turned = [box("r", 100, 100, 200, 20, { rotation: 90 })] // its outline is 20 wide, 200 tall
		const [moved] = apply(turned, alignChanges(turned, "left", { x: 0, y: 0, w: 500, h: 500 }))
		expect(objectBounds(moved).x).toBeCloseTo(0)
	})

	it("returns no change for what is already in place", () => {
		expect(alignChanges([box("a", 0, 0)], "left", { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
	})
})

describe("distribute", () => {
	const items = [box("a", 0, 0, 100, 50), box("b", 130, 0, 50, 50), box("c", 400, 0, 100, 50)]

	it("makes the gaps between three or more objects equal", () => {
		const out = apply(items, distributeChanges(items, "horizontal"))
		const [a, b, c] = out.map(objectBounds)
		expect(b.x - (a.x + a.w)).toBeCloseTo(c.x - (b.x + b.w))
		expect([a.x, c.x]).toEqual([0, 400]) // the outer two stay put
	})

	it("works whatever order the objects were picked in", () => {
		const shuffled = [items[2], items[0], items[1]]
		const out = apply(items, distributeChanges(shuffled, "horizontal"))
		expect(out.map((o) => o.x)).toEqual([0, 225, 400]) // (500 - 250 of boxes) / 2 = 125 between each
	})

	it("needs three objects", () => {
		expect(distributeChanges(items.slice(0, 2), "horizontal")).toEqual([])
	})

	it("closes the gaps, starting from the first one", () => {
		const out = apply(items, removeGapsChanges(items, "horizontal"))
		expect(out.map((o) => o.x)).toEqual([0, 100, 150])
		const tall = [box("a", 0, 0, 10, 40), box("b", 0, 90, 10, 40)]
		expect(apply(tall, removeGapsChanges(tall, "vertical")).map((o) => o.y)).toEqual([0, 40])
	})
})

describe("same size and swap", () => {
	const items = [
		box("a", 0, 0, 100, 50),
		box("b", 200, 100, 60, 80),
		box("t", 0, 0, 10, 10, { kind: "table" }),
	]

	it("matches the reference, around each object's own centre", () => {
		const out = apply(items, sameSizeChanges(items, items[0], "both"))
		expect([out[1].w, out[1].h]).toEqual([100, 50])
		expect([out[1].x + out[1].w / 2, out[1].y + out[1].h / 2]).toEqual([230, 140])
		expect(out[2]).toEqual(items[2]) // a table is as big as its cells
	})

	it("matches one dimension only", () => {
		const out = apply(items, sameSizeChanges(items, items[0], "width"))
		expect([out[1].w, out[1].h]).toEqual([100, 80])
	})

	it("swaps the centres of two objects", () => {
		const out = apply(items, swapChanges(items[0], items[1]))
		expect([out[0].x + 50, out[0].y + 25]).toEqual([230, 140])
		expect([out[1].x + 30, out[1].y + 40]).toEqual([50, 25])
	})
})

describe("rotate and flip", () => {
	it("turns a lone object about its own centre", () => {
		const [out] = apply([box("a", 0, 0, 100, 50)], rotateChanges([box("a", 0, 0, 100, 50)], 90))
		expect(out.rotation).toBe(90)
		expect([out.x, out.y]).toEqual([0, 0])
	})

	it("turns several objects about their common centre", () => {
		const items = [box("a", 0, 0, 100, 100), box("b", 200, 0, 100, 100)]
		const out = apply(items, rotateChanges(items, 90))
		expect(out[0].x + 50).toBeCloseTo(150)
		expect(out[0].y + 50).toBeCloseTo(-50) // the row of two becomes a column about (150, 50)
		expect(out.map((o) => o.rotation)).toEqual([90, 90])
		expect(Math.abs(out[0].y - out[1].y)).toBeCloseTo(200)
	})

	it("flips by toggling the mirror flag, and flipping twice restores everything", () => {
		const items = [box("a", 0, 0, 100, 50), box("b", 200, 0, 100, 50, { rotation: 30 })]
		const once = apply(items, flipChanges(items, "horizontal"))
		expect(once[1].flipX).toBe(true)
		expect(once[1].rotation).toBe(330)
		expect(once[0].x).toBeGreaterThan(items[0].x + 150) // the two have swapped sides
		const twice = apply(once, flipChanges(once, "horizontal"))
		expect(twice[1].flipX).toBeUndefined()
		expect(twice[1].rotation).toBe(30)
		expect(twice[0].x).toBeCloseTo(0)
		expect(twice[1].x).toBeCloseTo(200)
	})

	it("flips vertically on the other flag", () => {
		const [out] = apply([box("a", 0, 0)], flipChanges([box("a", 0, 0)], "vertical"))
		expect(out.flipY).toBe(true)
		expect(out.flipX).toBeUndefined()
	})
})

describe("groups", () => {
	const items = [box("a", 0, 0), box("b", 0, 0), box("c", 0, 0)]

	it("gives members a shared id, and takes it away again", () => {
		const grouped = apply(items, groupChanges(items.slice(0, 2), "g1"))
		expect(grouped.map((o) => o.groupId)).toEqual(["g1", "g1", undefined])
		expect(groupChanges([items[0]], "g1")).toEqual([])
		expect(apply(grouped, ungroupChanges(grouped)).every((o) => o.groupId === undefined)).toBe(
			true,
		)
	})

	it("picks a whole group when one member is picked", () => {
		const grouped = apply(items, groupChanges(items.slice(0, 2), "g1"))
		expect(expandToGroups(grouped, ["a"]).sort()).toEqual(["a", "b"])
		expect(expandToGroups(grouped, ["c"])).toEqual(["c"])
	})
})
