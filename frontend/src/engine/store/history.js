// Undo and redo. An entry is one user action: the operations that redo it, and the ones
// that undo it, both in the order they were applied (undo runs them backwards). Entries
// hold document operations only, never layout or pointer positions.

export const HISTORY_LIMIT = 100
const COALESCE_WINDOW_MS = 800

export class History {
	constructor(limit = HISTORY_LIMIT) {
		this.limit = limit
		this.undoStack = []
		this.redoStack = []
	}

	get canUndo() {
		return this.undoStack.length > 0
	}

	get canRedo() {
		return this.redoStack.length > 0
	}

	// Entries with the same ``coalesce`` key, close together in time, become one step: ten
	// presses of an arrow key move a shape ten pixels and undo in one go.
	push(entry, now = Date.now()) {
		this.redoStack.length = 0
		const last = this.undoStack[this.undoStack.length - 1]
		if (
			entry.coalesce &&
			last &&
			last.coalesce === entry.coalesce &&
			now - last.at <= COALESCE_WINDOW_MS
		) {
			last.redo = last.redo.concat(entry.redo)
			last.undo = last.undo.concat(entry.undo)
			last.at = now
			return
		}
		this.undoStack.push({ ...entry, at: now })
		if (this.undoStack.length > this.limit) this.undoStack.shift()
	}

	takeUndo() {
		const entry = this.undoStack.pop()
		if (entry) this.redoStack.push(entry)
		return entry || null
	}

	takeRedo() {
		const entry = this.redoStack.pop()
		if (entry) this.undoStack.push(entry)
		return entry || null
	}

	clear() {
		this.undoStack.length = 0
		this.redoStack.length = 0
	}
}
