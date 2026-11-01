import { describe, expect, it } from "vitest"
import { daysLeft, parseFrappeDate, timeAgo } from "./time"

const now = new Date("2026-11-01T12:00:00")

describe("timeAgo", () => {
	it("reads Frappe datetimes", () => {
		expect(parseFrappeDate("2026-11-01 11:00:00.123456")).toBeInstanceOf(Date)
		expect(parseFrappeDate("garbage")).toBeNull()
		expect(parseFrappeDate(null)).toBeNull()
	})

	it("describes elapsed time", () => {
		expect(timeAgo("2026-11-01 11:59:50", now)).toBe("just now")
		expect(timeAgo("2026-11-01 11:55:00", now)).toBe("5 minutes ago")
		expect(timeAgo("2026-11-01 11:00:00", now)).toBe("1 hour ago")
		expect(timeAgo("2026-10-30 12:00:00", now)).toBe("2 days ago")
		expect(timeAgo("2026-08-01 12:00:00", now)).toBe("3 months ago")
	})

	it("never goes negative for a clock-skewed future time", () => {
		expect(timeAgo("2026-11-01 12:10:00", now)).toBe("just now")
	})
})

describe("daysLeft", () => {
	it("counts down the trash retention", () => {
		expect(daysLeft("2026-10-25 12:00:00", 30, now)).toBe(23)
		expect(daysLeft("2026-08-01 12:00:00", 30, now)).toBe(0)
		expect(daysLeft(null, 30, now)).toBeNull()
	})
})
