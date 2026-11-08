// Copy, cut and paste inside Oqiva. What is copied is held in memory (so it survives moving
// between boards in one tab) and pasted back with fresh ids, +10 units further each time. A
// connector comes along only when both its ends are copied too (store/clone.js).

import { cloneSelection } from "../store/clone"

const OFFSET = 10
let held = null // {objects, connectors, pastes}

export const hasClipboard = () => Boolean(held)
export const clearClipboard = () => {
	held = null
}

// Copies the selection. Returns false when nothing is selected.
export function copySelection(store) {
	const ids = store.state.selection
	if (!ids.length) return false
	const snapshot = store.cloneItems(ids, 0)
	if (!snapshot.objects.length && !snapshot.connectors.length) return false
	held = { ...snapshot, pastes: 0 }
	return true
}

export function cutSelection(store) {
	if (store.state.readonly || !copySelection(store)) return false
	return store.removeItems(store.state.selection, { label: "Cut" })
}

// Puts a copy on the board, selected. Returns the new ids, or [] when it could not.
export function pasteClipboard(store) {
	if (!held || store.state.readonly) return []
	held.pastes += 1
	const all = [...held.objects, ...held.connectors].map((item) => item.id)
	const copies = cloneSelection(held.objects, held.connectors, all, OFFSET * held.pastes)
	// Pasted things go on top of the board, whatever their old stacking order was.
	let z = store.nextZ()
	copies.objects.sort((a, b) => a.z - b.z).forEach((object) => (object.z = z++))
	let zc = store.nextConnectorZ()
	copies.connectors.sort((a, b) => a.z - b.z).forEach((connector) => (connector.z = zc++))
	if (!store.addItems(copies, { label: "Paste" })) {
		held.pastes -= 1
		return []
	}
	return all.length ? [...copies.objects, ...copies.connectors].map((item) => item.id) : []
}
