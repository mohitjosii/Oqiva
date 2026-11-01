// Realtime relay for Oqiva boards.
//
// Frappe's socket server loads this file for every site that has Oqiva installed
// (apps/frappe/realtime/index.js, get_app_handlers). It keeps no document state: it
// decides who may join a board room, and relays Yjs sync and awareness messages
// between the people in it. Saving stays on the HTTP API (ARCHITECTURE section 9).
//
// Who may do what in a room:
//   view / comment   receive everything, send awareness, ask for state (step1)
//   edit             also send state and updates (step2, update)
// Access is decided by oqiva.api.realtime.authorize and re-checked for writes once a
// socket's last check is older than OQIVA_REAUTH_MS, so a revoked editor is cut off
// within that window even if their browser ignores the notice.

const REAUTH_MS = Number(process.env.OQIVA_REAUTH_MS || 15000)
const MAX_SYNC_BYTES = 900 * 1024 // stays under socket.io's 1 MB default buffer
const MAX_AWARENESS_BYTES = 8 * 1024
const MAX_AWARENESS_PER_SECOND = 30
const BOARD_NAME = /^[A-Za-z0-9_-]{1,140}$/
const SYNC_KINDS = new Set(["step1", "step2", "update"])
const WRITE_KINDS = new Set(["step2", "update"])

const roomOf = (board) => `oqiva:board:${board}`
const sizeOf = (data) => data?.byteLength ?? data?.length ?? 0

async function authorize(socket, board) {
	try {
		const response = await socket.frappe_request("/api/method/oqiva.api.realtime.authorize", { board })
		if (!response.ok) return null
		const { message } = await response.json()
		return message?.access || null
	} catch {
		return null
	}
}

function oqivaHandlers(socket) {
	// board name -> { access, checkedAt, pending }
	const joined = new Map()
	let awarenessWindow = { start: 0, count: 0 }

	async function drop(board, state, access) {
		joined.delete(board)
		await socket.leave(roomOf(board))
		socket.to(roomOf(board)).emit("oqiva:peer_left", { board, id: socket.id })
		socket.emit("oqiva:access_changed", { board, access })
	}

	// Re-checks access when the last check is stale. Concurrent calls share one request.
	async function refresh(board, state) {
		if (Date.now() - state.checkedAt <= REAUTH_MS) return state.access
		state.pending ||= authorize(socket, board).finally(() => (state.pending = null))
		const access = await state.pending
		state.checkedAt = Date.now()
		if (access !== state.access) {
			if (!access) await drop(board, state, null)
			else {
				state.access = access
				socket.emit("oqiva:access_changed", { board, access })
			}
		}
		return access
	}

	socket.on("oqiva:join", async (payload, ack) => {
		const reply = typeof ack === "function" ? ack : () => {}
		const board = payload?.board
		if (typeof board !== "string" || !BOARD_NAME.test(board)) return reply({ access: null })
		const access = await authorize(socket, board)
		if (!access) {
			if (joined.has(board)) await drop(board, joined.get(board), null)
			return reply({ access: null })
		}
		joined.set(board, { access, checkedAt: Date.now(), pending: null })
		await socket.join(roomOf(board))
		const members = await socket.nsp.in(roomOf(board)).fetchSockets()
		reply({ access, id: socket.id, peers: members.filter((s) => s.id !== socket.id).map((s) => s.id) })
	})

	socket.on("oqiva:leave", async (payload) => {
		const board = payload?.board
		const state = joined.get(board)
		if (state) await drop(board, state, null)
	})

	socket.on("oqiva:sync", async (message) => {
		const { board, kind, data, to } = message || {}
		const state = joined.get(board)
		if (!state || !SYNC_KINDS.has(kind) || !data || sizeOf(data) > MAX_SYNC_BYTES) return
		const access = await refresh(board, state)
		if (WRITE_KINDS.has(kind) && access !== "edit") return
		if (!access) return
		const out = { board, kind, data, from: socket.id }
		if (typeof to === "string") {
			if (!socket.nsp.adapter.rooms.get(roomOf(board))?.has(to)) return
			socket.nsp.to(to).emit("oqiva:sync", out)
		} else {
			socket.to(roomOf(board)).emit("oqiva:sync", out)
		}
	})

	socket.on("oqiva:awareness", (message) => {
		const { board, data } = message || {}
		if (!joined.has(board) || !data || sizeOf(data) > MAX_AWARENESS_BYTES) return
		const now = Date.now()
		if (now - awarenessWindow.start >= 1000) awarenessWindow = { start: now, count: 0 }
		if (++awarenessWindow.count > MAX_AWARENESS_PER_SECOND) return
		socket.to(roomOf(board)).emit("oqiva:awareness", { board, data, from: socket.id })
	})

	socket.on("disconnecting", () => {
		for (const board of joined.keys()) {
			socket.to(roomOf(board)).emit("oqiva:peer_left", { board, id: socket.id })
		}
	})
}

module.exports = oqivaHandlers
module.exports.limits = { REAUTH_MS, MAX_SYNC_BYTES, MAX_AWARENESS_BYTES, MAX_AWARENESS_PER_SECOND }
