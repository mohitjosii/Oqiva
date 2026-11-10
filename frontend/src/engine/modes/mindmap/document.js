// How mind maps are stored and read back. A document holds ``mindmaps`` as nested records (one
// per map, with its nodes and cross-links), which is what is saved and shared. The store keeps
// the same content as three flat lists (maps, nodes, cross-links), so each node is its own
// item for history and for merging with other people. These functions convert both ways and
// clean whatever comes in: documents come from other people and older versions, so nothing is
// trusted, and a map that cannot be a proper tree is repaired or dropped rather than drawn.

import { ID_PATTERN } from "../../model/ids"
import { isColor } from "../../model/themes"

export const MAP_LIMITS = {
	maps: 50,
	nodesPerMap: 2000,
	text: 500,
	note: 2000,
	label: 100,
	crosslinksPerMap: 500,
	coordinate: 1_000_000,
}
export const LAYOUTS = new Set(["both", "right"])

const finite = (v) => typeof v === "number" && Number.isFinite(v)
const clamp = (v, low, high) => Math.min(high, Math.max(low, v))
const validId = (id) => typeof id === "string" && ID_PATTERN.test(id)
const color = (value) => (isColor(value) && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null)
const cut = (value, limit) => (typeof value === "string" ? value.slice(0, limit) : "")

export function sanitizeMarker(raw) {
	if (!raw || typeof raw !== "object") return null
	const icon =
		typeof raw.icon === "string" && /^[a-z0-9-]{1,40}$/.test(raw.icon) ? raw.icon : null
	const dot = color(raw.dot)
	return icon || dot ? { icon, dot } : null
}

// ----- flat records, as the store and the Yjs document hold them -----

export function sanitizeMap(raw) {
	if (!raw || typeof raw !== "object" || !validId(raw.id) || !validId(raw.rootId)) return null
	const origin = raw.origin && typeof raw.origin === "object" ? raw.origin : {}
	return {
		id: raw.id,
		origin: {
			x: finite(origin.x)
				? clamp(origin.x, -MAP_LIMITS.coordinate, MAP_LIMITS.coordinate)
				: 0,
			y: finite(origin.y)
				? clamp(origin.y, -MAP_LIMITS.coordinate, MAP_LIMITS.coordinate)
				: 0,
		},
		rootId: raw.rootId,
		layout: LAYOUTS.has(raw.layout) ? raw.layout : "both",
	}
}

export function sanitizeMapNode(raw) {
	if (!raw || typeof raw !== "object" || !validId(raw.id) || !validId(raw.mapId)) return null
	let parentId = null
	if (raw.parentId !== null && raw.parentId !== undefined) {
		if (!validId(raw.parentId) || raw.parentId === raw.id) return null
		parentId = raw.parentId
	}
	return {
		id: raw.id,
		mapId: raw.mapId,
		parentId,
		order: finite(raw.order) ? clamp(Math.round(raw.order), 0, 1_000_000) : 0,
		text: cut(raw.text, MAP_LIMITS.text),
		collapsed: raw.collapsed === true,
		color: color(raw.color),
		fontSize:
			finite(raw.fontSize) && raw.fontSize >= 8 && raw.fontSize <= 96
				? Math.round(raw.fontSize)
				: null,
		marker: sanitizeMarker(raw.marker),
		note: cut(raw.note, MAP_LIMITS.note),
	}
}

export function sanitizeCrosslink(raw) {
	if (!raw || typeof raw !== "object" || !validId(raw.id) || !validId(raw.mapId)) return null
	if (!validId(raw.from) || !validId(raw.to) || raw.from === raw.to) return null
	return {
		id: raw.id,
		mapId: raw.mapId,
		from: raw.from,
		to: raw.to,
		label: cut(raw.label, MAP_LIMITS.label),
	}
}

// ----- nested <-> flat -----

export function flattenMindmaps(mindmaps) {
	const maps = []
	const nodes = []
	const crosslinks = []
	for (const map of mindmaps || []) {
		maps.push({ id: map.id, origin: map.origin, rootId: map.rootId, layout: map.layout })
		for (const node of map.nodes || []) nodes.push({ ...node, mapId: map.id })
		for (const link of map.crosslinks || []) crosslinks.push({ ...link, mapId: map.id })
	}
	return { maps, nodes, crosslinks }
}

const byOrder = (a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)

export function nestMindmaps(maps, nodes, crosslinks) {
	const nodesByMap = new Map()
	for (const node of nodes) {
		if (!nodesByMap.has(node.mapId)) nodesByMap.set(node.mapId, [])
		nodesByMap.get(node.mapId).push(node)
	}
	const linksByMap = new Map()
	for (const link of crosslinks) {
		if (!linksByMap.has(link.mapId)) linksByMap.set(link.mapId, [])
		linksByMap.get(link.mapId).push(link)
	}
	return maps.map((map) => ({
		id: map.id,
		origin: map.origin,
		rootId: map.rootId,
		layout: map.layout,
		nodes: [...(nodesByMap.get(map.id) || [])].sort(byOrder).map(({ mapId, ...rest }) => rest),
		crosslinks: (linksByMap.get(map.id) || []).map(({ mapId, ...rest }) => rest),
	}))
}

// ----- whole-structure repair -----

// Makes one map a proper tree: one root, every node reachable from it, no cycles, sibling orders
// 0..n-1. Returns the cleaned flat records, or null when the map cannot be saved (no root).
export function repairMap(map, nodes, crosslinks, taken = new Set()) {
	const byId = new Map()
	for (const node of nodes) {
		if (node.mapId !== map.id || byId.has(node.id) || taken.has(node.id)) continue
		byId.set(node.id, node)
	}
	const root = byId.get(map.rootId)
	if (!root || root.parentId !== null) return null
	const children = new Map()
	for (const node of byId.values()) {
		if (node.id === root.id) continue
		if (node.parentId === null || !byId.has(node.parentId)) continue // an orphan
		if (!children.has(node.parentId)) children.set(node.parentId, [])
		children.get(node.parentId).push(node)
	}
	// Walk down from the root: anything not reached (an orphan, or part of a cycle) is dropped.
	const kept = [{ ...root }]
	const seen = new Set([root.id])
	const stack = [root.id]
	while (stack.length && kept.length < MAP_LIMITS.nodesPerMap) {
		const id = stack.pop()
		const list = (children.get(id) || []).filter((n) => !seen.has(n.id)).sort(byOrder)
		list.forEach((node, order) => {
			if (kept.length >= MAP_LIMITS.nodesPerMap) return
			seen.add(node.id)
			kept.push({ ...node, order })
			stack.push(node.id)
		})
	}
	const links = []
	const linkIds = new Set()
	for (const link of crosslinks) {
		if (link.mapId !== map.id || linkIds.has(link.id) || taken.has(link.id)) continue
		if (!seen.has(link.from) || !seen.has(link.to)) continue
		linkIds.add(link.id)
		links.push(link)
		if (links.length >= MAP_LIMITS.crosslinksPerMap) break
	}
	return { map, nodes: kept, crosslinks: links }
}

// A raw ``mindmaps`` value from a document, cleaned: the nested records to keep, and what was
// dropped. ``taken`` holds ids already used by objects and lines, which a map may not reuse.
export function sanitizeMindmaps(raw, taken = new Set()) {
	const issues = []
	const out = []
	const used = new Set(taken)
	for (const entry of Array.isArray(raw) ? raw : []) {
		if (out.length >= MAP_LIMITS.maps) {
			issues.push("dropped a mind map over the limit")
			break
		}
		const map = sanitizeMap(entry)
		if (!map || used.has(map.id)) {
			issues.push("dropped a mind map")
			continue
		}
		const nodes = (Array.isArray(entry.nodes) ? entry.nodes : [])
			.slice(0, MAP_LIMITS.nodesPerMap * 2)
			.map((n) => sanitizeMapNode({ ...n, mapId: map.id }))
			.filter(Boolean)
		const links = (Array.isArray(entry.crosslinks) ? entry.crosslinks : [])
			.slice(0, MAP_LIMITS.crosslinksPerMap * 2)
			.map((l) => sanitizeCrosslink({ ...l, mapId: map.id }))
			.filter(Boolean)
		const repaired = repairMap(map, nodes, links, new Set([...used]))
		if (!repaired) {
			issues.push(`dropped mind map ${map.id}: no root`)
			continue
		}
		if (repaired.nodes.length < nodes.length) issues.push(`repaired mind map ${map.id}`)
		used.add(map.id)
		for (const n of repaired.nodes) used.add(n.id)
		for (const l of repaired.crosslinks) used.add(l.id)
		out.push(...nestMindmaps([repaired.map], repaired.nodes, repaired.crosslinks))
	}
	return { mindmaps: out, issues }
}
