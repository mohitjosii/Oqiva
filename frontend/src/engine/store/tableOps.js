// Tables: pure functions that take a table object and return what to change. A table's size is
// always the sum of its column widths and row heights, so every change returns the new size too.

import { centerOf, rotatePoint } from "../geometry/bounds"
import { TABLE_LIMITS } from "../model/schema"
import { layoutText } from "../text/layout"

export const CELL_PADDING = { x: 8, y: 4 }
const sum = (list) => list.reduce((total, value) => total + value, 0)
const clamp = (value) => Math.min(TABLE_LIMITS.maxSize, Math.max(TABLE_LIMITS.minSize, value))

// A patch that sets the table and keeps the object's size in step with it.
export const withTable = (table) => ({ table, w: sum(table.colW), h: sum(table.rowH) })

export const offsetOf = (sizes, index) => sum(sizes.slice(0, index))

// The cell under a board point, or null. Works on a turned table by turning the point back.
export function cellAt(object, point) {
	const local = object.rotation ? rotatePoint(point, centerOf(object), -object.rotation) : point
	const x = local.x - object.x
	const y = local.y - object.y
	if (x < 0 || y < 0 || x > object.w || y > object.h) return null
	return { col: indexAt(object.table.colW, x), row: indexAt(object.table.rowH, y) }
}

function indexAt(sizes, position) {
	let at = 0
	for (let i = 0; i < sizes.length; i++) {
		at += sizes[i]
		if (position < at) return i
	}
	return sizes.length - 1
}

// The cell's rectangle inside the table, in the table's own unturned units.
export const cellRect = (table, row, col) => ({
	x: offsetOf(table.colW, col),
	y: offsetOf(table.rowH, row),
	w: table.colW[col],
	h: table.rowH[row],
})

export function insertRow(table, index, below = true) {
	if (table.rowH.length >= TABLE_LIMITS.maxRows) return null
	const at = below ? index + 1 : index
	const height = table.rowH[index]
	const blank = Array(table.colW.length).fill(null)
	return {
		...table,
		rowH: [...table.rowH.slice(0, at), height, ...table.rowH.slice(at)],
		cells: [...table.cells.slice(0, at), [...blank], ...table.cells.slice(at)],
		fills: [...table.fills.slice(0, at), [...blank], ...table.fills.slice(at)],
	}
}

export function insertColumn(table, index, right = true) {
	if (table.colW.length >= TABLE_LIMITS.maxCols) return null
	const at = right ? index + 1 : index
	const width = table.colW[index]
	const add = (grid) => grid.map((row) => [...row.slice(0, at), null, ...row.slice(at)])
	return {
		...table,
		colW: [...table.colW.slice(0, at), width, ...table.colW.slice(at)],
		cells: add(table.cells),
		fills: add(table.fills),
	}
}

// A table keeps at least one row and one column.
export function removeRow(table, index) {
	if (table.rowH.length <= 1) return null
	const drop = (list) => list.filter((_, i) => i !== index)
	return { ...table, rowH: drop(table.rowH), cells: drop(table.cells), fills: drop(table.fills) }
}

export function removeColumn(table, index) {
	if (table.colW.length <= 1) return null
	const drop = (list) => list.filter((_, i) => i !== index)
	return {
		...table,
		colW: drop(table.colW),
		cells: table.cells.map(drop),
		fills: table.fills.map(drop),
	}
}

const setIn = (grid, row, col, value) =>
	grid.map((cells, r) => (r === row ? cells.map((cell, c) => (c === col ? value : cell)) : cells))
export const setCellText = (table, row, col, text) => ({
	...table,
	cells: setIn(table.cells, row, col, text),
})
export const setCellFill = (table, row, col, color) => ({
	...table,
	fills: setIn(table.fills, row, col, color),
})

// Stretches every column and row in proportion, as when the table is resized by its handles.
export function scaleTable(table, width, height) {
	const scaled = (sizes, target) => {
		const total = sum(sizes)
		return sizes.map((size) => clamp(Math.round((size * target) / total)))
	}
	return { ...table, colW: scaled(table.colW, width), rowH: scaled(table.rowH, height) }
}

// The height a row needs for the text in its cells, never less than its present height.
export function fitRow(table, row, measure) {
	let needed = table.rowH[row]
	table.cells[row].forEach((text, col) => {
		if (!text) return
		const width = Math.max(10, table.colW[col] - CELL_PADDING.x * 2)
		const layout = layoutText(text, { width, measure })
		needed = Math.max(needed, Math.ceil(layout.height + CELL_PADDING.y * 2))
	})
	return Math.min(TABLE_LIMITS.maxSize, needed)
}

export function growRow(table, row, measure) {
	const needed = fitRow(table, row, measure)
	if (needed <= table.rowH[row]) return table
	return { ...table, rowH: table.rowH.map((h, r) => (r === row ? needed : h)) }
}

// Where the active cell ends up after a structural change.
export function cellAfter(op, cell, table) {
	const { row, col } = cell
	const clampTo = (value, sizes) => Math.max(0, Math.min(value, sizes.length - 1))
	switch (op) {
		case "rowAbove":
			return { row: row + 1, col }
		case "removeRow":
			return { row: clampTo(row, table.rowH), col }
		case "colLeft":
			return { row, col: col + 1 }
		case "removeColumn":
			return { row, col: clampTo(col, table.colW) }
		default:
			return cell
	}
}
