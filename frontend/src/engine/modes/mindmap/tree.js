// Tree operations. Each one takes every node of ONE map and returns a change set
//   { add: node[], update: [{ id, patch }], remove: string[] }
// or null when the operation is not allowed (or would change nothing). Inputs are never
// mutated, and a change only lists the nodes that really change, so the store can turn it into
// one small undo step. `applyChange` gives the resulting nodes.

import { createNode, NODE_TEXT_LIMIT, NOTE_LIMIT } from "./model"

const HEX = /^#[0-9a-fA-F]{6}$/
const ICON_LIMIT = 40
const key = (parentId) => parentId ?? null
// Two people adding under one node can pick the same order, so ties go by id: both see the same
// order, and the layout is the same on every screen.
const byOrder = (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const change = (parts = {}) => ({ add: [], update: [], remove: [], ...parts })
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

const indexById = (nodes) => new Map(nodes.map((node) => [node.id, node]))

// parentId (null for the root) -> its children, sorted by order. One pass over the nodes.
export function childrenMap(nodes) {
	const map = new Map()
	for (const node of nodes) {
		const k = key(node.parentId)
		if (!map.has(k)) map.set(k, [])
		map.get(k).push(node)
	}
	for (const list of map.values()) list.sort(byOrder)
	return map
}

export const childrenOf = (nodes, parentId) =>
	nodes.filter((node) => key(node.parentId) === key(parentId)).sort(byOrder)

// The node's brothers and sisters, itself included, in order.
export function siblingsOf(nodes, id) {
	const node = nodes.find((n) => n.id === id)
	return node ? childrenOf(nodes, node.parentId) : []
}

// The id, then every descendant (depth first, in sibling order). [] when the id is unknown.
export function subtreeIds(nodes, id) {
	if (!nodes.some((n) => n.id === id)) return []
	const kids = childrenMap(nodes)
	const result = []
	const stack = [id]
	while (stack.length) {
		const current = stack.pop()
		result.push(current)
		const children = kids.get(current) ?? []
		for (let i = children.length - 1; i >= 0; i--) stack.push(children[i].id)
	}
	return result
}

// 0 for the root, 1 for its children, ... and -1 for an unknown id.
export function depthOf(nodes, id) {
	const byId = indexById(nodes)
	if (!byId.has(id)) return -1
	let depth = 0
	let node = byId.get(id)
	while (node.parentId != null && depth <= nodes.length) {
		node = byId.get(node.parentId)
		if (!node) return -1
		depth++
	}
	return depth
}

export const rootOf = (nodes) => nodes.find((node) => node.parentId == null) ?? null

// True when `ancestorId` is strictly above `id`.
export function isAncestor(nodes, ancestorId, id) {
	const byId = indexById(nodes)
	let node = byId.get(id)
	let steps = 0
	while (node && node.parentId != null && steps++ <= nodes.length) {
		if (node.parentId === ancestorId) return true
		node = byId.get(node.parentId)
	}
	return false
}

// Order updates that make an ordered list of nodes 0..n-1, leaving out those already right.
const renumber = (ordered) =>
	ordered.flatMap((node, i) => (node.order !== i ? [{ id: node.id, patch: { order: i } }] : []))

export function addChild(nodes, parentId, text = "") {
	const parent = nodes.find((n) => n.id === parentId)
	if (!parent) return null
	const kids = childrenOf(nodes, parentId)
	const node = createNode({ mapId: parent.mapId, parentId, order: kids.length, text })
	const update = renumber(kids)
	if (parent.collapsed) update.push({ id: parentId, patch: { collapsed: false } })
	return change({ add: [node], update })
}

// A new node directly after `id`. The root has no siblings, so it returns null.
export function addSibling(nodes, id, text = "") {
	const target = nodes.find((n) => n.id === id)
	if (!target || target.parentId == null) return null
	const siblings = childrenOf(nodes, target.parentId)
	const at = siblings.findIndex((n) => n.id === id) + 1
	const node = createNode({ mapId: target.mapId, parentId: target.parentId, order: at, text })
	const after = [...siblings.slice(0, at), node, ...siblings.slice(at)]
	return change({ add: [node], update: renumber(after) }) // the new node is already at `at`
}

export function removeSubtree(nodes, id, { allowRoot = false } = {}) {
	const node = nodes.find((n) => n.id === id)
	if (!node || (node.parentId == null && !allowRoot)) return null
	const remaining = childrenOf(nodes, node.parentId).filter((n) => n.id !== id)
	return change({ remove: subtreeIds(nodes, id), update: renumber(remaining) })
}

// Moves a node (with its subtree) under newParentId. `index` is the node's final position among
// its new siblings (null = last). Moving within the same parent works the same way.
export function reparent(nodes, id, newParentId, index = null) {
	const node = nodes.find((n) => n.id === id)
	if (!node || node.parentId == null) return null
	const parent = nodes.find((n) => n.id === newParentId)
	if (!parent || newParentId === id || isAncestor(nodes, id, newParentId)) return null

	const same = node.parentId === newParentId
	const oldSiblings = childrenOf(nodes, node.parentId)
	const target = same ? oldSiblings.filter((n) => n.id !== id) : childrenOf(nodes, newParentId)
	const at = index == null ? target.length : clamp(Math.trunc(index) || 0, 0, target.length)
	const placed = [...target.slice(0, at), node, ...target.slice(at)]

	const update = []
	placed.forEach((n, i) => {
		const patch = {}
		if (n.id === id && !same) patch.parentId = newParentId
		if (n.order !== i) patch.order = i
		if (Object.keys(patch).length) update.push({ id: n.id, patch })
	})
	if (!same) update.push(...renumber(oldSiblings.filter((n) => n.id !== id)))
	if (!update.length) return null
	if (parent.collapsed) update.push({ id: newParentId, patch: { collapsed: false } })
	return change({ update })
}

export function moveAmongSiblings(nodes, id, delta) {
	const node = nodes.find((n) => n.id === id)
	if (!node || node.parentId == null) return null
	const siblings = childrenOf(nodes, node.parentId)
	const from = siblings.findIndex((n) => n.id === id)
	const to = clamp(from + Math.trunc(delta || 0), 0, siblings.length - 1)
	if (to === from) return null
	return reparent(nodes, id, node.parentId, to)
}

// Becomes a sibling placed right after its former parent. Not allowed at depth 0 or 1.
export function promote(nodes, id) {
	const node = nodes.find((n) => n.id === id)
	const parent = node && nodes.find((n) => n.id === node.parentId)
	if (!parent || parent.parentId == null) return null
	const uncles = childrenOf(nodes, parent.parentId)
	return reparent(nodes, id, parent.parentId, uncles.findIndex((n) => n.id === parent.id) + 1)
}

// Becomes the last child of its previous sibling.
export function demote(nodes, id) {
	const node = nodes.find((n) => n.id === id)
	if (!node || node.parentId == null) return null
	const siblings = childrenOf(nodes, node.parentId)
	const at = siblings.findIndex((n) => n.id === id)
	return at > 0 ? reparent(nodes, id, siblings[at - 1].id, null) : null
}

// Small edits: { update } only. Null when the node is unknown or the value is already set.
function patchNode(nodes, id, patch) {
	const node = nodes.find((n) => n.id === id)
	if (!node) return null
	const changed = Object.keys(patch).some(
		(k) => JSON.stringify(node[k] ?? null) !== JSON.stringify(patch[k] ?? null),
	)
	return changed ? change({ update: [{ id, patch }] }) : null
}

export const cleanColor = (color) => (typeof color === "string" && HEX.test(color) ? color : null)

export function cleanMarker(marker) {
	if (!marker || typeof marker !== "object") return null
	const icon =
		typeof marker.icon === "string" && marker.icon ? marker.icon.slice(0, ICON_LIMIT) : null
	const dot = cleanColor(marker.dot)
	return icon || dot ? { icon, dot } : null
}

export const setText = (nodes, id, text) =>
	patchNode(nodes, id, { text: String(text ?? "").slice(0, NODE_TEXT_LIMIT) })
export const setCollapsed = (nodes, id, collapsed) =>
	patchNode(nodes, id, { collapsed: Boolean(collapsed) })
export const setColor = (nodes, id, color) => patchNode(nodes, id, { color: cleanColor(color) })

export const FONT_SIZE_RANGE = { min: 8, max: 96 }
// A font size in points, or null for the default of the node's level.
export const cleanFontSize = (size) => {
	const n = Math.round(Number(size))
	return Number.isFinite(n) &&
		size !== null &&
		size !== "" &&
		n >= FONT_SIZE_RANGE.min &&
		n <= FONT_SIZE_RANGE.max
		? n
		: null
}
export const setFontSize = (nodes, id, size) =>
	patchNode(nodes, id, { fontSize: cleanFontSize(size) })
// The same size on every node of the map (null puts every node back to its default).
export function setAllFontSize(nodes, size) {
	const want = cleanFontSize(size)
	const update = nodes
		.filter((n) => (n.fontSize ?? null) !== want)
		.map((n) => ({ id: n.id, patch: { fontSize: want } }))
	return update.length ? change({ update }) : null
}
export const setMarker = (nodes, id, marker) =>
	patchNode(nodes, id, { marker: cleanMarker(marker) })
export const setNote = (nodes, id, note) =>
	patchNode(nodes, id, { note: String(note ?? "").slice(0, NOTE_LIMIT) })

// Collapses or expands every node that has children, except the root. Null when nothing changes.
export function setAllCollapsed(nodes, collapsed) {
	const want = Boolean(collapsed)
	const kids = childrenMap(nodes)
	const update = nodes
		.filter((n) => n.parentId != null && kids.has(n.id) && Boolean(n.collapsed) !== want)
		.map((n) => ({ id: n.id, patch: { collapsed: want } }))
	return update.length ? change({ update }) : null
}

// The nodes after a change: removed ones dropped, patches applied, added ones appended.
export function applyChange(nodes, changes) {
	const remove = new Set(changes?.remove ?? [])
	const patches = new Map()
	for (const { id, patch } of changes?.update ?? [])
		patches.set(id, { ...patches.get(id), ...patch })
	const result = []
	for (const node of nodes) {
		if (remove.has(node.id)) continue
		result.push(patches.has(node.id) ? { ...node, ...patches.get(node.id) } : node)
	}
	for (const node of changes?.add ?? []) if (!remove.has(node.id)) result.push(node)
	return result
}

// Orders 0..n-1 among each parent's children. Untouched nodes keep their identity.
export function normalizeOrders(nodes) {
	const fixed = new Map()
	for (const list of childrenMap(nodes).values())
		list.forEach((node, i) => {
			if (node.order !== i) fixed.set(node.id, { ...node, order: i })
		})
	return nodes.map((node) => fixed.get(node.id) ?? node)
}

// Where the arrow keys go. `layout` is the result of layoutMap (boxes carry side and y).
export function navigate(nodes, layout, id, direction) {
	const boxes = layout?.boxes
	const box = boxes?.get(id)
	const node = nodes.find((n) => n.id === id)
	if (!box || !node) return null
	const kids = childrenMap(nodes)
	const children = (kids.get(id) ?? []).filter((n) => boxes.has(n.id))

	if (direction === "left" || direction === "right") {
		if (box.side === "root")
			return children.find((n) => boxes.get(n.id).side === direction)?.id ?? null
		const outward = box.side === "right" ? "right" : "left"
		if (direction === outward) return children[0]?.id ?? null
		return node.parentId
	}
	if (direction !== "up" && direction !== "down") return null
	if (box.side === "root") return null

	const step = direction === "up" ? -1 : 1
	const siblings = (kids.get(key(node.parentId)) ?? []).filter(
		(n) => boxes.has(n.id) && boxes.get(n.id).side === box.side,
	)
	const near = siblings[siblings.findIndex((n) => n.id === id) + step]
	if (near) return near.id

	// No sibling that way: the nearest node at the same depth on the same side.
	const mid = box.y + box.h / 2
	let best = null
	let bestGap = Infinity
	for (const other of nodes) {
		const b = boxes.get(other.id)
		if (!b || other.id === id || b.side !== box.side || b.depth !== box.depth) continue
		const gap = (b.y + b.h / 2 - mid) * step
		if (gap > 0 && gap < bestGap) {
			best = other.id
			bestGap = gap
		}
	}
	return best
}
