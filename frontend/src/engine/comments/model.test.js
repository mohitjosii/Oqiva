import { describe, expect, it } from "vitest"
import { createObject } from "../model/factories"
import {
	draftPosition,
	insertMention,
	mentionParts,
	mentionQuery,
	pinPosition,
	placeSuggestions,
	SUGGESTION_ROW,
	suggestPeople,
	threadCounts,
	timeAgo,
	visibleThreads,
} from "./model"

const box = (id, x, y, over = {}) => ({
	...createObject("rectangle", { x, y, w: 100, h: 60 }, { theme: "ocean", z: 1 }),
	id,
	...over,
})
const byId = (...objects) => new Map(objects.map((o) => [o.id, o]))

describe("where a pin goes", () => {
	it("is the top-right corner of its shape, following the shape when it moves", () => {
		const thread = { anchor_type: "shape", shape_id: "s" }
		expect(pinPosition(thread, byId(box("s", 10, 20)))).toEqual({ x: 110, y: 20 })
		expect(pinPosition(thread, byId(box("s", 300, 400)))).toEqual({ x: 400, y: 400 })
	})

	it("uses the turned outline of a rotated shape", () => {
		const thread = { anchor_type: "shape", shape_id: "s" }
		const spot = pinPosition(thread, byId(box("s", 0, 0, { rotation: 90 })))
		expect(spot.x).toBeCloseTo(80) // a 100 by 60 box turned a quarter is 60 wide, centred on (50, 30)
		expect(spot.y).toBeCloseTo(-20)
	})

	it("has no place when the shape is gone, and is the point itself for a point", () => {
		expect(
			pinPosition({ anchor_type: "shape", shape_id: "gone" }, byId(box("s", 0, 0))),
		).toBeNull()
		expect(pinPosition({ anchor_type: "point", x: 5, y: -6 }, byId())).toEqual({ x: 5, y: -6 })
		expect(pinPosition({ anchor_type: "point", x: null, y: 1 }, byId())).toBeNull()
		expect(draftPosition({ anchor_type: "point", x: 1, y: 2 }, byId())).toEqual({ x: 1, y: 2 })
	})
})

describe("mentions in text", () => {
	it("splits text into plain pieces and mentions without treating anything as markup", () => {
		expect(mentionParts("hi @a@b.com and <b>@c.d@e.org</b>!")).toEqual([
			{ text: "hi ", mention: false },
			{ text: "@a@b.com", mention: true },
			{ text: " and <b>", mention: false },
			{ text: "@c.d@e.org", mention: true },
			{ text: "</b>!", mention: false },
		])
		expect(mentionParts("nothing here")).toEqual([{ text: "nothing here", mention: false }])
		expect(mentionParts("")).toEqual([])
	})

	it("finds the word being typed after an @, only at the end", () => {
		expect(mentionQuery("hello @ma")).toBe("ma")
		expect(mentionQuery("@")).toBe("")
		expect(mentionQuery("hello @ma and")).toBeNull()
		expect(mentionQuery("mail me@home")).toBeNull()
		expect(mentionQuery("x @a@b.com")).toBeNull()
	})

	it("suggests people by the start of a name or address, and writes the address in", () => {
		const people = [
			{ email: "maria@x.com", full_name: "Maria Silva" },
			{ email: "tom@x.com", full_name: "Tom Marsh" },
			{ email: "ann@x.com", full_name: "Ann Lee" },
		]
		expect(suggestPeople(people, "ma").map((p) => p.email)).toEqual([
			"maria@x.com",
			"tom@x.com",
		])
		expect(suggestPeople(people, "").length).toBe(3)
		expect(suggestPeople(people, "zzz")).toEqual([])
		expect(suggestPeople(people, "", 2)).toHaveLength(2)
		expect(insertMention("hi @ma", people[0])).toBe("hi @maria@x.com ")
	})
})

describe("threads", () => {
	const threads = [{ resolved: 0 }, { resolved: 1 }, { resolved: 0 }]
	it("counts and filters open and resolved threads", () => {
		expect(threadCounts(threads)).toEqual({ open: 2, resolved: 1 })
		expect(visibleThreads(threads, "open")).toHaveLength(2)
		expect(visibleThreads(threads, "resolved")).toHaveLength(1)
	})

	it("says how long ago, in plain words", () => {
		const now = new Date("2026-11-10T12:00:00").getTime()
		expect(timeAgo("2026-11-10 11:59:40.123", now)).toBe("just now")
		expect(timeAgo("2026-11-10 11:30:00", now)).toBe("30 min ago")
		expect(timeAgo("2026-11-10 07:00:00", now)).toBe("5 h ago")
		expect(timeAgo("2026-11-07 12:00:00", now)).toBe("3 d ago")
		expect(timeAgo("not a date", now)).toBe("")
	})

	describe("placeSuggestions", () => {
		const screen = { width: 1360, height: 860 }
		const anchor = (top, over = {}) => ({
			top,
			bottom: top + 80,
			left: 100,
			width: 280,
			...over,
		})

		it("opens below the box when there is room, so a box at the top of the panel is not cut off", () => {
			const spot = placeSuggestions(anchor(120), screen, 6)
			expect(spot.below).toBe(true)
			expect(spot.top).toBe(120 + 80 + 4)
			expect(spot.top + 6 * SUGGESTION_ROW).toBeLessThan(screen.height)
		})

		it("opens above the box near the bottom of the screen, and stays on the screen", () => {
			const spot = placeSuggestions(anchor(700), screen, 6)
			expect(spot.below).toBe(false)
			expect(spot.top).toBeGreaterThanOrEqual(8)
			expect(spot.top + Math.min(6 * SUGGESTION_ROW + 2, spot.maxHeight)).toBeLessThanOrEqual(
				700,
			)
		})

		it("shrinks to the room it has rather than running off the screen", () => {
			const spot = placeSuggestions(anchor(200), { width: 1360, height: 400 }, 6)
			expect(spot.maxHeight).toBeLessThan(6 * SUGGESTION_ROW)
			const height = Math.min(6 * SUGGESTION_ROW + 2, spot.maxHeight)
			expect(spot.top).toBeGreaterThanOrEqual(8)
			expect(spot.top + height).toBeLessThanOrEqual(200)
		})

		it("keeps the list inside the screen sideways, and no wider than it", () => {
			const wide = placeSuggestions(anchor(100, { left: 1300, width: 280 }), screen, 3)
			expect(wide.left + wide.width).toBeLessThanOrEqual(screen.width - 8)
			const narrow = placeSuggestions(
				anchor(100, { left: -20, width: 600 }),
				{ width: 320, height: 640 },
				3,
			)
			expect(narrow.left).toBeGreaterThanOrEqual(8)
			expect(narrow.width).toBeLessThanOrEqual(320 - 16)
		})
	})
})
