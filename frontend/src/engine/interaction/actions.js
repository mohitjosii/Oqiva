// What the palette's tiles do. Each action works out its changes with the pure functions in
// store/arrange.js (or builds a style patch) and applies them as one undo step.

import { objectBounds, unionBounds } from "../geometry/bounds"
import { visibleRect } from "../geometry/viewport"
import { pageSize } from "../model/schema"
import { newId } from "../model/ids"
import { autoHeight } from "../text/fit"
import {
	alignChanges,
	distributeChanges,
	flipChanges,
	groupChanges,
	removeGapsChanges,
	reorderChanges,
	rotateChanges,
	sameSizeChanges,
	swapChanges,
	ungroupChanges,
} from "../store/arrange"
import {
	cellAfter,
	growRow,
	insertColumn,
	insertRow,
	removeColumn,
	removeRow,
	setCellFill,
	setCellText,
	withTable,
} from "../store/tableOps"
import { emptyText } from "../model/factories"
import { CONNECTOR_TOOLS, connectorToolById } from "../model/connectorTools"
import { SHAPE_TOOLS } from "../model/shapes"
import { capabilitiesOf, pushRecent } from "./palette"
import { activeCell } from "./tables"

// The rectangle that Align lines things up with.
export function alignReference(store, objects, to) {
	if (to === "first" && objects.length > 1) return objectBounds(objects[0])
	if (to === "last" && objects.length > 1) return objectBounds(objects.at(-1))
	if (to === "canvas" || objects.length === 1) {
		const canvas = store.canvas.value
		if (canvas.mode === "preset") {
			const { width, height } = pageSize(canvas)
			return { x: 0, y: 0, w: width, h: height }
		}
		return visibleRect(store.state.viewport, store.state.size)
	}
	return unionBounds(objects.map(objectBounds))
}

// The selected objects in the order they were picked.
function picked(store) {
	return store.state.selection.map((id) => store.getObject(id)).filter(Boolean)
}

export function runAction(store, action, { measure } = {}) {
	if (store.state.readonly) return false
	const objects = picked(store)
	const connectors = store.selectedConnectors()
	const apply = (changes, label) =>
		changes.length ? store.updateItems(changes, { label }) : false
	switch (action.name) {
		case "arrange":
			return arrange(store, action.mode, objects, connectors)
		case "group":
			return apply(groupChanges(objects, newId()), "Group")
		case "ungroup":
			return apply(ungroupChanges(objects), "Ungroup")
		case "align":
			return apply(
				alignChanges(
					objects,
					action.mode,
					alignReference(store, objects, store.state.alignTo),
				),
				"Align",
			)
		case "distribute":
			return apply(distributeChanges(objects, action.axis), "Distribute")
		case "removeGaps":
			return apply(removeGapsChanges(objects, action.axis), "Remove gaps")
		case "sameSize": {
			const reference = store.state.alignTo === "last" ? objects.at(-1) : objects[0]
			return apply(
				fitText(sameSizeChanges(objects, reference, action.dimension), objects, measure),
				"Same size",
			)
		}
		case "swap":
			return objects.length === 2 && apply(swapChanges(objects[0], objects[1]), "Swap")
		case "rotate":
			return apply(rotateChanges(objects, action.degrees), "Rotate")
		case "flip":
			return apply(
				flipChanges(
					objects.filter((object) => object.kind !== "table"),
					action.axis,
				),
				"Flip",
			)
		case "table":
			return tableAction(store, action, measure)
		case "shape":
			return apply(
				fitText(shapeTypeChanges(store, objects, action), objects, measure),
				"Change shape",
			)
		case "sides":
			return apply(sidesChanges(objects, action.value), "Change sides")
		case "comment":
			return startComment(store, objects)
		case "style":
			return applyStyle(store, [...objects, ...connectors], action, measure)
		case "painter":
			return startPainter(store, objects, connectors)
		default:
			return false
	}
}

function arrange(store, mode, objects, connectors) {
	const changes = [
		...reorderChanges(
			store.objects.value,
			objects.map((o) => o.id),
			mode,
		),
		...reorderChanges(
			store.connectors.value,
			connectors.map((c) => c.id),
			mode,
		),
	]
	return changes.length ? store.updateItems(changes, { label: "Arrange" }) : false
}

// A shape that is made smaller never drops below its text.
function fitText(changes, objects, measure) {
	if (!measure) return changes
	const byId = new Map(objects.map((o) => [o.id, o]))
	return changes.map((change) => {
		const object = { ...byId.get(change.id), ...change.patch }
		if (object.kind !== "shape") return change
		const needed = autoHeight(object, measure)
		if (!needed || needed <= object.h) return change
		return {
			id: change.id,
			patch: { ...change.patch, h: needed, y: object.y - (needed - object.h) / 2 },
		}
	})
}

// --- style ---

const withRuns = (text, edit) => ({
	...text,
	paragraphs: text.paragraphs.map((p) => ({ ...p, runs: p.runs.map(edit) })),
})
const without = (run, key) => {
	const next = { ...run }
	delete next[key]
	return next
}

// The patch one item needs for a style action, or null if the item does not take it.
export function stylePatch(item, action) {
	const caps = capabilitiesOf(item)
	const need = {
		fill: "fill",
		stroke: "border",
		strokeWidth: "border",
		dash: "border",
		opacity: "opacity",
		radius: "radius",
	}
	if (action.target in need) {
		if (!caps.has(need[action.target])) return null
		return { style: { ...item.style, [action.target]: action.value } }
	}
	if (action.target === "heads" || action.target === "geometry") {
		if (!item.geometry) return null
		return action.target === "geometry"
			? { geometry: action.value }
			: { heads: { ...item.heads, ...action.value } }
	}
	if (!caps.has("text") || !item.text) return null
	const text = textStylePatch(item.text, action)
	return text ? { text } : null
}

// The new text for a text style action, or null if the action is not about text.
export function textStylePatch(text, action) {
	switch (action.target) {
		case "textColor":
			return withRuns({ ...text, color: action.value }, (run) => without(run, "c"))
		case "textSize":
			return { ...text, size: action.value }
		case "textAlign":
			return { ...text, align: action.value }
		case "bold":
		case "italic":
		case "underline": {
			const key = { bold: "b", italic: "i", underline: "u" }[action.target]
			return withRuns(text, (run) =>
				action.value ? { ...run, [key]: 1 } : without(run, key),
			)
		}
		default:
			return null
	}
}

function applyStyle(store, items, action, measure) {
	const changes = items
		.map((item) => {
			const patch = stylePatch(item, action)
			if (!patch) return null
			if (patch.text && !item.geometry && measure) {
				const needed = autoHeight({ ...item, ...patch }, measure, patch.text)
				if (needed) patch.h = needed // a shape only ever grows to fit; a text box follows its text
			}
			return { id: item.id, patch }
		})
		.filter(Boolean)
	if (!changes.length) return false
	const ok = store.updateItems(changes, { label: "Change style", coalesce: action.coalesce })
	if (ok && action.recent && typeof action.value === "string" && action.value.startsWith("#"))
		store.state.recentColors = pushRecent(store.state.recentColors, action.value)
	if (ok && action.target === "geometry") rememberGeometry(store, action.value)
	return ok
}

// A line type chosen by hand sticks: new lines, and the arrows that add a connected shape, use it
// until it is changed again. The arrowheads of the last tool are kept.
export function rememberGeometry(store, geometry) {
	const last = connectorToolById(store.state.lastConnectorTool)
	const wanted = CONNECTOR_TOOLS.find(
		(tool) => tool.geometry === geometry && tool.arrow === (last ? last.arrow : true),
	)
	if (wanted) store.state.lastConnectorTool = wanted.id
}

// --- format painter ---

export function copyFormat(item) {
	return {
		style: item.style ? { ...item.style } : null,
		text: item.text
			? { color: item.text.color, size: item.text.size, align: item.text.align }
			: null,
		heads: item.heads ? { ...item.heads } : null,
		geometry: item.geometry || null,
		kind: item.geometry ? "connector" : "object",
	}
}

export function pasteFormat(item, format) {
	if ((format.kind === "connector") !== Boolean(item.geometry)) return null // a line's format does not go on a shape
	const caps = capabilitiesOf(item)
	const patch = {}
	if (format.style) {
		const style = { ...item.style }
		for (const [key, value] of Object.entries(format.style)) {
			const cap =
				{ fill: "fill", radius: "radius" }[key] ||
				(key === "opacity" ? "opacity" : "border")
			if (caps.has(cap)) style[key] = value
		}
		patch.style = style
	}
	if (format.text && item.text && caps.has("text"))
		patch.text = withRuns({ ...item.text, ...format.text }, (run) => without(run, "c"))
	if (format.heads && item.geometry) patch.heads = { ...format.heads }
	return Object.keys(patch).length ? patch : null
}

function startPainter(store, objects, connectors) {
	const [source] = [...objects, ...connectors]
	if (!source || objects.length + connectors.length !== 1) return false
	store.state.painter = store.state.painter ? null : copyFormat(source) // pressing it again lets go
	return true
}

// Applies the held format to ``ids`` and puts the painter down.
export function paintOnto(store, ids) {
	const format = store.state.painter
	if (!format) return false
	const changes = ids
		.map((id) => store.getItem(id))
		.filter(Boolean)
		.map((item) => ({ id: item.id, patch: pasteFormat(item, format) }))
		.filter((change) => change.patch)
	store.state.painter = null
	return changes.length ? store.updateItems(changes, { label: "Format painter" }) : false
}

// --- tables ---

const STRUCTURE = {
	rowAbove: (table, cell) => insertRow(table, cell.row, false),
	rowBelow: (table, cell) => insertRow(table, cell.row, true),
	colLeft: (table, cell) => insertColumn(table, cell.col, false),
	colRight: (table, cell) => insertColumn(table, cell.col, true),
	removeRow: (table, cell) => removeRow(table, cell.row),
	removeColumn: (table, cell) => removeColumn(table, cell.col),
}
const LABELS = {
	rowAbove: "Add row above",
	rowBelow: "Add row below",
	colLeft: "Add column left",
	colRight: "Add column right",
	removeRow: "Delete row",
	removeColumn: "Delete column",
}

function tableAction(store, action, measure) {
	const [object] = store.selectedObjects()
	if (!object || object.kind !== "table" || store.selectedObjects().length !== 1) return false
	const cell = activeCell(store) || { row: 0, col: 0 }
	const fits = (table) =>
		measure ? table.rowH.reduce((next, _, row) => growRow(next, row, measure), table) : table
	let next = null
	if (action.op in STRUCTURE) {
		next = STRUCTURE[action.op](object.table, cell)
		if (!next) return false // already at the limit, or the last row or column
	} else if (action.op === "fill") {
		next = fillCells(object.table, activeCell(store), action.value)
	} else if (action.op === "text") {
		next = fits(styleCells(object.table, activeCell(store), action))
		if (next === object.table) return false
	} else {
		return false
	}
	const label = LABELS[action.op] || (action.op === "fill" ? "Cell fill" : "Cell text")
	const ok = store.updateObjects([{ id: object.id, patch: withTable(next) }], { label })
	if (ok && action.op in STRUCTURE)
		store.state.tableCell = { id: object.id, ...cellAfter(action.op, cell, next) }
	if (ok && action.op === "fill" && action.recent && typeof action.value === "string")
		store.state.recentColors = pushRecent(store.state.recentColors, action.value)
	return ok
}

// The chosen cell, or every cell when none is chosen.
function eachCell(table, cell) {
	const all = []
	table.rowH.forEach((_, row) => table.colW.forEach((__, col) => all.push({ row, col })))
	return cell ? [cell] : all
}

function fillCells(table, cell, color) {
	return eachCell(table, cell).reduce((next, c) => setCellFill(next, c.row, c.col, color), table)
}

function styleCells(table, cell, action) {
	return eachCell(table, cell).reduce((next, c) => {
		const current = next.cells[c.row][c.col]
		// Weight needs words to act on. Size, colour and alignment are kept for what is typed next.
		const weight = ["bold", "italic", "underline"].includes(action.target)
		const hasWords = Boolean(current?.paragraphs.some((paragraph) => paragraph.runs.length))
		const base = weight
			? hasWords
				? current
				: null
			: current || emptyText("ocean", { align: "left" })
		const styled = base && textStylePatch(base, action)
		return styled ? setCellText(next, c.row, c.col, styled) : next
	}, table)
}

// --- changing a shape's kind, and comments from the palette ---

export const MIN_SIDES = 3
export const MAX_SIDES = 12

// The shapes menu's tool (rectangle, square, ellipse, circle, ...) that a shape currently is.
export function shapeToolOf(object) {
	if (object.kind !== "shape") return null
	const square = Math.abs(object.w - object.h) < 1
	const options = SHAPE_TOOLS.filter((tool) => tool.shape === object.shape)
	return (
		(options.find((tool) => Boolean(tool.ratio) === square) || options[0] || null)?.id || null
	)
}

// Turns each selected shape into another kind, keeping its place, text and style. A square or a
// circle becomes as wide as the shape's longer side; a polygon keeps its sides or gets the tool's.
function shapeTypeChanges(store, objects, action) {
	const tool = SHAPE_TOOLS.find((t) => t.id === action.tool)
	if (!tool) return []
	return objects
		.filter((object) => object.kind === "shape")
		.map((object) => {
			const patch = {
				shape: tool.shape,
				sides:
					tool.shape === "polygon"
						? object.sides || store.state.toolOptions.sides
						: undefined,
			}
			if (tool.ratio) {
				const side = Math.max(object.w, object.h)
				patch.w = side
				patch.h = side
				patch.x = object.x - (side - object.w) / 2
				patch.y = object.y - (side - object.h) / 2
			}
			return { id: object.id, patch }
		})
		.filter(({ id, patch }) => {
			const object = objects.find((o) => o.id === id)
			return Object.keys(patch).some(
				(key) => JSON.stringify(object[key]) !== JSON.stringify(patch[key]),
			)
		})
}

function sidesChanges(objects, value) {
	const sides = Math.min(MAX_SIDES, Math.max(MIN_SIDES, Math.round(Number(value))))
	if (!Number.isFinite(sides)) return []
	return objects
		.filter((o) => o.kind === "shape" && o.shape === "polygon" && o.sides !== sides)
		.map((o) => ({ id: o.id, patch: { sides } }))
}

// "Add comment" from the palette: a comment on the selected thing, with no clicking on the board.
function startComment(store, objects) {
	if (!store.state.canComment || objects.length !== 1 || store.selectedConnectors().length)
		return false
	store.state.commentDraft = { anchor_type: "shape", shape_id: objects[0].id }
	store.state.commentsOpen = true
	store.state.openThread = null
	return true
}
