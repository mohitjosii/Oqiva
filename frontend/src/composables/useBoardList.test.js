import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/data/api", () => ({ api: vi.fn() }))

import { api } from "@/data/api"
import { useBoardList } from "./useBoardList"

const page = (names, hasMore = false) => ({
	boards: names.map((name) => ({ name })),
	has_more: hasMore,
})

describe("useBoardList", () => {
	beforeEach(() => {
		api.mockReset()
	})

	it("loads a first page with the given parameters", async () => {
		api.mockResolvedValue(page(["a", "b"], true))
		const list = useBoardList(() => ({ scope: "all", workspace: "W" }))
		await list.load()
		expect(api).toHaveBeenCalledWith("board.list_boards", {
			scope: "all",
			workspace: "W",
			start: 0,
		})
		expect(list.boards.value.map((b) => b.name)).toEqual(["a", "b"])
		expect(list.hasMore.value).toBe(true)
	})

	it("appends the next page from where the list ends", async () => {
		api.mockResolvedValueOnce(page(["a", "b"], true)).mockResolvedValueOnce(page(["c"], false))
		const list = useBoardList(() => ({ scope: "all" }))
		await list.load()
		await list.loadMore()
		expect(api).toHaveBeenLastCalledWith("board.list_boards", { scope: "all", start: 2 })
		expect(list.boards.value.map((b) => b.name)).toEqual(["a", "b", "c"])
		expect(list.hasMore.value).toBe(false)
	})

	it("keeps the newest response when an older one lands last", async () => {
		let releaseOld
		api.mockImplementationOnce(
			() => new Promise((resolve) => (releaseOld = () => resolve(page(["old"])))),
		).mockResolvedValueOnce(page(["new"]))
		const list = useBoardList(() => ({ scope: "all" }))
		const slow = list.load()
		await list.load()
		releaseOld()
		await slow
		expect(list.boards.value.map((b) => b.name)).toEqual(["new"])
	})

	it("reports a failure and clears loading", async () => {
		api.mockRejectedValue({ exc_type: "OqivaNotFound", status: 404 })
		const list = useBoardList(() => ({ scope: "all" }))
		await list.load()
		expect(list.error.value.isNotFound).toBe(true)
		expect(list.loading.value).toBe(false)
	})
})
