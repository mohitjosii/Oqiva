import { describe, expect, it } from "vitest"
import { createObject } from "../model/factories"
import {
	draftPosition,
	insertMention,
	mentionParts,
	mentionQuery,
	pinPosition,
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
})
