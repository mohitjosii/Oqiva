// Keeps the engine's store and a Yjs document saying the same thing.
//
//   store -> doc   every committed step becomes changes to the document
//   doc -> store   changes that did not come from here become remote changes in the store
//
// Changes this browser makes are written inside a transaction marked LOCAL, and the observers
// ignore that mark, so nothing echoes back. Whatever arrives from outside is rebuilt as a whole
// item and sanitised before it reaches the store.

import { sanitizeCanvas, sanitizeConnector, sanitizeObject, sanitizeTheme } from "../model/schema"
import {
	repairChart,
	sanitizeChart,
	sanitizeFlowEdge,
	sanitizeFlowNode,
} from "../modes/flowchart/document"
import {
	repairMap,
	sanitizeCrosslink,
	sanitizeMap,
	sanitizeMapNode,
} from "../modes/mindmap/document"
import { LOCAL, itemToYMap, writeField, yMapToObject } from "./ydoc"

const SETTINGS = { canvas: sanitizeCanvas, theme: sanitizeTheme }

export function createBridge(store, doc) {
	const roots = {
		objects: doc.getMap("objects"),
		connectors: doc.getMap("connectors"),
		maps: doc.getMap("maps"),
		mapnodes: doc.getMap("mapnodes"),
		crosslinks: doc.getMap("crosslinks"),
		charts: doc.getMap("charts"),
		flownodes: doc.getMap("flownodes"),
		flowedges: doc.getMap("flowedges"),
		canvas: doc.getMap("canvas"),
		theme: doc.getMap("theme"),
	}

	// --- store -> doc ---

	function writeOps(ops) {
		doc.transact(() => {
			for (const op of ops) {
				const list = op.list || "objects"
				if (op.t === "add") {
					for (const item of op.items) roots[list].set(item.id, itemToYMap(item))
				} else if (op.t === "remove") {
					for (const id of op.ids) roots[list].delete(id)
				} else if (op.t === "update") {
					for (const { id, patch } of op.changes) {
						const map = roots[list].get(id)
						if (!map) continue // a peer already removed it
						for (const [key, value] of Object.entries(patch))
							writeField(map, key, value)
					}
				} else if (op.t === "canvas" || op.t === "theme") {
					for (const [key, value] of Object.entries(op.patch))
						writeField(roots[op.t], key, value)
				}
			}
		}, LOCAL)
	}

	const unsubscribe = store.subscribe((event) => {
		if (event.type === "change" && event.origin !== "remote") writeOps(event.ops)
	})

	// --- doc -> store ---

	const themeName = () => store.theme.value.preset
	const REFS = {
		objects: () => store.objects.value,
		connectors: () => store.connectors.value,
		maps: () => store.maps.value,
		mapnodes: () => store.mapNodes.value,
		crosslinks: () => store.crosslinks.value,
		charts: () => store.charts.value,
		flownodes: () => store.flowNodes.value,
		flowedges: () => store.flowEdges.value,
	}
	const currentItems = (list) => REFS[list]()

	// The item the document holds for ``id``, sanitised, or null if it is gone or unusable.
	function incoming(list, id) {
		const map = roots[list].get(id)
		if (!map) return null
		const raw = yMapToObject(map)
		if (raw.id !== id) return null // an item must be filed under its own id
		if (list === "objects") return sanitizeObject(raw, 0, themeName())
		if (list === "maps") return sanitizeMap(raw)
		if (list === "mapnodes") return sanitizeMapNode(raw)
		if (list === "crosslinks") return sanitizeCrosslink(raw)
		if (list === "charts") return sanitizeChart(raw)
		if (list === "flownodes") return sanitizeFlowNode(raw)
		if (list === "flowedges") return sanitizeFlowEdge(raw)
		return sanitizeConnector(raw, 0, new Set(store.objects.value.map((o) => o.id)))
	}

	function wholePatch(before, after) {
		const patch = {}
		for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
			if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key]
		}
		return patch
	}

	// The operations that bring the store's copy of ``ids`` in line with the document's.
	function reconcileList(list, ids) {
		const current = new Map(currentItems(list).map((i) => [i.id, i]))
		const removes = []
		const adds = []
		const changes = []
		for (const id of ids) {
			const item = incoming(list, id)
			const have = current.get(id)
			if (!item) {
				if (have) removes.push(id)
			} else if (!have) {
				adds.push(item)
			} else {
				const patch = wholePatch(have, item)
				if (Object.keys(patch).length) changes.push({ id, patch })
			}
		}
		const ops = []
		if (removes.length) ops.push({ t: "remove", list, ids: removes })
		if (adds.length) ops.push({ t: "add", list, items: adds })
		if (changes.length) ops.push({ t: "update", list, changes })
		return ops
	}

	function settingsOps(name) {
		const clean = SETTINGS[name](yMapToObject(roots[name]))
		const have = name === "canvas" ? store.canvas.value : store.theme.value
		const patch = wholePatch(have, clean)
		return Object.keys(patch).length ? [{ t: name, patch }] : []
	}

	// A line whose shape is gone cannot be drawn (someone removed the shape while someone else
	// attached a line to it). Drop it here and in the document, so nobody keeps a line to nothing.
	function dropDanglingLines() {
		const alive = new Set(store.objects.value.map((o) => o.id))
		const ids = store.connectors.value
			.filter(
				(c) =>
					(c.from.objectId && !alive.has(c.from.objectId)) ||
					(c.to.objectId && !alive.has(c.to.objectId)),
			)
			.map((c) => c.id)
		if (!ids.length) return
		store.applyRemote([{ t: "remove", list: "connectors", ids }])
		doc.transact(() => ids.forEach((id) => roots.connectors.delete(id)), LOCAL)
	}

	// A map that two people changed at once can end up broken: a node whose parent the other person
	// deleted, a cross-link to a deleted node, a map with no root. Take out what cannot be drawn,
	// here and in the document, so everyone settles on the same repaired map.
	function dropBrokenMaps() {
		const maps = store.maps.value
		const nodes = store.mapNodes.value
		const links = store.crosslinks.value
		const alive = new Set(maps.map((m) => m.id))
		const goneNodes = new Set(nodes.filter((n) => !alive.has(n.mapId)).map((n) => n.id))
		const goneLinks = new Set(links.filter((l) => !alive.has(l.mapId)).map((l) => l.id))
		const goneMaps = new Set()
		for (const map of maps) {
			const mine = nodes.filter((n) => n.mapId === map.id)
			const repaired = repairMap(
				map,
				mine,
				links.filter((l) => l.mapId === map.id),
			)
			if (!repaired) {
				goneMaps.add(map.id)
				mine.forEach((n) => goneNodes.add(n.id))
				links.filter((l) => l.mapId === map.id).forEach((l) => goneLinks.add(l.id))
				continue
			}
			const keptNodes = new Set(repaired.nodes.map((n) => n.id))
			const keptLinks = new Set(repaired.crosslinks.map((l) => l.id))
			mine.filter((n) => !keptNodes.has(n.id)).forEach((n) => goneNodes.add(n.id))
			links
				.filter((l) => l.mapId === map.id && !keptLinks.has(l.id))
				.forEach((l) => goneLinks.add(l.id))
		}
		const removal = [
			["crosslinks", goneLinks],
			["mapnodes", goneNodes],
			["maps", goneMaps],
		].filter(([, ids]) => ids.size)
		if (!removal.length) return
		store.applyRemote(removal.map(([list, ids]) => ({ t: "remove", list, ids: [...ids] })))
		doc.transact(() => {
			for (const [list, ids] of removal) ids.forEach((id) => roots[list].delete(id))
		}, LOCAL)
	}

	// The same repair for flowcharts: an edge whose node was deleted by someone else goes, and a chart
	// left with nothing goes too.
	function dropBrokenCharts() {
		const charts = store.charts.value
		const nodes = store.flowNodes.value
		const edges = store.flowEdges.value
		const alive = new Set(charts.map((c) => c.id))
		const goneNodes = new Set(nodes.filter((n) => !alive.has(n.chartId)).map((n) => n.id))
		const goneEdges = new Set(edges.filter((e) => !alive.has(e.chartId)).map((e) => e.id))
		const goneCharts = new Set()
		for (const chart of charts) {
			const mine = nodes.filter((n) => n.chartId === chart.id)
			const lines = edges.filter((e) => e.chartId === chart.id)
			const repaired = repairChart(chart, mine, lines)
			if (!repaired) {
				goneCharts.add(chart.id)
				mine.forEach((n) => goneNodes.add(n.id))
				lines.forEach((e) => goneEdges.add(e.id))
				continue
			}
			const keptNodes = new Set(repaired.nodes.map((n) => n.id))
			const keptEdges = new Set(repaired.edges.map((e) => e.id))
			mine.filter((n) => !keptNodes.has(n.id)).forEach((n) => goneNodes.add(n.id))
			lines.filter((e) => !keptEdges.has(e.id)).forEach((e) => goneEdges.add(e.id))
		}
		const removal = [
			["flowedges", goneEdges],
			["flownodes", goneNodes],
			["charts", goneCharts],
		].filter(([, ids]) => ids.size)
		if (!removal.length) return
		store.applyRemote(removal.map(([list, ids]) => ({ t: "remove", list, ids: [...ids] })))
		doc.transact(() => {
			for (const [list, ids] of removal) ids.forEach((id) => roots[list].delete(id))
		}, LOCAL)
	}

	// Changes from outside are gathered over one Yjs transaction, then applied once: objects
	// first, so a line that arrives with its shapes finds them.
	let batch = null
	function apply() {
		const work = batch
		batch = null
		const steps = [
			work.objects.size && (() => reconcileList("objects", work.objects)),
			work.connectors.size && (() => reconcileList("connectors", work.connectors)),
			work.maps.size && (() => reconcileList("maps", work.maps)),
			work.mapnodes.size && (() => reconcileList("mapnodes", work.mapnodes)),
			work.crosslinks.size && (() => reconcileList("crosslinks", work.crosslinks)),
			work.charts.size && (() => reconcileList("charts", work.charts)),
			work.flownodes.size && (() => reconcileList("flownodes", work.flownodes)),
			work.flowedges.size && (() => reconcileList("flowedges", work.flowedges)),
			work.canvas && (() => settingsOps("canvas")),
			work.theme && (() => settingsOps("theme")),
		]
		for (const step of steps) if (step) store.applyRemote(step())
		dropDanglingLines()
		dropBrokenMaps()
		dropBrokenCharts()
	}
	function note(kind, value) {
		if (!batch) {
			batch = {
				objects: new Set(),
				connectors: new Set(),
				maps: new Set(),
				mapnodes: new Set(),
				crosslinks: new Set(),
				charts: new Set(),
				flownodes: new Set(),
				flowedges: new Set(),
				canvas: false,
				theme: false,
			}
			queueMicrotask(apply)
		}
		if (value instanceof Set) value.forEach((id) => batch[kind].add(id))
		else batch[kind] = true
	}

	function changedIds(events, root) {
		const ids = new Set()
		for (const event of events) {
			if (event.target === root) for (const key of event.changes.keys.keys()) ids.add(key)
			else if (event.path.length) ids.add(event.path[0])
		}
		return ids
	}

	const observers = []
	function observe(map, handler) {
		const fn = (events, transaction) => {
			if (transaction.origin !== LOCAL) handler(events)
		}
		map.observeDeep(fn)
		observers.push(() => map.unobserveDeep(fn))
	}
	observe(roots.objects, (events) => note("objects", changedIds(events, roots.objects)))
	observe(roots.connectors, (events) => note("connectors", changedIds(events, roots.connectors)))
	for (const list of ["maps", "mapnodes", "crosslinks", "charts", "flownodes", "flowedges"])
		observe(roots[list], (events) => note(list, changedIds(events, roots[list])))
	observe(roots.canvas, () => note("canvas", true))
	observe(roots.theme, () => note("theme", true))

	return {
		// Brings the store in line with everything the document holds (used after a big merge).
		reconcileAll() {
			batch = null
			store.applyRemote(
				reconcileList(
					"objects",
					new Set([...roots.objects.keys(), ...store.objects.value.map((o) => o.id)]),
				),
			)
			store.applyRemote(
				reconcileList(
					"connectors",
					new Set([
						...roots.connectors.keys(),
						...store.connectors.value.map((c) => c.id),
					]),
				),
			)
			for (const list of [
				"maps",
				"mapnodes",
				"crosslinks",
				"charts",
				"flownodes",
				"flowedges",
			])
				store.applyRemote(
					reconcileList(
						list,
						new Set([...roots[list].keys(), ...currentItems(list).map((i) => i.id)]),
					),
				)
			store.applyRemote(settingsOps("canvas"))
			store.applyRemote(settingsOps("theme"))
			dropDanglingLines()
			dropBrokenMaps()
			dropBrokenCharts()
		},
		dispose() {
			unsubscribe()
			observers.forEach((off) => off())
		},
	}
}
