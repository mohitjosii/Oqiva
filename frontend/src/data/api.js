import { call } from "frappe-ui"
import { toApiError } from "@/utils/errors"

// The messages Frappe puts in a failed response, as plain strings.
function serverMessages(payload) {
	try {
		return JSON.parse(payload._server_messages || "[]").map((m) => JSON.parse(m).message)
	} catch {
		return []
	}
}

// Sends a file as a multipart upload, which frappe-ui's call() cannot do.
export async function upload(method, params, file) {
	const body = new FormData()
	for (const [key, value] of Object.entries(params)) body.append(key, value)
	body.append("file", file)
	let response
	try {
		response = await fetch(`/api/method/oqiva.api.${method}`, {
			method: "POST",
			body,
			credentials: "same-origin",
			headers: { "X-Frappe-CSRF-Token": window.csrf_token },
		})
	} catch {
		throw toApiError({}) // no response at all: offline
	}
	const payload = await response.json().catch(() => ({}))
	if (!response.ok) {
		throw toApiError({
			exc_type: payload.exc_type,
			status: response.status,
			messages: serverMessages(payload),
		})
	}
	return payload.message
}

// Every call goes to oqiva.api.<method>. Failures come back as ApiError.
export async function api(method, params = {}) {
	try {
		return await call(`oqiva.api.${method}`, params)
	} catch (error) {
		throw toApiError(error)
	}
}
