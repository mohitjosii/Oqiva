// localStorage that never throws: it can be blocked, full, or missing.

export function readStored(key, fallback = null) {
	try {
		const raw = window.localStorage.getItem(key)
		return raw === null ? fallback : JSON.parse(raw)
	} catch {
		return fallback
	}
}

export function writeStored(key, value) {
	try {
		window.localStorage.setItem(key, JSON.stringify(value))
	} catch {
		// Preferences are a convenience. Losing one is fine.
	}
}
