// Saves the board after the person stops editing, and tells the truth about it.
//
// "Saved" is only ever shown once the server has said so. Work that could not be saved is
// kept and retried. A retry of unchanged content reuses its save id, so if the first attempt
// did reach the server (and only the reply was lost) the retry is recognised, not refused as
// a conflict.

import { newId } from "../model/ids"
import { classifyFailure, isUncertain } from "./failures"

export const SAVE_DEBOUNCE_MS = 1500
export const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000]

// status: saved | pending | saving | offline | error | conflict
export function createAutosave({
	save,
	getDocument,
	getRevisionInfo,
	onStatus = () => {},
	revision = 0,
	debounceMs = SAVE_DEBOUNCE_MS,
	retryDelays = RETRY_DELAYS_MS,
	setTimer = setTimeout,
	clearTimer = clearTimeout,
	makeSaveId = () => newId(16),
}) {
	let status = "saved"
	let message = ""
	let dirty = false
	let inFlight = null
	let timer = null
	let retries = 0
	let attempt = null // {saveId, json, uncertain} for the last save that did not finish cleanly
	let disposed = false

	function setStatus(next, text = "") {
		status = next
		message = text
		onStatus({ status, message })
	}

	const frozen = () => status === "conflict" || disposed

	function schedule(ms) {
		clearTimer(timer)
		timer = setTimer(() => flush(), ms)
	}

	async function resolveStale() {
		// Our own earlier attempt may have been the one that moved the revision.
		if (attempt?.uncertain && getRevisionInfo) {
			try {
				const info = await getRevisionInfo()
				if (info.last_save_id === attempt.saveId) {
					revision = info.revision
					attempt = null
					return true
				}
			} catch {
				return false
			}
		}
		return false
	}

	async function run() {
		clearTimer(timer)
		const json = JSON.stringify(getDocument())
		dirty = false
		const saveId = attempt && attempt.json === json ? attempt.saveId : makeSaveId()
		attempt = { saveId, json, uncertain: attempt?.uncertain && attempt.json === json }
		setStatus("saving")
		try {
			const result = await save({ document: json, baseRevision: revision, saveId })
			revision = result.revision
			attempt = null
			retries = 0
		} catch (error) {
			await fail(error)
			return
		}
		if (dirty) schedule(0)
		else setStatus("saved")
	}

	async function fail(error) {
		const kind = classifyFailure(error)
		if (kind === "stale") {
			if (await resolveStale()) {
				dirty = true // our earlier save landed; the same content is still to be confirmed
				schedule(0)
				return
			}
			setStatus("conflict", error.message)
			return
		}
		dirty = true
		if (isUncertain(kind)) {
			attempt.uncertain = true
			setStatus(kind === "offline" ? "offline" : "error", error.message)
			schedule(retryDelays[Math.min(retries++, retryDelays.length - 1)])
		} else {
			setStatus("error", error.message) // refused for good: wait for the person to change something
		}
	}

	function flush() {
		if (frozen()) return Promise.resolve()
		if (inFlight) return inFlight
		if (!dirty && status === "saved") return Promise.resolve()
		inFlight = run().finally(() => {
			inFlight = null
		})
		return inFlight
	}

	return {
		get status() {
			return status
		},
		get message() {
			return message
		},
		get revision() {
			return revision
		},
		get unsaved() {
			return status !== "saved"
		},
		// Something changed in the document.
		markDirty() {
			if (frozen()) return
			dirty = true
			if (!inFlight) setStatus("pending")
			if (!inFlight) schedule(debounceMs)
		},
		flush,
		// Try again now, as when the browser comes back online.
		retryNow() {
			if (frozen() || status === "saved" || inFlight) return flush()
			retries = 0
			return flush()
		},
		dispose() {
			disposed = true
			clearTimer(timer)
		},
	}
}
