// Mind map records, as the store holds them. They are flat: a map, its nodes (each pointing at
// its parent) and cross-links between two nodes. Positions are never stored; the layout works
// them out from the tree (L10).

import { newId } from "../../model/ids"

export const NODE_TEXT_LIMIT = 500
export const NOTE_LIMIT = 2000
export const LABEL_LIMIT = 100
export const ROOT_TEXT = "Central idea"
export const LAYOUTS = ["both", "right"]

// A new node with every field filled in. `id` is only for callers (and tests) that need one.
export function createNode({ mapId, parentId = null, order = 0, text = "", id } = {}) {
	return {
		id: id ?? newId(),
		mapId,
		parentId,
		order,
		text: String(text ?? "").slice(0, NODE_TEXT_LIMIT),
		collapsed: false,
		color: null,
		fontSize: null, // null = the default for its level
		marker: null,
		note: "",
	}
}

// A new map and its root node. `origin` is the board position of the root's centre.
export function createMap({ origin, layout = "both", id } = {}) {
	const mapId = id ?? newId()
	const root = createNode({ mapId, parentId: null, order: 0, text: ROOT_TEXT })
	const map = {
		id: mapId,
		origin: { x: origin?.x ?? 0, y: origin?.y ?? 0 },
		rootId: root.id,
		layout: LAYOUTS.includes(layout) ? layout : "both",
	}
	return { map, root }
}

export function createCrosslink({ mapId, from, to, label = "", id } = {}) {
	return { id: id ?? newId(), mapId, from, to, label: String(label ?? "").slice(0, LABEL_LIMIT) }
}
