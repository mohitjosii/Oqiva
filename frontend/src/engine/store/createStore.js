// The board's single source of truth. Every change to the document goes through here as an
// operation, so history, autosave and (later) collaboration all see the same stream.
//
// Objects and connectors are plain values that are replaced, never edited in place. That
// keeps rendering cheap (an unchanged item is the same item) and bounds caching safe.

import { reactive, shallowRef } from "vue"
import { isAttached } from "../geometry/connectors"
import { createViewport } from "../geometry/viewport"
import { countObjects } from "../model/schema"
import { History } from "./history"
import { cloneSelection } from "./clone"

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// The patch that turns ``before`` into ``after``: changed fields, and undefined for removed ones.
function wholePatch(before, after) {
	const patch = {}
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (!same(before[key], after[key])) patch[key] = after[key]
	}
	return patch
}
const LISTS = ["objects", "connectors"]

function withPatch(item, patch) {
	const next = { ...item }
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) delete next[key]
		else next[key] = value
	}
	return next
}

export function createStore(document, { readonly = false } = {}) {
	const {
		objects: initialObjects,
		connectors: initialConnectors = [],
		canvas: initialCanvas,
		theme: initialTheme,
		...extra
	} = document
	const data = {
		objects: [...initialObjects].sort((a, b) => a.z - b.z),
		connectors: [...initialConnectors].sort((a, b) => a.z - b.z),
	}
	const index = { objects: new Map(), connectors: new Map() }
	const refs = { objects: shallowRef(data.objects), connectors: shallowRef(data.connectors) }
	for (const list of LISTS) index[list] = new Map(data[list].map((item) => [item.id, item]))
	const canvasRef = shallowRef({ ...initialCanvas })
	const themeRef = shallowRef({ ...initialTheme })
	const history = new History()
	const historyVersion = shallowRef(0)
	const listeners = new Set()
	let transaction = null
	let maxObjects = Infinity

	// UI state that is not part of the document and is never saved.
	const state = reactive({
		tool: "select",
		toolOptions: { sides: 5, tableRows: 3, tableCols: 3 },
		selection: [],
		editingId: null,
		editingCell: null, // {row, col} when the text being edited is a table cell
		tableCell: null, // the cell chosen in a table: {id, row, col}
		viewport: createViewport(),
		size: { width: 0, height: 0 },
		readonly,
		preview: null, // a shape being drawn: {tool, rect}
		connectorPreview: null, // a connector being drawn: {from, to, geometry, arrow}
		marquee: null, // a rectangle being dragged out
		panning: false,
		dragging: false, // something is being moved, resized or drawn
		lastShapeTool: "rectangle",
		lastConnectorTool: "arrow-straight",
		editingNew: false, // the object being edited was just created
		spaceHeld: false,
		hoverId: null, // the object under the pointer, for quick-add arrows
		anchorShapes: [], // ids of objects whose anchors are shown
		snap: null, // the anchor a connector end would attach to: {objectId, anchor}
		guides: [], // alignment guides shown while dragging
		painter: null, // a copied format waiting to be applied
		alignTo: "selection", // what Align lines up with: selection, first, last or canvas
		recentColors: [], // colours picked lately, newest first
		uploads: 0, // pictures being uploaded
		exporting: false, // an export is being made
		comments: [], // the threads on this board, as the server describes them
		canComment: false, // this person may start a comment (even when they may not edit)
		commentsOpen: false, // the comments panel is showing
		commentDraft: null, // a comment about to be written: {anchor_type, shape_id | x, y}
		openThread: null, // the thread being looked at
		cursor: null, // where this person's pointer is on the board: {x, y}
		libraryOpen: false, // the shape library panel is showing
		recentPresets: [], // keys of library shapes placed lately, newest first
		hintFrame: null, // the frame a dragged library shape would land in
		editingSelectAll: false, // the text being edited starts selected, so typing replaces it
		minimap: true, // the overview map is showing
		peers: [], // the other people here: {clientId, id, name, color, cursor, selection}
	})

	const publish = (list) => {
		data[list] = [...data[list]].sort((a, b) => a.z - b.z)
		index[list] = new Map(data[list].map((item) => [item.id, item]))
		refs[list].value = data[list]
	}

	const emit = (event) => listeners.forEach((listener) => listener(event))
	const listOf = (id) => LISTS.find((list) => index[list].has(id)) || null
	const find = (id) => {
		const list = listOf(id)
		return list ? index[list].get(id) : null
	}

	// Applies one operation and returns the operation that reverses it.
	function applyOp(op) {
		const list = op.list || "objects"
		switch (op.t) {
			case "add": {
				for (const item of op.items) {
					if (LISTS.some((name) => index[name].has(item.id)))
						throw new Error(`Object ${item.id} already exists`)
				}
				data[list] = data[list].concat(op.items)
				publish(list)
				return { t: "remove", list, ids: op.items.map((item) => item.id) }
			}
			case "remove": {
				const gone = new Set(op.ids)
				const removed = data[list].filter((item) => gone.has(item.id))
				data[list] = data[list].filter((item) => !gone.has(item.id))
				publish(list)
				return { t: "add", list, items: removed }
			}
			case "update": {
				const inverse = []
				const changes = new Map(op.changes.map((change) => [change.id, change.patch]))
				data[list] = data[list].map((item) => {
					const patch = changes.get(item.id)
					if (!patch) return item
					const previous = {}
					for (const key of Object.keys(patch)) previous[key] = item[key]
					inverse.push({ id: item.id, patch: previous })
					return withPatch(item, patch)
				})
				publish(list)
				return { t: "update", list, changes: inverse }
			}
			case "canvas": {
				const previous = {}
				for (const key of Object.keys(op.patch)) previous[key] = canvasRef.value[key]
				canvasRef.value = withPatch(canvasRef.value, op.patch)
				return { t: "canvas", patch: previous }
			}
			case "theme": {
				const previous = {}
				for (const key of Object.keys(op.patch)) previous[key] = themeRef.value[key]
				themeRef.value = withPatch(themeRef.value, op.patch)
				return { t: "theme", patch: previous }
			}
			default:
				throw new Error(`Unknown operation: ${op.t}`)
		}
	}

	const writable = () => !state.readonly

	function run(op) {
		const inverse = applyOp(op)
		transaction.redo.push(op)
		transaction.undo.push(inverse)
	}

	// Everything done inside ``work`` is one undo step.
	function transact(label, work, options = {}) {
		if (!writable()) return false
		if (transaction) {
			work()
			return true
		}
		transaction = { label, redo: [], undo: [], ...options }
		try {
			work()
		} finally {
			const done = transaction
			transaction = null
			if (done.redo.length) {
				history.push(done)
				historyVersion.value++
				emit({ type: "change", origin: "local", ops: done.redo })
			}
		}
		return true
	}

	const exists = (ids) => ids.filter((id) => listOf(id))

	function restoreSelection(ids) {
		if (ids) state.selection = exists(ids)
	}

	function replay(ops, origin) {
		for (const op of ops) applyOp(op)
		state.selection = exists(state.selection)
		emit({ type: "change", origin, ops })
	}

	const ofList = (ids, list) => ids.filter((id) => index[list].has(id))

	// Changes made by someone else (or restored from this device's cache). They go straight into
	// the document, never into this person's undo history, and are tolerant of what they find:
	// an add of something already here replaces it, and a change to something gone is ignored.
	function applyRemote(ops) {
		const real = []
		for (const op of ops) {
			const list = op.list || "objects"
			if (op.t === "add") {
				const fresh = op.items.filter(
					(item) => !LISTS.some((name) => index[name].has(item.id)),
				)
				const known = op.items.filter((item) => index[list].has(item.id))
				if (known.length) {
					const changes = known.map((item) => ({
						id: item.id,
						patch: wholePatch(index[list].get(item.id), item),
					}))
					real.push({ t: "update", list, changes })
				}
				if (fresh.length) real.push({ t: "add", list, items: fresh })
			} else if (op.t === "remove") {
				const ids = op.ids.filter((id) => index[list].has(id))
				if (ids.length) real.push({ t: "remove", list, ids })
			} else if (op.t === "update") {
				const changes = op.changes.filter(
					(c) => index[list].has(c.id) && Object.keys(c.patch).length,
				)
				if (changes.length) real.push({ t: "update", list, changes })
			} else {
				real.push(op)
			}
		}
		if (!real.length) return false
		for (const op of real) applyOp(op)
		state.selection = exists(state.selection)
		if (state.editingId && !listOf(state.editingId)) state.editingId = null
		emit({ type: "change", origin: "remote", ops: real })
		return true
	}

	// Connectors attached to any of these objects, which must go when the objects do.
	function dependentConnectors(objectIds) {
		const gone = new Set(objectIds)
		return data.connectors
			.filter(
				(c) =>
					(isAttached(c.from) && gone.has(c.from.objectId)) ||
					(isAttached(c.to) && gone.has(c.to.objectId)),
			)
			.map((c) => c.id)
	}

	const countAfterAdding = (extra) => countObjects(store.snapshot()) + extra

	const store = {
		state,
		history,
		objects: refs.objects,
		connectors: refs.connectors,
		canvas: canvasRef,
		theme: themeRef,
		historyVersion,

		get canUndo() {
			void historyVersion.value
			return history.canUndo && writable()
		},
		get canRedo() {
			void historyVersion.value
			return history.canRedo && writable()
		},

		// Reading through the refs makes a component that calls these re-render when items change.
		getObject: (id) => (void refs.objects.value, index.objects.get(id) || null),
		getConnector: (id) => (void refs.connectors.value, index.connectors.get(id) || null),
		getItem: (id) => (void refs.objects.value, void refs.connectors.value, find(id)),
		nextZ: () => (data.objects.length ? data.objects[data.objects.length - 1].z + 1 : 1),
		// Behind everything, where frames sit.
		nextBackZ: () => (data.objects.length ? data.objects[0].z - 1 : 1),
		nextConnectorZ: () =>
			data.connectors.length ? data.connectors[data.connectors.length - 1].z + 1 : 1,

		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},

		snapshot: () => ({
			...extra,
			schemaVersion: document.schemaVersion,
			canvas: canvasRef.value,
			theme: themeRef.value,
			objects: data.objects,
			connectors: data.connectors,
		}),

		setReadonly(value) {
			state.readonly = value
		},

		// --- selection (UI state, not history) ---
		select(ids) {
			state.selection = exists(ids)
		},
		clearSelection() {
			if (state.selection.length) state.selection = []
		},
		toggleSelection(id) {
			state.selection = state.selection.includes(id)
				? state.selection.filter((other) => other !== id)
				: exists([...state.selection, id])
		},
		selectedObjects: () => (
			void refs.objects.value,
			ofList(state.selection, "objects").map((id) => index.objects.get(id))
		),
		selectedConnectors: () => (
			void refs.connectors.value,
			ofList(state.selection, "connectors").map((id) => index.connectors.get(id))
		),

		// --- document changes ---
		transact,
		applyRemote,

		// The most objects a board may hold. Adding past it is refused and announced.
		setLimits(limits) {
			maxObjects = limits.maxObjects ?? Infinity
		},

		// Adds objects and connectors together as one step.
		addItems({ objects = [], connectors = [] }, { label = "Add", select = true } = {}) {
			if (writable() && countAfterAdding(objects.length + connectors.length) > maxObjects) {
				emit({ type: "limit", maxObjects })
				return false
			}
			const before = [...state.selection]
			const added = [...objects, ...connectors].map((item) => item.id)
			const ok = transact(
				label,
				() => {
					if (objects.length) run({ t: "add", list: "objects", items: objects })
					if (connectors.length) run({ t: "add", list: "connectors", items: connectors })
				},
				{ selectUndo: before, selectRedo: select ? added : before },
			)
			if (ok && select) state.selection = added
			return ok
		},

		addObjects: (objects, options) => store.addItems({ objects }, options),
		addConnectors: (connectors, options) => store.addItems({ connectors }, options),

		// Removes objects and connectors. A removed object takes its connectors with it, in the same step.
		removeItems(ids, { label = "Delete" } = {}) {
			const objectIds = ofList(ids, "objects")
			const connectorIds = [
				...new Set([...ofList(ids, "connectors"), ...dependentConnectors(objectIds)]),
			]
			if (!objectIds.length && !connectorIds.length) return false
			const removed = [...objectIds, ...connectorIds]
			const ok = transact(
				label,
				() => {
					if (connectorIds.length)
						run({ t: "remove", list: "connectors", ids: connectorIds })
					if (objectIds.length) run({ t: "remove", list: "objects", ids: objectIds })
				},
				{ selectUndo: removed, selectRedo: [] },
			)
			if (ok) state.selection = state.selection.filter((id) => !removed.includes(id))
			return ok
		},

		removeObjects: (ids, options) => store.removeItems(ofList(ids, "objects"), options),

		updateObjects(changes, { label = "Edit", coalesce } = {}) {
			const real = changes.filter(
				(change) => index.objects.has(change.id) && Object.keys(change.patch).length,
			)
			if (!real.length) return false
			return transact(label, () => run({ t: "update", list: "objects", changes: real }), {
				coalesce,
			})
		},

		updateConnectors(changes, { label = "Edit line", coalesce } = {}) {
			const real = changes.filter(
				(change) => index.connectors.has(change.id) && Object.keys(change.patch).length,
			)
			if (!real.length) return false
			return transact(label, () => run({ t: "update", list: "connectors", changes: real }), {
				coalesce,
			})
		},

		// Changes to objects and connectors together, for example a style applied to a mixed selection.
		updateItems(changes, options = {}) {
			const objects = changes.filter(
				(change) => index.objects.has(change.id) && Object.keys(change.patch).length,
			)
			const connectors = changes.filter(
				(change) => index.connectors.has(change.id) && Object.keys(change.patch).length,
			)
			if (!objects.length && !connectors.length) return false
			return transact(
				options.label || "Edit",
				() => {
					if (objects.length) run({ t: "update", list: "objects", changes: objects })
					if (connectors.length)
						run({ t: "update", list: "connectors", changes: connectors })
				},
				{ coalesce: options.coalesce },
			)
		},

		moveBy(ids, dx, dy, options = {}) {
			const changes = ofList(ids, "objects").map((id) => {
				const object = index.objects.get(id)
				return { id, patch: { x: object.x + dx, y: object.y + dy } }
			})
			// A connector with both ends free moves with the selection; an attached end follows its object.
			const lines = ofList(ids, "connectors")
				.map((id) => index.connectors.get(id))
				.filter((c) => !isAttached(c.from) && !isAttached(c.to))
				.map((c) => ({
					id: c.id,
					patch: {
						from: { x: c.from.x + dx, y: c.from.y + dy },
						to: { x: c.to.x + dx, y: c.to.y + dy },
					},
				}))
			return store.updateItems([...changes, ...lines], { label: "Move", ...options })
		},

		setCanvas(patch, label = "Canvas settings") {
			return transact(label, () => run({ t: "canvas", patch }))
		},

		setTheme(name) {
			return transact("Theme", () => run({ t: "theme", patch: { preset: name } }))
		},

		// Copies of the given items, offset and re-identified (see clone.js).
		cloneItems: (ids, offset = 10) =>
			cloneSelection(data.objects, data.connectors, ids, offset),

		duplicate(ids, offset = 10) {
			if (!writable()) return []
			const copies = store.cloneItems(exists(ids), offset)
			if (!copies.objects.length && !copies.connectors.length) return []
			store.addItems(copies, { label: "Duplicate" })
			return [...copies.objects, ...copies.connectors].map((item) => item.id)
		},

		// A drag, resize or text edit: many live updates that become one undo step.
		beginGesture(ids) {
			const before = new Map(
				exists(ids).map((id) => [id, { list: listOf(id), item: find(id) }]),
			)
			const apply = (changes) => {
				for (const list of LISTS) {
					const part = changes.filter((change) => before.get(change.id)?.list === list)
					if (part.length) applyOp({ t: "update", list, changes: part })
				}
			}
			return {
				set(changes) {
					if (!writable()) return
					const real = changes.filter((change) => before.has(change.id))
					if (!real.length) return
					apply(real)
					emit({ type: "live", origin: "local" })
				},
				commit(label = "Edit") {
					const redo = []
					const undo = []
					for (const [id, { list, item: old }] of before) {
						const now = index[list].get(id)
						if (!now) continue
						const patch = {}
						const previous = {}
						for (const key of new Set([...Object.keys(old), ...Object.keys(now)])) {
							if (!same(old[key], now[key])) {
								patch[key] = now[key]
								previous[key] = old[key]
							}
						}
						if (Object.keys(patch).length) {
							redo.push({ t: "update", list, changes: [{ id, patch }] })
							undo.push({ t: "update", list, changes: [{ id, patch: previous }] })
						}
					}
					if (!redo.length) return false
					history.push({ label, redo, undo })
					historyVersion.value++
					emit({ type: "change", origin: "local", ops: redo })
					return true
				},
				cancel() {
					for (const list of LISTS) {
						const restore = [...before].filter(([, entry]) => entry.list === list)
						if (!restore.length) continue
						const originals = new Map(restore.map(([id, entry]) => [id, entry.item]))
						data[list] = data[list].map((item) => originals.get(item.id) || item)
						publish(list)
					}
					emit({ type: "live", origin: "local" })
				},
			}
		},

		// Takes back the last step as though it never happened: it cannot be redone. Used when a
		// new text box is left empty, so creating and abandoning it leaves no trace.
		discardLastStep() {
			const entry = history.undoStack.pop()
			if (!entry) return false
			replay([...entry.undo].reverse(), "undo")
			historyVersion.value++
			return true
		},

		// --- history ---
		undo() {
			if (!store.canUndo) return false
			const entry = history.takeUndo()
			replay([...entry.undo].reverse(), "undo")
			restoreSelection(entry.selectUndo)
			historyVersion.value++
			return true
		},
		redo() {
			if (!store.canRedo) return false
			const entry = history.takeRedo()
			replay(entry.redo, "redo")
			restoreSelection(entry.selectRedo)
			historyVersion.value++
			return true
		},
	}
	return store
}
