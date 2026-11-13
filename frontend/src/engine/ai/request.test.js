import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AiError, requestDiagram } from "./request"

const DONE = { state: "done", kind: "flowchart", diagram: { nodes: [{ id: "a", label: "A" }] } }

function fakePort({ start = { request_id: "r1" }, results = [] } = {}) {
	let handler = null
	const queue = [...results]
	return {
		generate: vi.fn(async () => start),
		result: vi.fn(async () => {
			const next = queue.shift()
			if (next instanceof Error) throw next
			return next ?? { state: "pending" }
		}),
		onResult: vi.fn((fn) => {
			handler = fn
			return () => (handler = null)
		}),
		push: (message) => handler?.(message),
		listening: () => handler !== null,
	}
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("waiting for a diagram", () => {
	it("resolves when the live event arrives, and stops listening and polling", async () => {
		const port = fakePort()
		const promise = requestDiagram(port, { prompt: "a login flow", kind: "flowchart" })
		await vi.advanceTimersByTimeAsync(0)
		expect(port.generate).toHaveBeenCalledWith("a login flow", "flowchart")
		port.push({ request_id: "other", ...DONE }) // somebody else's answer is ignored
		port.push({ request_id: "r1", ...DONE })
		await expect(promise).resolves.toEqual({ kind: "flowchart", diagram: DONE.diagram })
		expect(port.listening()).toBe(false)
		await vi.advanceTimersByTimeAsync(20_000)
		expect(port.result).not.toHaveBeenCalled()
	})

	it("finds the answer by asking when no event comes", async () => {
		const port = fakePort({ results: [{ state: "pending" }, DONE] })
		const promise = requestDiagram(port, { prompt: "x", kind: "mindmap" })
		await vi.advanceTimersByTimeAsync(2500)
		await vi.advanceTimersByTimeAsync(2500)
		await expect(promise).resolves.toMatchObject({ kind: "flowchart" })
		expect(port.result).toHaveBeenCalledTimes(2)
		expect(port.result).toHaveBeenCalledWith("r1")
	})

	it("keeps an answer that beat the reply to the request", async () => {
		const port = fakePort()
		port.generate = vi.fn(async () => {
			port.push({ request_id: "r1", ...DONE })
			return { request_id: "r1" }
		})
		await expect(requestDiagram(port, { prompt: "x", kind: "flowchart" })).resolves.toBeTruthy()
	})

	it("turns a failed job into an error carrying the server's words and code", async () => {
		const port = fakePort()
		const promise = requestDiagram(port, { prompt: "x", kind: "flowchart" })
		const caught = promise.catch((e) => e)
		await vi.advanceTimersByTimeAsync(0)
		port.push({
			request_id: "r1",
			state: "error",
			code: "AI_INVALID",
			message: "The generated diagram was not valid. Try describing it a little differently.",
		})
		const error = await caught
		expect(error).toBeInstanceOf(AiError)
		expect(error.code).toBe("AI_INVALID")
		expect(error.message).toMatch(/not valid/)
	})

	it("rejects with the request's own error when it is refused (not enabled, rate limited)", async () => {
		const refusal = new Error("Diagram generation is not enabled on this Oqiva instance.")
		const port = fakePort()
		port.generate = vi.fn(async () => {
			throw refusal
		})
		await expect(requestDiagram(port, { prompt: "x", kind: "flowchart" })).rejects.toBe(refusal)
		expect(port.listening()).toBe(false)
	})

	it("gives up with an honest message when nothing ever answers", async () => {
		const port = fakePort()
		const caught = requestDiagram(port, { prompt: "x", kind: "flowchart" }).catch((e) => e)
		await vi.advanceTimersByTimeAsync(91_000)
		const error = await caught
		expect(error.code).toBe("AI_TIMEOUT")
		expect(error.message).toMatch(/background jobs/)
		expect(port.listening()).toBe(false)
	})

	it("survives a failed poll and tries again", async () => {
		const port = fakePort({ results: [new Error("offline"), DONE] })
		const promise = requestDiagram(port, { prompt: "x", kind: "flowchart" })
		await vi.advanceTimersByTimeAsync(5000)
		await expect(promise).resolves.toBeTruthy()
	})

	it("stops when cancelled", async () => {
		const port = fakePort()
		const controller = new AbortController()
		const caught = requestDiagram(
			port,
			{ prompt: "x", kind: "flowchart" },
			{ signal: controller.signal },
		).catch((e) => e)
		await vi.advanceTimersByTimeAsync(0)
		controller.abort()
		expect((await caught).code).toBe("AI_CANCELLED")
		expect(port.listening()).toBe(false)
	})
})
