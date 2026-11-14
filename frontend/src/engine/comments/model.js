// What the comment pins and threads need to know, kept free of the screen and the server.

import { objectBounds } from "../geometry/bounds"

export const MENTION = /@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g

// Where a thread's pin goes on the board: the top-right corner of its shape, or its point.
// A thread whose shape has been removed has no place (null) and shows only in the list.
export function pinPosition(thread, objectsById) {
	if (thread.anchor_type === "shape") {
		const object = objectsById.get(thread.shape_id)
		if (!object) return null
		const box = objectBounds(object)
		return { x: box.x + box.w, y: box.y }
	}
	return Number.isFinite(thread.x) && Number.isFinite(thread.y)
		? { x: thread.x, y: thread.y }
		: null
}

// Where a comment about to be written will go (the same rule, for a draft).
export const draftPosition = (draft, objectsById) => pinPosition(draft, objectsById)

// The text of a comment split into plain pieces and @mentions, so a mention can be shown
// in bold without ever treating the text as markup.
export function mentionParts(content) {
	const parts = []
	let last = 0
	for (const match of String(content).matchAll(MENTION)) {
		if (match.index > last)
			parts.push({ text: content.slice(last, match.index), mention: false })
		parts.push({ text: match[0], mention: true })
		last = match.index + match[0].length
	}
	if (last < content.length) parts.push({ text: content.slice(last), mention: false })
	return parts
}

export const threadCounts = (threads) => ({
	open: threads.filter((t) => !t.resolved).length,
	resolved: threads.filter((t) => t.resolved).length,
})

export const visibleThreads = (threads, filter) =>
	threads.filter((t) => (filter === "resolved" ? t.resolved : !t.resolved))

// The word being typed after an @ at the end of ``text`` (null if the cursor is not in one).
export function mentionQuery(text) {
	const match = /(?:^|\s)@([^\s@]*)$/.exec(text)
	return match ? match[1] : null
}

// People whose name or address starts with what was typed, for the suggestion list.
export function suggestPeople(people, query, limit = 6) {
	const q = query.toLowerCase()
	return people
		.filter(
			(p) =>
				p.email?.toLowerCase().startsWith(q) ||
				p.full_name
					.toLowerCase()
					.split(/\s+/)
					.some((w) => w.startsWith(q)) ||
				!q,
		)
		.slice(0, limit)
}

// Where the suggestion list goes: fixed on screen, below the box when there is room and above it
// when there is not, never off the screen. The comment box sits in a scrolling panel, so a list
// drawn inside it would be cut off by the panel's edge. ``anchor`` is the box's rectangle,
// ``viewport`` is {width, height}, ``rows`` is how many people are listed.
export const SUGGESTION_ROW = 46
export function placeSuggestions(anchor, viewport, rows, { gap = 4, margin = 8 } = {}) {
	const wanted = rows * SUGGESTION_ROW + 2
	const below = viewport.height - anchor.bottom - margin - gap
	const above = anchor.top - margin - gap
	const openBelow = below >= Math.min(wanted, 220) || below >= above
	const room = Math.max(SUGGESTION_ROW, openBelow ? below : above)
	const height = Math.min(wanted, room)
	const width = Math.min(anchor.width, viewport.width - margin * 2)
	const left = Math.min(Math.max(anchor.left, margin), viewport.width - width - margin)
	const top = openBelow ? anchor.bottom + gap : anchor.top - gap - height
	return { top, left, width, maxHeight: room, below: openBelow }
}

export const insertMention = (text, person) => text.replace(/@[^\s@]*$/, `@${person.email} `)

export function timeAgo(value, now = Date.now()) {
	const then = new Date(String(value).replace(" ", "T")).getTime()
	if (!Number.isFinite(then)) return ""
	const seconds = Math.max(0, Math.round((now - then) / 1000))
	if (seconds < 60) return "just now"
	if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
	return `${Math.floor(seconds / 86400)} d ago`
}
