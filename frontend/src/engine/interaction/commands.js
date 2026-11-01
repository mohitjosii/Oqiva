// What each named command does to the board.

import { boundsOfObjects } from "../geometry/bounds"
import { fitView, zoomIn, zoomOut, zoomTo } from "./view"

export function runCommand(store, controller, command, ui = {}) {
	const { state } = store
	switch (command.name) {
		case "undo":
			return store.undo()
		case "redo":
			return store.redo()
		case "selectAll":
			return store.select(store.objects.value.map((object) => object.id))
		case "duplicate":
			return store.duplicate(state.selection)
		case "delete":
			return store.removeObjects(state.selection)
		case "nudge":
			return store.moveBy(state.selection, command.dx, command.dy, { coalesce: "nudge" })
		case "escape":
			// One press steps back one level: half-done drag, then tool, then selection.
			if (controller.drag) return controller.cancel()
			if (state.tool !== "select") return (state.tool = "select")
			return store.clearSelection()
		case "tool":
			controller.cancel()
			state.tool = command.tool
			return
		case "zoomIn":
			return zoomIn(store)
		case "zoomOut":
			return zoomOut(store)
		case "zoomReset":
			return zoomTo(store, 1)
		case "fit":
			return fitView(store)
		case "shortcuts":
			return ui.toggleShortcuts?.()
		default:
			return undefined
	}
}

export const hasContent = (store) => Boolean(boundsOfObjects(store.objects.value))
