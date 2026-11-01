// The board's single source of truth. Every change to the document goes through here as an
// operation, so history, autosave and (later) collaboration all see the same stream.
//
// Objects are plain values that are replaced, never edited in place. That keeps rendering
// cheap (an unchanged object is the same object) and bounds caching safe.

import { reactive, shallowRef } from "vue"
import { newId } from "../model/ids"
import { countObjects } from "../model/schema"
import { createViewport } from "../geometry/viewport"
import { History } from "./history"

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function withPatch(object, patch) {
	const next = { ...object }
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) delete next[key]
		else next[key] = value
	}
	return next
}

export function createStore(document, { readonly = false } = {}) {
	const {
		objects: initialObjects,
		canvas: initialCanvas,
		theme: initialTheme,
		...extra
	} = document
	let objects = [...initialObjects].sort((a, b) => a.z - b.z)
	let index = new Map(objects.map((object) => [object.id, object]))
	const objectsRef = shallowRef(objects)
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
		toolOptions: { sides: 5 },
		selection: [],
		editingId: null,
		viewport: createViewport(),
		size: { width: 0, height: 0 },
		readonly,
		preview: null, // a shape being drawn: {tool, rect}
		marquee: null, // a rectangle being dragged out
		panning: false,
		lastShapeTool: "rectangle",
		editingNew: false, // the object being edited was just created
		spaceHeld: false,
	})

	const publish = () => {
		objects = [...objects].sort((a, b) => a.z - b.z)
		index = new Map(objects.map((object) => [object.id, object]))
		objectsRef.value = objects
	}

	const emit = (event) => listeners.forEach((listener) => listener(event))

	// Applies one operation and returns the operation that reverses it.
	function applyOp(op) {
		switch (op.t) {
			case "add": {
				for (const object of op.objects) {
					if (index.has(object.id)) throw new Error(`Object ${object.id} already exists`)
				}
				objects = objects.concat(op.objects)
				publish()
				return { t: "remove", ids: op.objects.map((object) => object.id) }
			}
			case "remove": {
				const gone = new Set(op.ids)
				const removed = objects.filter((object) => gone.has(object.id))
				objects = objects.filter((object) => !gone.has(object.id))
				publish()
				return { t: "add", objects: removed }
			}
			case "update": {
				const inverse = []
				const changes = new Map(op.changes.map((change) => [change.id, change.patch]))
				objects = objects.map((object) => {
					const patch = changes.get(object.id)
					if (!patch) return object
					const previous = {}
					for (const key of Object.keys(patch)) previous[key] = object[key]
					inverse.push({ id: object.id, patch: previous })
					return withPatch(object, patch)
				})
				publish()
				return { t: "update", changes: inverse }
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

	const exists = (ids) => ids.filter((id) => index.has(id))

	function restoreSelection(ids) {
		if (ids) state.selection = exists(ids)
	}

	function replay(ops, origin) {
		for (const op of ops) applyOp(op)
		state.selection = exists(state.selection)
		emit({ type: "change", origin, ops })
	}

	const store = {
		state,
		history,
		objects: objectsRef,
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

		// Reading through objectsRef makes a component that calls this re-render when objects change.
		getObject: (id) => (void objectsRef.value, index.get(id) || null),
		nextZ: () => (objects.length ? objects[objects.length - 1].z + 1 : 1),

		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},

		snapshot: () => ({
			...extra,
			schemaVersion: document.schemaVersion,
			canvas: canvasRef.value,
			theme: themeRef.value,
			objects,
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
			void objectsRef.value,
			state.selection.map((id) => index.get(id)).filter(Boolean)
		),

		// --- document changes ---
		transact,

		// The most objects a board may hold. Adding past it is refused and announced.
		setLimits(limits) {
			maxObjects = limits.maxObjects ?? Infinity
		},

		addObjects(newObjects, { label = "Add", select = true } = {}) {
			if (writable() && countObjects(store.snapshot()) + newObjects.length > maxObjects) {
				emit({ type: "limit", maxObjects })
				return false
			}
			const before = [...state.selection]
			const ok = transact(label, () => run({ t: "add", objects: newObjects }), {
				selectUndo: before,
				selectRedo: select ? newObjects.map((object) => object.id) : before,
			})
			if (ok && select) state.selection = newObjects.map((object) => object.id)
			return ok
		},

		removeObjects(ids, { label = "Delete" } = {}) {
			const present = exists(ids)
			if (!present.length) return false
			const ok = transact(label, () => run({ t: "remove", ids: present }), {
				selectUndo: present,
				selectRedo: [],
			})
			if (ok) state.selection = state.selection.filter((id) => !present.includes(id))
			return ok
		},

		updateObjects(changes, { label = "Edit", coalesce } = {}) {
			const real = changes.filter(
				(change) => index.has(change.id) && Object.keys(change.patch).length,
			)
			if (!real.length) return false
			return transact(label, () => run({ t: "update", changes: real }), { coalesce })
		},

		moveBy(ids, dx, dy, options = {}) {
			const changes = exists(ids).map((id) => {
				const object = index.get(id)
				return { id, patch: { x: object.x + dx, y: object.y + dy } }
			})
			return store.updateObjects(changes, { label: "Move", ...options })
		},

		setCanvas(patch, label = "Canvas settings") {
			return transact(label, () => run({ t: "canvas", patch }))
		},

		setTheme(name) {
			return transact("Theme", () => run({ t: "theme", patch: { preset: name } }))
		},

		duplicate(ids, offset = 10) {
			const sources = exists(ids).map((id) => index.get(id))
			if (!sources.length || !writable()) return []
			let z = store.nextZ()
			const copies = sources.map((object) => ({
				...JSON.parse(JSON.stringify(object)),
				id: newId(),
				x: object.x + offset,
				y: object.y + offset,
				z: z++,
			}))
			store.addObjects(copies, { label: "Duplicate" })
			return copies.map((copy) => copy.id)
		},

		// A drag, resize or text edit: many live updates that become one undo step.
		beginGesture(ids) {
			const before = new Map(exists(ids).map((id) => [id, index.get(id)]))
			return {
				set(changes) {
					if (!writable()) return
					const real = changes.filter((change) => before.has(change.id))
					if (!real.length) return
					applyOp({ t: "update", changes: real })
					emit({ type: "live", origin: "local" })
				},
				commit(label = "Edit") {
					const redo = []
					const undo = []
					for (const [id, old] of before) {
						const now = index.get(id)
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
							redo.push({ id, patch })
							undo.push({ id, patch: previous })
						}
					}
					if (!redo.length) return false
					const ops = [{ t: "update", changes: redo }]
					history.push({ label, redo: ops, undo: [{ t: "update", changes: undo }] })
					historyVersion.value++
					emit({ type: "change", origin: "local", ops })
					return true
				},
				cancel() {
					const restore = [...before].map(([id, old]) => ({ id, patch: old }))
					const current = restore.filter(({ id }) => index.has(id))
					if (!current.length) return
					objects = objects.map((object) => before.get(object.id) || object)
					publish()
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
