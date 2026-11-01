// Sorts a failed save into what the editor should do about it.
//
//   stale     someone else saved first: stop, and let the person reload
//   offline   the request never got an answer: keep the work, retry when we can
//   retry     the server answered with an error that may pass: keep the work, retry
//   blocking  the server refused for good (no access, too large): tell the person

const BLOCKING = new Set([
	"OqivaForbidden",
	"OqivaNotFound",
	"OqivaLimitExceeded",
	"OqivaDocumentTooNew",
	"OqivaError",
	"OqivaConflict",
])

export function classifyFailure(error) {
	if (error?.excType === "OqivaStaleRevision") return "stale"
	if (error?.excType && BLOCKING.has(error.excType)) return "blocking"
	// A reply of any kind means the server was reachable. Only no reply at all is "offline",
	// so a 500 is never reported as a lost connection.
	if (!error?.status) return "offline"
	return error.status >= 500 ? "retry" : "blocking"
}

export const isUncertain = (kind) => kind === "offline" || kind === "retry"
