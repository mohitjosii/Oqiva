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
	const point = (value) =>
		value && finite(value.x) && finite(value.y) ? { x: value.x, y: value.y } : null
	const cursor = point(state.cursor)
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
		laser: point(state.laser), // someone pointing with the laser (shown, never saved)
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
	awareness.setLocalStateField("laser", null)
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

	// --- this browser's own entry: the pointer and the laser, each sent at most 20 times a second ---
	const lanes = {}
	function lane(field) {
		if (lanes[field]) return lanes[field]
		const state = { lastSent: -Infinity, timer: null, pending: null }
		state.send = () => {
			state.timer = null
			if (!state.pending) return
			awareness.setLocalStateField(field, state.pending.value)
			state.lastSent = now()
			state.pending = null
		}
		state.queue = (value) => {
			state.pending = { value }
			if (state.timer !== null) return
			const wait = Math.max(0, state.lastSent + CURSOR_INTERVAL_MS - now())
			state.timer = schedule(state.send, wait)
		}
		return (lanes[field] = state)
	}
	const rounded = (point) => (point ? { x: Math.round(point.x), y: Math.round(point.y) } : null)

	return {
		peers,
		me,
		awareness,
		// The pointer's place on the board (null when it leaves).
		setCursor: (point) => lane("cursor").queue(rounded(point)),
		// The laser pointer's place (null when it is put away).
		setLaser: (point) => lane("laser").queue(rounded(point)),
		setSelection: (ids) => awareness.setLocalStateField("selection", ids.slice(0, 200)),
		dispose() {
			for (const { timer } of Object.values(lanes)) if (timer !== null) cancel(timer)
			awareness.off("change", refresh)
			awareness.setLocalState(null)
			store.state.peers = []
		},
	}
}
