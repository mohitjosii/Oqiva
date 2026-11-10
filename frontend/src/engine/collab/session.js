// Puts a board's collaboration together: the Yjs document, its bridge to the store, the link to
// the relay, presence, and the copy kept on this device for offline work. The editor creates
// the store from ``prepareCollab`` and then attaches the rest with ``attachCollab``.

import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { IndexeddbPersistence } from "y-indexeddb"
import { createBridge } from "./bridge"
import { createPresence } from "./presence"
import { createProvider, REMOTE } from "./provider"
import { decodeState, encodeState, hasChangesSince, seedUpdate, snapshotFromDoc } from "./ydoc"

// The document the board starts from. The server's collaboration state wins when it has one; a
// board saved before collaboration existed (or whose state is unreadable) is seeded from its
// content, identically in every browser.
export function prepareCollab(host) {
	let doc = new Y.Doc()
	let fromServer = false
	if (host.collab?.state) {
		try {
			Y.applyUpdate(doc, decodeState(host.collab.state), REMOTE)
			fromServer = doc.getMap("canvas").size > 0
		} catch {
			fromServer = false
		}
	}
	if (!fromServer) {
		doc = new Y.Doc()
		Y.applyUpdate(doc, seedUpdate(host.document))
	}
	return { doc, initial: snapshotFromDoc(doc, host.document) }
}

export function attachCollab({
	host,
	store,
	doc,
	autosave,
	notify,
	onAccess,
	onComment,
	readonlyAtStart,
}) {
	const bridge = createBridge(store, doc)
	const awareness = new Awareness(doc)
	const { collab } = host
	const presence = createPresence({ user: collab.user, store, awareness })

	// Merges what the server holds into this document (a save found someone else's work there).
	async function recover() {
		const server = await collab.fetchState()
		if (!server.crdt_state) return null
		Y.applyUpdate(doc, decodeState(server.crdt_state), REMOTE)
		return server.revision
	}

	let provider = null
	if (collab.socket) {
		provider = createProvider({
			doc,
			awareness,
			socket: collab.socket,
			board: collab.board,
			onAccess: (level) => {
				store.setReadonly(level !== "edit" || readonlyAtStart)
				onAccess(level)
			},
			onComment,
			onTooLarge: () => {
				autosave.requestResync()
				autosave.flush()
			},
			onResync: () => {
				recover()
					.then(() => bridge.reconcileAll())
					.catch(() =>
						notify.warning(
							"Could not refresh the board. Reload if it looks out of date.",
						),
					)
			},
		})
	}

	// A copy on this device, so work done offline survives a closed tab and merges on return. What
	// the document held before the copy loaded is the baseline: anything beyond it is work from an
	// earlier session that is still to be saved. (A board nobody has edited saves nothing.)
	let persistence = null
	if (typeof indexedDB !== "undefined" && !readonlyAtStart) {
		const baseline = Y.encodeStateVector(doc)
		try {
			persistence = new IndexeddbPersistence(`oqiva:${collab.user.id}:${collab.board}`, doc)
			persistence.whenSynced.then(() => {
				if (hasChangesSince(doc, baseline)) autosave.markDirty()
			})
		} catch {
			persistence = null // private browsing and the like: no offline copy
		}
	}

	return {
		doc,
		awareness,
		presence,
		provider,
		encode: () => encodeState(doc),
		recover,
		dispose() {
			provider?.destroy()
			presence.dispose()
			bridge.dispose()
			persistence?.destroy()
			doc.destroy()
		},
	}
}
