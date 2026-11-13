// What each named command does to the board.

import { copySelection, cutSelection } from "./clipboard"
import { runMindmapCommand } from "../modes/mindmap/commands"
import { runFlowCommand } from "../modes/flowchart/commands"
import { contentBounds, fitView, zoomIn, zoomOut, zoomTo } from "./view"

export function runCommand(store, controller, command, ui = {}) {
	const { state } = store
	switch (command.name) {
		case "undo":
			return store.undo()
		case "redo":
			return store.redo()
		case "selectAll": {
			const shapes = [
				...store.objects.value.map((object) => object.id),
				...store.connectors.value.map((connector) => connector.id),
			]
			if (shapes.length) return store.select(shapes)
			// a board of only flowcharts or mind maps: select their steps and arrows, or their nodes
			const flow = [...store.flowNodes.value, ...store.flowEdges.value].map((item) => item.id)
			return store.select(flow.length ? flow : store.mapNodes.value.map((node) => node.id))
		}
		case "copy":
			return copySelection(store)
		case "cut":
			return cutSelection(store)
		case "duplicate":
			return store.duplicate(state.selection)
		case "delete":
			return store.removeItems(state.selection)
		case "nudge":
			return store.moveBy(state.selection, command.dx, command.dy, { coalesce: "nudge" })
		case "escape":
			// One press steps back one level: half-done drag, then tool, then selection.
			if (controller.drag) return controller.cancel()
			if (state.painter) return (state.painter = null)
			if (state.tool !== "select") {
				controller.cancel() // the laser, the eraser's tip and a half-drawn stroke go with the tool
				return (state.tool = "select")
			}
			return store.clearSelection()
		case "tool":
			controller.cancel()
			state.tool = command.tool === "connector" ? state.lastConnectorTool : command.tool
			return
		case "zoomIn":
			return zoomIn(store)
		case "zoomOut":
			return zoomOut(store)
		case "zoomReset":
			return zoomTo(store, 1)
		case "fit":
			return fitView(store)
		case "library":
			state.libraryOpen = !state.libraryOpen
			return
		case "shortcuts":
			return ui.toggleShortcuts?.()
		case "print":
			return ui.print?.()
		default:
			// The mind map's own commands (mm.child, mm.sibling, ...). They may ask a question first, so
			// they can finish later.
			if (command.name.startsWith("mm.")) return runMindmapCommand(store, command, ui.mindmap)
			if (command.name.startsWith("fl.")) return runFlowCommand(store, command, ui.flowchart)
			return undefined
	}
}

export const hasContent = (store) => Boolean(contentBounds(store))
