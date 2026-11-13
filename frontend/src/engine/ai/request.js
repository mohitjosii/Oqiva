// Asking for a diagram and waiting for it. The server answers a request at once with an id and does
// the work in the background; the finished description arrives as a live event, and is also fetched
// every few seconds in case the event never comes (the live link is down, or the page was asleep).

export const WAIT_MS = 90_000 // the provider is given 45 s; the rest is for a busy queue
export const POLL_MS = 2500

export class AiError extends Error {
	constructor(message, code = null) {
		super(message)
		this.name = "AiError"
		this.code = code
	}
}

// ``port``: {generate(prompt, kind) -> {request_id}, result(id), onResult(handler) -> off}.
// Resolves with {kind, diagram}; rejects with an AiError whose message is safe to show.
// ``signal`` (an AbortSignal) stops waiting; the job itself cannot be recalled.
export function requestDiagram(
	port,
	{ prompt, kind },
	{ signal, waitMs = WAIT_MS, pollMs = POLL_MS } = {},
) {
	return new Promise((resolve, reject) => {
		let done = false
		let id = null
		let off = null
		let poll = null
		let deadline = null
		let polling = false

		const finish = (action) => {
			if (done) return
			done = true
			off?.()
			clearInterval(poll)
			clearTimeout(deadline)
			signal?.removeEventListener("abort", onAbort)
			action()
		}
		const settle = (outcome) => {
			if (!outcome || outcome.state === "pending") return
			if (outcome.state === "done")
				finish(() => resolve({ kind: outcome.kind, diagram: outcome.diagram }))
			else
				finish(() =>
					reject(
						new AiError(
							outcome.message || "Diagram generation is temporarily unavailable.",
							outcome.code,
						),
					),
				)
		}
		const onAbort = () => finish(() => reject(new AiError("Cancelled.", "AI_CANCELLED")))
		if (signal?.aborted) return onAbort()
		signal?.addEventListener("abort", onAbort)

		// listen before asking, so an answer that is quicker than the reply to the request is not missed
		let early = null
		off = port.onResult((message) => {
			if (id === null) early = message
			else if (message.request_id === id) settle(message)
		})
		deadline = setTimeout(
			() =>
				finish(() =>
					reject(
						new AiError(
							"Diagram generation took too long. If this keeps happening, ask your administrator whether background jobs are running.",
							"AI_TIMEOUT",
						),
					),
				),
			waitMs,
		)

		port.generate(prompt, kind).then(
			(started) => {
				if (done) return
				id = started.request_id
				if (early?.request_id === id) settle(early)
				if (done) return
				poll = setInterval(async () => {
					if (polling || done) return
					polling = true
					try {
						settle(await port.result(id))
					} catch {
						// the next tick tries again; the deadline ends it
					} finally {
						polling = false
					}
				}, pollMs)
			},
			(error) => finish(() => reject(error)),
		)
	})
}
