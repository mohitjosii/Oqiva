import { describe, expect, it } from "vitest"
import { useAsync } from "./useAsync"

const later = (value, ms) => new Promise((resolve) => setTimeout(() => resolve(value), ms))

describe("useAsync", () => {
	it("stores the result and clears loading", async () => {
		const { data, loading, run } = useAsync(async () => "done")
		const pending = run()
		expect(loading.value).toBe(true)
		await pending
		expect(data.value).toBe("done")
		expect(loading.value).toBe(false)
	})

	it("keeps the newest result when an older request finishes last", async () => {
		const { data, run } = useAsync((value, ms) => later(value, ms))
		const slow = run("old", 30)
		const fast = run("new", 1)
		await Promise.all([slow, fast])
		expect(data.value).toBe("new")
	})

	it("turns a failure into an ApiError", async () => {
		const { error, run } = useAsync(async () => {
			throw { exc_type: "OqivaNotFound", status: 404 }
		})
		await run()
		expect(error.value.isNotFound).toBe(true)
	})
})
