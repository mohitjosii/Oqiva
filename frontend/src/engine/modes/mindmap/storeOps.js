// Mind map edits as store operations. The pure tree functions say what should change (a change
// set: nodes to add, update and remove); these turn that into store operations, add the
// consequences a tree function does not know about (cross-links on removed nodes go too), and run
// the whole thing as ONE undoable step.

import { createCrosslink, createMap } from "./model"
import * as tree from "./tree"

// The operations for a change set on one map's nodes.
export function opsForChange(store, mapId, change) {
	const ops = []
	const removed = change.remove || []
	if (removed.length) {
		const gone = new Set(removed)
		const links = store
			.crosslinksOfMap(mapId)
			.filter((l) => gone.has(l.from) || gone.has(l.to))
			.map((l) => l.id)
		if (links.length) ops.push({ t: "remove", list: "crosslinks", ids: links })
		ops.push({ t: "remove", list: "mapnodes", ids: removed })
	}
	if (change.update?.length) ops.push({ t: "update", list: "mapnodes", changes: change.update })
	if (change.add?.length) ops.push({ t: "add", list: "mapnodes", items: change.add })
	return ops
}

// Runs a change set from ``tree`` as one step. ``select`` is the node to select afterwards (or a
// function of the change), and ``selectUndo`` the selection to restore on Undo.
export function applyChange(store, mapId, change, { label, select, selectUndo } = {}) {
	if (!change) return false
	const ops = opsForChange(store, mapId, change)
	if (!ops.length) return false
	const after = typeof select === "function" ? select(change) : select
	return store.applyOps(ops, {
		label,
		select: after ? [after] : undefined,
		selectUndo,
	})
}

export const nodesOf = (store, mapId) => store.nodesOfMap(mapId)

// A new map in the middle of ``origin``, with its root selected. Returns the root's id.
export function createNewMap(store, origin, { label = "Add mind map", layout = "both" } = {}) {
	const { map, root } = createMap({ origin, layout })
	const ok = store.applyOps(
		[
			{ t: "add", list: "maps", items: [map] },
			{ t: "add", list: "mapnodes", items: [root] },
		],
		{ label, select: [root.id], selectUndo: [] },
	)
	return ok ? { map, root } : null
}

// A new map built from parsed outline text (see paste.js): ``tree`` is [{text, children}].
export function createMapFromOutline(store, origin, outline, treeToChange) {
	const { map, root } = createMap({ origin })
	let rootNode = root
	let entries = outline
	if (outline.length === 1) {
		// One top entry is the root; its children become the first level.
		rootNode = { ...root, text: outline[0].text }
		entries = outline[0].children
	}
	const change = treeToChange({ mapId: map.id, parentId: root.id, startOrder: 0, tree: entries })
	const ok = store.applyOps(
		[
			{ t: "add", list: "maps", items: [map] },
			{ t: "add", list: "mapnodes", items: [rootNode, ...(change.add || [])] },
		],
		{ label: "Paste as mind map", select: [root.id], selectUndo: [] },
	)
	return ok ? { map, root: rootNode } : null
}

export function addCrosslink(store, mapId, from, to, label = "") {
	if (from === to) return false
	const exists = store
		.crosslinksOfMap(mapId)
		.some((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from))
	if (exists) return false
	const link = createCrosslink({ mapId, from, to, label })
	return store.applyOps([{ t: "add", list: "crosslinks", items: [link] }], {
		label: "Add cross-link",
	})
}

// Deleting a whole map (the root of a board's only map is not deleted by Delete: see commands.js).
export function removeMap(store, mapId, label = "Delete mind map") {
	const nodes = store.nodesOfMap(mapId).map((n) => n.id)
	const links = store.crosslinksOfMap(mapId).map((l) => l.id)
	const ops = []
	if (links.length) ops.push({ t: "remove", list: "crosslinks", ids: links })
	if (nodes.length) ops.push({ t: "remove", list: "mapnodes", ids: nodes })
	ops.push({ t: "remove", list: "maps", ids: [mapId] })
	return store.applyOps(ops, { label, selectUndo: nodes.slice(0, 1) })
}

// Empties a map down to its root (the "clear map" of the only map on a board).
export function clearMap(store, mapId) {
	const map = store.getMap(mapId)
	if (!map) return false
	const change = tree.removeSubtree(store.nodesOfMap(mapId), map.rootId, { allowRoot: true })
	if (!change) return false
	change.remove = change.remove.filter((id) => id !== map.rootId)
	return applyChange(store, mapId, change, { label: "Clear mind map", select: map.rootId })
}
