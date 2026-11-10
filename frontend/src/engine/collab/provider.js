// Carries a board's Yjs document and presence between browsers through the relay in
// realtime/handlers.js (ARCHITECTURE section 9). The relay holds no document and no Yjs: it
// decides who may join and relays what editors send. This is the browser's half of that
// conversation.
//
//   join          ask to enter the board's room; the answer says what we may do there
//   step1         "here is what I have": the state vector, sent to everyone on arrival
//   step2         the reply to one person: just what they were missing
//   update        every later change, to everyone
//   awareness     names, colours, cursors: sent by anyone, even someone who may only look
//
// Only editors send step2 or update. A payload over the relay's limit is not sent at all: the
// caller is told, saves over HTTP, and the server asks everyone to fetch it.

import * as Y from "yjs"
import {
	applyAwarenessUpdate,
	encodeAwarenessUpdate,
	removeAwarenessStates,
} from "y-protocols/awareness"

export const REMOTE = Symbol("oqiva-remote") // changes that arrived from outside
export const MAX_SYNC_BYTES = 900 * 1024 // the relay's limit; socket.io's own is 1 MB

const bytesOf = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data))

// status: connecting | connected | offline | denied
export function createProvider({
	doc,
	awareness,
	socket,
	board,
	maxBytes = MAX_SYNC_BYTES,
	onStatus = () => {},
	onAccess = () => {},
	onSaved = () => {},
	onResync = () => {},
	onComment = () => {},
	onTooLarge = () => {},
}) {
	let status = "connecting"
	let access = null
	let destroyed = false
	const peerClients = new Map() // socket id -> awareness client ids last heard from it
	let hearingFrom = null
	const greeted = new Set() // peers we have already asked for their state since they arrived

	const writable = () => access === "edit"
	function setStatus(next) {
		if (status === next) return
		status = next
		onStatus(status)
	}
	const send = (kind, data, to) =>
		socket.emit("oqiva:sync", { board, kind, data, ...(to ? { to } : {}) })

	// --- joining ---

	function join() {
		if (destroyed) return
		setStatus("connecting")
		greeted.clear()
		socket.emit("oqiva:join", { board }, (reply) => {
			if (destroyed) return
			setAccess(reply?.access ?? null)
			if (!access) return setStatus("denied")
			setStatus("connected")
			send("step1", Y.encodeStateVector(doc))
			const mine = awareness.getLocalState()
			if (mine) sendAwareness([doc.clientID])
		})
	}

	function setAccess(next) {
		if (next === access) return
		access = next
		onAccess(access)
	}

	// --- document ---

	function onSync(message) {
		const { board: where, kind, data, from } = message || {}
		if (where !== board || !data) return
		const bytes = bytesOf(data)
		try {
			if (kind === "step1") {
				if (!writable()) return
				send("step2", Y.encodeStateAsUpdate(doc, bytes), from)
				// Whoever arrives (or comes back) may hold changes we lack, so ask them once as well.
				if (from && !greeted.has(from)) {
					greeted.add(from)
					send("step1", Y.encodeStateVector(doc), from)
				}
			} else if (kind === "step2" || kind === "update") {
				Y.applyUpdate(doc, bytes, REMOTE)
			}
		} catch {
			// A malformed message from a peer is ignored; it must not break the board.
		}
	}

	function onLocalUpdate(update, origin) {
		if (origin === REMOTE || !writable() || status !== "connected") return
		if (update.byteLength > maxBytes) return onTooLarge()
		send("update", update)
	}

	// --- presence ---

	function sendAwareness(clients) {
		if (status !== "connected") return
		socket.emit("oqiva:awareness", { board, data: encodeAwarenessUpdate(awareness, clients) })
	}

	function onLocalAwareness({ added, updated, removed }, origin) {
		if (origin === REMOTE) {
			if (hearingFrom) {
				const known = peerClients.get(hearingFrom) || new Set()
				for (const id of [...added, ...updated]) known.add(id)
				peerClients.set(hearingFrom, known)
			}
			return
		}
		sendAwareness([...added, ...updated, ...removed])
	}

	function onAwareness(message) {
		const { board: where, data, from } = message || {}
		if (where !== board || !data) return
		hearingFrom = from
		try {
			applyAwarenessUpdate(awareness, bytesOf(data), REMOTE)
		} catch {
			// ignore a malformed message
		} finally {
			hearingFrom = null
		}
	}

	function onPeerLeft(message) {
		const { board: where, id } = message || {}
		if (where !== board) return
		greeted.delete(id)
		const clients = peerClients.get(id)
		if (clients) removeAwarenessStates(awareness, [...clients], REMOTE)
		peerClients.delete(id)
	}

	// --- access, saves, resync ---

	function onAccessChanged(rawMessage) {
		const message = rawMessage || {}
		if (message.board && message.board !== board) return
		if ("access" in message) {
			// From the relay itself: it already knows the answer.
			setAccess(message.access ?? null)
			if (!access) setStatus("denied")
			return
		}
		join() // from the server: something changed for this person, so ask again
	}

	const handlers = {
		"oqiva:sync": onSync,
		"oqiva:awareness": onAwareness,
		"oqiva:peer_left": onPeerLeft,
		"oqiva:access_changed": onAccessChanged,
		"oqiva:saved": (message) => message?.board === board && onSaved(message),
		"oqiva:resync": (message) => message?.board === board && onResync(message),
		"oqiva:comment": (message) => message?.board === board && onComment(message),
		connect: join,
		disconnect: () => {
			setStatus("offline")
			greeted.clear()
			for (const clients of peerClients.values())
				removeAwarenessStates(awareness, [...clients], REMOTE)
			peerClients.clear()
		},
	}
	for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler)
	doc.on("update", onLocalUpdate)
	awareness.on("update", onLocalAwareness)
	if (socket.connected) join()

	return {
		get status() {
			return status
		},
		get access() {
			return access
		},
		// Ask to join again (after a change of access the server announced).
		rejoin: join,
		destroy() {
			if (destroyed) return
			destroyed = true
			socket.emit("oqiva:leave", { board })
			for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler)
			doc.off("update", onLocalUpdate)
			awareness.off("update", onLocalAwareness)
			removeAwarenessStates(awareness, [doc.clientID], "destroy")
		},
	}
}
