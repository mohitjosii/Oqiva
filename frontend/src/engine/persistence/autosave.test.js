import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/utils/errors"
import { classifyFailure } from "./failures"
import { createAutosave } from "./autosave"

const failure = (excType, status) => new ApiError("boom", { excType, status })
let version = 0
let revisionAtServer
let calls
let saved

function setup(overrides = {}) {
	version = 0
	revisionAtServer = 1
	calls = []
	saved = []
	const statuses = []
	const save = vi.fn(async (payload) => {
		calls.push(payload)
		const outcome = overrides.outcomes?.shift()
		if (outcome) await outcome(payload)
		revisionAtServer += 1
		saved.push(payload.document)
		return { revision: revisionAtServer }
	})
	const autosave = createAutosave({
		save,
		getDocument: () => ({ v: version }),
		getRevisionInfo: overrides.getRevisionInfo,
		onStatus: ({ status }) => statuses.push(status),
		revision: 1,
		makeSaveId: (() => {
			let n = 0
			return () => `save${++n}`
		})(),
	})
	return { autosave, save, statuses }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("autosave timing and truthfulness", () => {
	it("waits for the person to pause, then saves once", async () => {
		const { autosave, save, statuses } = setup()
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1000)
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1000)
		expect(save).not.toHaveBeenCalled() // 1.0s after the last change is not yet 1.5s
		await vi.advanceTimersByTimeAsync(600)
		expect(save).toHaveBeenCalledTimes(1)
		expect(statuses).toEqual(["pending", "pending", "saving", "saved"])
		expect(autosave.status).toBe("saved")
	})

	it("never says saved before the server answered", async () => {
		let release
		const { autosave } = setup({
			outcomes: [() => new Promise((resolve) => (release = resolve))],
		})
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		expect(autosave.status).toBe("saving")
		release()
		await vi.advanceTimersByTimeAsync(0)
		expect(autosave.status).toBe("saved")
	})

	it("sends each save against the revision the last one produced", async () => {
		const { autosave } = setup()
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		version = 1
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		expect(calls.map((c) => c.baseRevision)).toEqual([1, 2])
		expect(autosave.revision).toBe(3)
		expect(new Set(calls.map((c) => c.saveId)).size).toBe(2)
	})

	it("saves again straight after a save that finished while the person kept editing", async () => {
		let release
		const { autosave } = setup({
			outcomes: [() => new Promise((resolve) => (release = resolve))],
		})
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		version = 5
		autosave.markDirty() // during the save
		release()
		await vi.advanceTimersByTimeAsync(10)
		expect(calls).toHaveLength(2)
		expect(JSON.parse(calls[1].document)).toEqual({ v: 5 })
		expect(autosave.status).toBe("saved")
	})

	it("flush saves immediately and resolves when done", async () => {
		const { autosave, save } = setup()
		autosave.markDirty()
		await autosave.flush()
		expect(save).toHaveBeenCalledTimes(1)
		expect(autosave.unsaved).toBe(false)
		await autosave.flush() // nothing to do
		expect(save).toHaveBeenCalledTimes(1)
	})
})

describe("autosave failures", () => {
	it("keeps the work offline and retries with growing delays until it lands", async () => {
		const down = () => {
			throw failure(null, null)
		}
		const { autosave, save, statuses } = setup({ outcomes: [down, down] })
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		expect(autosave.status).toBe("offline")
		await vi.advanceTimersByTimeAsync(1800)
		expect(save).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(200) // 2s retry
		expect(save).toHaveBeenCalledTimes(2)
		expect(autosave.status).toBe("offline")
		await vi.advanceTimersByTimeAsync(5000) // then 5s
		expect(save).toHaveBeenCalledTimes(3)
		expect(autosave.status).toBe("saved")
		expect(statuses).toContain("offline")
	})

	it("reuses the save id when retrying unchanged content, and uses a new one if it changed", async () => {
		const down = () => {
			throw failure(null, null)
		}
		const { autosave } = setup({ outcomes: [down, down] })
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		await vi.advanceTimersByTimeAsync(2100) // retry, still down
		version = 9
		await vi.advanceTimersByTimeAsync(5100) // retry with changed content
		expect(calls[1].saveId).toBe(calls[0].saveId)
		expect(calls[2].saveId).not.toBe(calls[0].saveId)
	})

	it("recognises its own lost-reply save instead of reporting a conflict", async () => {
		const staleThenInfo = {
			getRevisionInfo: vi.fn(async () => ({ revision: 2, last_save_id: "save1" })),
			outcomes: [
				() => {
					throw failure(null, null) // the reply was lost: the server may have saved
				},
				() => {
					throw failure("OqivaStaleRevision", 417) // ...and it did, so the retry is stale
				},
			],
		}
		const { autosave, statuses } = setup(staleThenInfo)
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		await vi.advanceTimersByTimeAsync(2100)
		await vi.advanceTimersByTimeAsync(50)
		expect(statuses).not.toContain("conflict")
		expect(autosave.status).toBe("saved")
		expect(autosave.revision).toBeGreaterThanOrEqual(2)
	})

	it("reports a genuine conflict, stops saving, and ignores further edits", async () => {
		const { autosave, save } = setup({
			outcomes: [
				() => {
					throw failure("OqivaStaleRevision", 417)
				},
			],
			getRevisionInfo: vi.fn(async () => ({ revision: 9, last_save_id: "someone-else" })),
		})
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		expect(autosave.status).toBe("conflict")
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(5000)
		expect(save).toHaveBeenCalledTimes(1)
		expect(autosave.status).toBe("conflict")
	})

	it("does not retry a refusal, but tries again when the person changes something", async () => {
		const { autosave, save } = setup({
			outcomes: [
				() => {
					throw failure("OqivaLimitExceeded", 417)
				},
			],
		})
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		expect(autosave.status).toBe("error")
		await vi.advanceTimersByTimeAsync(60000)
		expect(save).toHaveBeenCalledTimes(1)
		version = 1
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		expect(save).toHaveBeenCalledTimes(2)
		expect(autosave.status).toBe("saved")
	})

	it("retryNow tries immediately, as when the browser comes back online", async () => {
		const down = () => {
			throw failure(null, null)
		}
		const { autosave, save } = setup({ outcomes: [down] })
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		expect(autosave.status).toBe("offline")
		await autosave.retryNow()
		expect(save).toHaveBeenCalledTimes(2)
		expect(autosave.status).toBe("saved")
	})

	it("stops everything once disposed", async () => {
		const { autosave, save } = setup()
		autosave.markDirty()
		autosave.dispose()
		await vi.advanceTimersByTimeAsync(5000)
		expect(save).not.toHaveBeenCalled()
	})
})

describe("classifyFailure", () => {
	it("tells the cases apart", () => {
		expect(classifyFailure(failure("OqivaStaleRevision", 417))).toBe("stale")
		expect(classifyFailure(failure(null, null))).toBe("offline")
		expect(classifyFailure(failure(null, 502))).toBe("retry")
		expect(classifyFailure(failure("OqivaForbidden", 403))).toBe("blocking")
		expect(classifyFailure(failure("OqivaLimitExceeded", 417))).toBe("blocking")
		expect(classifyFailure(failure(null, 400))).toBe("blocking")
	})
})

describe("merging before saving again (someone else saved first)", () => {
	// A server whose revision can move under us, and a recover that merges and reports it.
	function collab({ moves = 1, recoverFails = null } = {}) {
		let server = 1
		let ours = { v: 0 }
		let crdt = "ours"
		let pending = moves
		const statuses = []
		const payloads = []
		const merges = []
		const autosave = createAutosave({
			save: async (payload) => {
				payloads.push(payload)
				if (payload.baseRevision < server || pending > 0) {
					if (pending > 0) {
						pending--
						server += 1
					}
					throw failure("OqivaStaleRevision", 409)
				}
				server += 1
				return { revision: server }
			},
			getDocument: () => ours,
			getCrdtState: () => crdt,
			recover: async () => {
				merges.push(server)
				if (recoverFails && merges.length <= recoverFails.times) throw recoverFails.error
				ours = { v: 0, merged: merges.length } // what merging the server's work does to the document
				crdt = `merged${merges.length}`
				return server
			},
			onStatus: ({ status }) => statuses.push(status),
			revision: 1,
			makeSaveId: (() => {
				let n = 0
				return () => `id${++n}`
			})(),
		})
		return {
			autosave,
			statuses,
			payloads,
			merges,
			get server() {
				return server
			},
		}
	}

	it("merges the server's state and saves again on top of its revision, without stopping", async () => {
		const c = collab()
		c.autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		await vi.advanceTimersByTimeAsync(400)
		expect(c.merges).toHaveLength(1)
		expect(c.payloads).toHaveLength(2)
		expect(c.payloads[0].baseRevision).toBe(1)
		expect(c.payloads[1].baseRevision).toBe(c.merges[0]) // on top of what the server holds
		expect(c.payloads[1].crdtState).toBe("merged1") // the merged state, not the old one
		expect(JSON.parse(c.payloads[1].document).merged).toBe(1)
		expect(c.autosave.status).toBe("saved")
		expect(c.statuses).not.toContain("conflict")
		expect(c.payloads[1].saveId).not.toBe(c.payloads[0].saveId) // different content gets a new id
	})

	it("sends the collaboration state with every save", async () => {
		const c = collab({ moves: 0 })
		c.autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		expect(c.payloads[0].crdtState).toBe("ours")
		expect(c.payloads[0].resync).toBe(false)
	})

	it("keeps trying through several moves of the server, then gives up as a conflict", async () => {
		const c = collab({ moves: 99 })
		c.autosave.markDirty()
		await vi.advanceTimersByTimeAsync(60000)
		expect(c.merges).toHaveLength(5)
		expect(c.autosave.status).toBe("conflict")
		const before = c.payloads.length
		await vi.advanceTimersByTimeAsync(60000)
		expect(c.payloads.length).toBe(before) // a conflict stops it writing
	})

	it("survives the server moving three times before it settles", async () => {
		const c = collab({ moves: 3 })
		c.autosave.markDirty()
		await vi.advanceTimersByTimeAsync(20000)
		expect(c.merges).toHaveLength(3)
		expect(c.autosave.status).toBe("saved")
	})

	it("when fetching the server's state fails, keeps the work and tries again later", async () => {
		const c = collab({ recoverFails: { times: 1, error: new ApiError("down", { status: 0 }) } })
		c.autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		expect(["offline", "error"]).toContain(c.autosave.status)
		await vi.advanceTimersByTimeAsync(10000)
		expect(c.autosave.status).toBe("saved")
	})

	it("without a recover function, a stale save still stops as a conflict", async () => {
		const { autosave, statuses } = setup({
			outcomes: [async () => Promise.reject(failure("OqivaStaleRevision", 409))],
		})
		autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		expect(statuses.at(-1)).toBe("conflict")
	})

	it("asks the server to tell everyone when the content was too big to share live", async () => {
		const c = collab({ moves: 0 })
		c.autosave.requestResync()
		await vi.advanceTimersByTimeAsync(1600)
		expect(c.payloads[0].resync).toBe(true)
		c.autosave.markDirty()
		await vi.advanceTimersByTimeAsync(1600)
		expect(c.payloads[1].resync).toBe(false) // once is enough
	})
})
