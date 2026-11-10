// The layout of every mind map on the board, kept up to date as a computed value. A map is laid
// out again only when its own tree, text or origin changes (a signature of those, cheap to build);
// moving a block shape or editing another map costs nothing here.

import { computed } from "vue"
import { layoutMap } from "./layout"

// The engine's text measurer takes a style ({size, ...}); the mind map code asks for a size alone.
export const sized = (measure) => (text, size) => measure(text, { size })

const signature = (map, nodes, fonts, draft) =>
	[
		map.id,
		map.origin.x,
		map.origin.y,
		map.layout,
		fonts,
		draft ? `${draft.id}:${draft.text}` : "",
		...nodes.map(
			(n) =>
				`${n.id}|${n.parentId}|${n.order}|${n.collapsed ? 1 : 0}|${n.marker ? 1 : 0}|${n.fontSize ?? 0}|${n.text}`,
		),
	].join("\u0001")

// ``measure(text, size)`` is the text measurer; ``fonts()`` returns a number that changes when web
// fonts finish loading (widths measured before that used a fallback).
export function createMapLayouts(store, measure, fonts = () => 0) {
	const cache = new Map()
	return computed(() => {
		const maps = store.maps.value
		const all = store.mapNodes.value
		const draft = store.state.nodeDraft
		const byMap = new Map()
		for (const node of all) {
			if (!byMap.has(node.mapId)) byMap.set(node.mapId, [])
			byMap.get(node.mapId).push(node)
		}
		const out = new Map()
		const alive = new Set()
		for (const map of maps) {
			alive.add(map.id)
			let nodes = byMap.get(map.id) || []
			if (draft && nodes.some((n) => n.id === draft.id))
				nodes = nodes.map((n) => (n.id === draft.id ? { ...n, text: draft.text } : n))
			const key = signature(
				map,
				nodes,
				fonts(),
				draft && nodes.some((n) => n.id === draft.id) ? draft : null,
			)
			const hit = cache.get(map.id)
			if (hit && hit.key === key) {
				// The boxes only depend on the tree and the text, so they are reused; the nodes (colour,
				// marker, note) and the map are always the current ones.
				out.set(map.id, { ...hit.layout, map, nodes })
				continue
			}
			const layout = { map, nodes, ...layoutMap(map, nodes, measure) }
			cache.set(map.id, { key, layout })
			out.set(map.id, layout)
		}
		for (const id of cache.keys()) if (!alive.has(id)) cache.delete(id)
		return out
	})
}
