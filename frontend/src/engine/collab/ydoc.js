// How a board lives inside a Yjs document. Every object and line is its own nested map whose
// keys are the object's top-level fields, so two people changing different fields of one
// object (one moves it, one recolours it) both win, and two changing the same field settle on
// one value. Nested values (style, text, table cells, a line's ends) are replaced whole.

import * as Y from "yjs"
import * as buffer from "lib0/buffer"
import { flattenFlowcharts, nestFlowcharts } from "../modes/flowchart/document"
import { flattenMindmaps, nestMindmaps } from "../modes/mindmap/document"
import { parseDocument, sanitizeCanvas, sanitizeTheme } from "../model/schema"

export const LOCAL = Symbol("oqiva-local") // changes this browser made, on their way out
// Mind maps are three flat lists here, as in the store: the maps, their nodes and their cross-links.
export const LISTS = [
	"objects",
	"connectors",
	"maps",
	"mapnodes",
	"crosslinks",
	"charts",
	"flownodes",
	"flowedges",
]

const clone = (value) => JSON.parse(JSON.stringify(value))
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function itemToYMap(item) {
	const map = new Y.Map()
	for (const key of Object.keys(item).sort())
		if (item[key] !== undefined) map.set(key, clone(item[key]))
	return map
}

// An item filed in the shared document is meant to be a Y.Map. Another person's copy of the app (or
// a damaged document) can put anything there, and reading it must never throw: it reads as empty,
// which every sanitiser then drops.
export function yMapToObject(map) {
	const out = {}
	if (!map || typeof map.forEach !== "function") return out
	map.forEach((value, key) => {
		out[key] = clone(value)
	})
	return out
}

export const writeField = (map, key, value) => {
	if (value === undefined) {
		if (map.has(key)) map.delete(key)
	} else if (!sameJson(map.get(key), value)) {
		map.set(key, clone(value))
	}
}

// The same bytes on every browser for the same content, so two browsers that each open a board
// with no collaboration state yet add up to one copy of it rather than two.
export function seedUpdate(snapshot) {
	const seed = new Y.Doc()
	seed.clientID = 0
	seed.transact(() => {
		const canvas = seed.getMap("canvas")
		for (const key of Object.keys(snapshot.canvas).sort())
			canvas.set(key, clone(snapshot.canvas[key]))
		const theme = seed.getMap("theme")
		for (const key of Object.keys(snapshot.theme).sort())
			theme.set(key, clone(snapshot.theme[key]))
		const flat = flattenMindmaps(snapshot.mindmaps)
		const flow = flattenFlowcharts(snapshot.flowcharts)
		const lists = {
			objects: snapshot.objects,
			connectors: snapshot.connectors,
			maps: flat.maps,
			mapnodes: flat.nodes,
			crosslinks: flat.crosslinks,
			charts: flow.charts,
			flownodes: flow.nodes,
			flowedges: flow.edges,
		}
		for (const list of LISTS) {
			const map = seed.getMap(list)
			for (const item of [...(lists[list] || [])].sort((a, b) => (a.id < b.id ? -1 : 1)))
				map.set(item.id, itemToYMap(item))
		}
	})
	return Y.encodeStateAsUpdate(seed)
}

// The board's content as the engine understands it, sanitised exactly as a loaded document is,
// because whatever a peer (or a stored state) holds is not to be trusted.
export function snapshotFromDoc(doc, base) {
	const raw = {
		...base,
		canvas: yMapToObject(doc.getMap("canvas")),
		theme: yMapToObject(doc.getMap("theme")),
		objects: [...doc.getMap("objects").values()].map(yMapToObject),
		connectors: [...doc.getMap("connectors").values()].map(yMapToObject),
		flowcharts: nestFlowcharts(
			[...doc.getMap("charts").values()].map(yMapToObject),
			[...doc.getMap("flownodes").values()].map(yMapToObject),
			[...doc.getMap("flowedges").values()].map(yMapToObject),
		),
		mindmaps: nestMindmaps(
			[...doc.getMap("maps").values()].map(yMapToObject),
			[...doc.getMap("mapnodes").values()].map(yMapToObject),
			[...doc.getMap("crosslinks").values()].map(yMapToObject),
		),
	}
	return parseDocument(raw).document
}

export const encodeState = (doc) => buffer.toBase64(Y.encodeStateAsUpdate(doc))

export function decodeState(text) {
	return buffer.fromBase64(text)
}

// Does ``doc`` hold changes that were not there when ``baseline`` (a state vector taken earlier)
// was recorded? Used to notice work that came back from this device's offline copy.
export function hasChangesSince(doc, baseline) {
	const parsed = Y.decodeUpdate(Y.encodeStateAsUpdate(doc, baseline))
	return parsed.structs.length > 0 || parsed.ds.clients.size > 0
}

export { sanitizeCanvas, sanitizeTheme }
