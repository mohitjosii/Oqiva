// Who else is here, and where their pointer and selection are. The state lives in Yjs
// awareness (so it needs no saving and disappears when someone leaves); this keeps this
// browser's own entry up to date and turns everyone else's into a plain list for the screen.

import { ref } from "vue"
import { isColor } from "../model/themes"

export const PEER_COLORS = [
	"#E11D48",
	"#2563EB",
	"#16A34A",
	"#D97706",
	"#7C3AED",
	"#0891B2",
	"#DB2777",
	"#65A30D",
]
export const CURSOR_INTERVAL_MS = 50 // at most 20 pointer updates a second; the relay allows 30

export function colorFor(id) {
	let hash = 0
	for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
	return PEER_COLORS[hash % PEER_COLORS.length]
}

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "")
const finite = (n) => typeof n === "number" && Number.isFinite(n)

// What a peer's awareness entry says, made safe to draw: they chose these values.
export function cleanPeer(clientId, state) {
	const user = state?.user
	if (!user || typeof user !== "object") return null
	const cursor =
		state.cursor && finite(state.cursor.x) && finite(state.cursor.y)
			? { x: state.cursor.x, y: state.cursor.y }
			: null
	return {
		clientId,
		id: text(user.id, 140),
		name: text(user.name, 60) || "Someone",
		image:
			typeof user.image === "string" && user.image.startsWith("/")
				? user.image.slice(0, 300)
				: null,
		color: isColor(user.color) ? user.color : PEER_COLORS[0],
		cursor,
		selection: Array.isArray(state.selection)
			? state.selection.filter((id) => typeof id === "string").slice(0, 200)
			: [],
	}
}

// ``awareness`` is the Yjs awareness of the board's document (the provider shares it with the relay).
export function createPresence({
	user,
	store,
	awareness,
	now = Date.now,
	schedule = setTimeout,
	cancel = clearTimeout,
}) {
	const peers = ref([])
	const me = {
		id: user.id,
		name: user.name,
		image: user.image || null,
		color: user.color || colorFor(user.id),
	}
	awareness.setLocalStateField("user", me)
	awareness.setLocalStateField("cursor", null)
	awareness.setLocalStateField("selection", [])

	function refresh() {
		const list = []
		awareness.getStates().forEach((state, clientId) => {
			if (clientId === awareness.clientID) return
			const peer = cleanPeer(clientId, state)
			if (peer) list.push(peer)
		})
		peers.value = list.sort((a, b) => a.clientId - b.clientId)
		store.state.peers = peers.value
	}
	awareness.on("change", refresh)

	// --- this browser's own entry ---
	let lastSent = -Infinity
	let timer = null
	let pending = null
	function sendCursor() {
		timer = null
		if (!pending) return
		awareness.setLocalStateField("cursor", pending.value)
		lastSent = now()
		pending = null
	}
	const queueCursor = (point) => {
		pending = { value: point }
		if (timer !== null) return
		const wait = Math.max(0, lastSent + CURSOR_INTERVAL_MS - now())
		timer = schedule(sendCursor, wait)
	}

	return {
		peers,
		me,
		awareness,
		// The pointer's place on the board (null when it leaves).
		setCursor: (point) =>
			queueCursor(point ? { x: Math.round(point.x), y: Math.round(point.y) } : null),
		setSelection: (ids) => awareness.setLocalStateField("selection", ids.slice(0, 200)),
		dispose() {
			if (timer !== null) cancel(timer)
			awareness.off("change", refresh)
			awareness.setLocalState(null)
			store.state.peers = []
		},
	}
}
