// Relative times for tiles and lists. Frappe sends "YYYY-MM-DD HH:mm:ss.ffffff" in
// the site's time zone, which the browser reads as local time.

const UNITS = [
	["year", 31536000],
	["month", 2592000],
	["day", 86400],
	["hour", 3600],
	["minute", 60],
]

export function parseFrappeDate(value) {
	if (!value) return null
	const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T"))
	return Number.isNaN(date.getTime()) ? null : date
}

export function timeAgo(value, now = new Date()) {
	const date = parseFrappeDate(value)
	if (!date) return ""
	const seconds = Math.max(0, Math.round((now - date) / 1000))
	if (seconds < 45) return "just now"
	for (const [unit, size] of UNITS) {
		if (seconds >= size) {
			const count = Math.floor(seconds / size)
			return `${count} ${unit}${count === 1 ? "" : "s"} ago`
		}
	}
	return "1 minute ago"
}

export function daysLeft(trashedOn, retentionDays, now = new Date()) {
	const date = parseFrappeDate(trashedOn)
	if (!date) return null
	const elapsed = Math.floor((now - date) / 86400000)
	return Math.max(0, retentionDays - elapsed)
}
