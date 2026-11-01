import { describe, expect, it } from "vitest"
import { ApiError, messageFor, toApiError } from "./errors"

describe("toApiError", () => {
	it("keeps a typed server message", () => {
		const error = toApiError({
			exc_type: "OqivaLimitExceeded",
			status: 417,
			messages: ["<b>This workspace has reached its board limit.</b>"],
		})
		expect(error).toBeInstanceOf(ApiError)
		expect(error.message).toBe("This workspace has reached its board limit.")
	})

	it("falls back to friendly copy by type", () => {
		expect(
			messageFor({
				exc_type: "OqivaNotFound",
				status: 404,
				messages: ["Internal Server Error"],
			}),
		).toMatch(/could not be found/)
		expect(messageFor({ exc_type: "OqivaForbidden", status: 403, messages: [] })).toMatch(
			/permission/,
		)
	})

	it("treats a request that never completed as offline", () => {
		expect(messageFor(new TypeError("Failed to fetch"))).toMatch(/offline/)
	})

	it("flags not-found and forbidden", () => {
		expect(toApiError({ exc_type: "OqivaNotFound", status: 404 }).isNotFound).toBe(true)
		expect(toApiError({ status: 403 }).isForbidden).toBe(true)
	})

	it("does not wrap an ApiError twice", () => {
		const error = new ApiError("x")
		expect(toApiError(error)).toBe(error)
	})
})
