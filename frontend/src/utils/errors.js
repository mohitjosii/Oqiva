// Turns an error from the API into text a person can act on.

const FALLBACKS = {
	OqivaNotFound: "That item could not be found. It may have been deleted or moved.",
	OqivaForbidden: "You don't have permission to do that.",
	OqivaConflict: "That can't be done right now.",
	OqivaLimitExceeded: "A usage limit has been reached.",
	OqivaAiUnavailable: "Diagram generation is not enabled on this Oqiva instance.",
	OqivaError: "Something went wrong. Please try again.",
}

export class ApiError extends Error {
	constructor(message, { excType = null, status = null } = {}) {
		super(message)
		this.name = "ApiError"
		this.excType = excType
		this.status = status
	}

	get isNotFound() {
		return this.excType === "OqivaNotFound" || this.status === 404
	}

	get isForbidden() {
		return this.excType === "OqivaForbidden" || this.status === 403
	}
}

function stripHtml(text) {
	return String(text)
		.replace(/<[^>]*>/g, "")
		.trim()
}

export function toApiError(error) {
	if (error instanceof ApiError) return error
	const excType = error?.exc_type || null
	const status = error?.status || null
	const server = (error?.messages || []).map(stripHtml).find(Boolean)
	const known = excType && excType in FALLBACKS
	const message =
		(known && server && !/internal server error/i.test(server) ? server : null) ||
		FALLBACKS[excType] ||
		(status === 403 ? FALLBACKS.OqivaForbidden : null) ||
		(status === 404 ? FALLBACKS.OqivaNotFound : null) ||
		(status === 429 ? "You are going a little fast. Wait a minute and try again." : null) ||
		(!status
			? "You appear to be offline. Check your connection and try again."
			: FALLBACKS.OqivaError)
	return new ApiError(message, { excType, status })
}

export function messageFor(error) {
	return toApiError(error).message
}
