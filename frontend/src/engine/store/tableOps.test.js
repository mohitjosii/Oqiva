import { describe, expect, it } from "vitest"
import { createTable } from "../model/factories"
import {
	cellAfter,
	cellAt,
	cellRect,
	fitRow,
	growRow,
	insertColumn,
	insertRow,
	removeColumn,
	removeRow,
	scaleTable,
	setCellFill,
	setCellText,
	setTrackSize,
	withTable,
} from "./tableOps"

const make = (rows = 2, cols = 3, over = {}) => ({
	...createTable({ rows, cols, center: { x: 0, y: 0 }, theme: "ocean", z: 1 }),
	id: "t",
	...over,
})
const text = (t, size = 16) => ({
	align: "left",
	size,
	color: "#000000",
	paragraphs: [{ runs: [{ t }] }],
})
const measure = (s, style) => s.length * style.size * 0.5

describe("table size", () => {
	it("is the sum of its columns and rows", () => {
		const t = make(2, 3)
		expect(t.w).toBe(360)
		expect(t.h).toBe(88)
		expect(withTable({ ...t.table, colW: [50, 50] })).toMatchObject({ w: 100, h: 88 })
	})
})

describe("finding a cell", () => {
	const t = make(2, 3, { x: 100, y: 200 }) // cells 120 wide, 44 tall

	it("finds the cell under a point", () => {
		expect(cellAt(t, { x: 110, y: 210 })).toEqual({ row: 0, col: 0 })
		expect(cellAt(t, { x: 230, y: 250 })).toEqual({ row: 1, col: 1 }) // 130 across and 50 down the table
	})

	it("returns the last row and column at the far edges, and null outside", () => {
		expect(cellAt(t, { x: 459, y: 287 })).toEqual({ row: 1, col: 2 })
		expect(cellAt(t, { x: 99, y: 210 })).toBeNull()
		expect(cellAt(t, { x: 200, y: 400 })).toBeNull()
	})

	it("works on a table that has been turned", () => {
		const turned = { ...t, rotation: 90 } // turns about its centre, (280, 244)
		// The middle of the first cell is (160, 222) before turning. A quarter turn clockwise about
		// the centre carries it to (280 - (222 - 244), 244 + (160 - 280)).
		const where = { x: 280 - (222 - 244), y: 244 + (160 - 280) }
		expect(cellAt(turned, where)).toEqual({ row: 0, col: 0 })
		expect(cellAt(turned, { x: 160, y: 222 })).not.toEqual({ row: 0, col: 0 }) // its old place is no longer that cell
	})

	it("gives a cell's rectangle", () => {
		expect(cellRect(t.table, 1, 2)).toEqual({ x: 240, y: 44, w: 120, h: 44 })
	})
})

describe("adding and removing rows and columns", () => {
	it("adds a row below or above, copying the neighbour's height, with blank cells", () => {
		const t = make(2, 2)
		t.table.rowH = [30, 60]
		t.table.cells[0][0] = text("keep")
		const below = insertRow(t.table, 0)
		expect(below.rowH).toEqual([30, 30, 60])
		expect(below.cells[1]).toEqual([null, null])
		expect(below.cells[0][0].paragraphs[0].runs[0].t).toBe("keep")
		expect(below.fills).toHaveLength(3)
		expect(insertRow(t.table, 1, false).rowH).toEqual([30, 60, 60])
		expect(insertRow(t.table, 1, false).cells[1]).toEqual([null, null])
	})

	it("adds a column to the right or left", () => {
		const t = make(2, 2)
		t.table.colW = [50, 80]
		t.table.cells[0][1] = text("x")
		const right = insertColumn(t.table, 0)
		expect(right.colW).toEqual([50, 50, 80])
		expect(right.cells[0]).toEqual([null, null, text("x")])
		expect(insertColumn(t.table, 1, false).colW).toEqual([50, 80, 80])
		expect(right.fills.every((row) => row.length === 3)).toBe(true)
	})

	it("stops at the limits", () => {
		expect(insertRow(make(30, 1).table, 0)).toBeNull()
		expect(insertColumn(make(1, 20).table, 0)).toBeNull()
		expect(insertRow(make(29, 1).table, 0)).not.toBeNull()
	})

	it("removes a row or column with its cells, but never the last one", () => {
		const t = make(3, 3)
		t.table.cells[1][1] = text("gone")
		const fewer = removeRow(t.table, 1)
		expect(fewer.rowH).toHaveLength(2)
		expect(JSON.stringify(fewer.cells)).not.toContain("gone")
		expect(removeColumn(t.table, 0).colW).toHaveLength(2)
		expect(removeColumn(t.table, 0).cells.every((row) => row.length === 2)).toBe(true)
		expect(removeRow(make(1, 3).table, 0)).toBeNull()
		expect(removeColumn(make(3, 1).table, 0)).toBeNull()
	})
})

describe("cell content", () => {
	it("sets text and fill on one cell only, without touching the original", () => {
		const t = make(2, 2)
		const next = setCellFill(setCellText(t.table, 1, 0, text("hi")), 0, 1, "#FEE2E2")
		expect(next.cells[1][0].paragraphs[0].runs[0].t).toBe("hi")
		expect(next.fills[0][1]).toBe("#FEE2E2")
		expect(next.cells[0][0]).toBeNull()
		expect(t.table.cells[1][0]).toBeNull()
		expect(t.table.fills[0][1]).toBeNull()
	})
})

describe("resizing a table", () => {
	it("stretches columns and rows in proportion", () => {
		const t = make(2, 2)
		t.table.colW = [100, 300]
		const scaled = scaleTable(t.table, 800, 88)
		expect(scaled.colW).toEqual([200, 600])
		expect(scaled.rowH).toEqual([44, 44])
	})

	it("keeps every cell at least 20 across, and at most 2000", () => {
		const t = make(2, 2)
		expect(scaleTable(t.table, 10, 10).colW).toEqual([20, 20])
		expect(scaleTable(t.table, 100000, 88).colW.every((w) => w <= 2000)).toBe(true)
	})
})

describe("rows that grow to fit their text", () => {
	it("needs a taller row for several lines, and never a shorter one", () => {
		const t = make(2, 1)
		t.table.colW = [100]
		t.table.cells[0][0] = text("word ".repeat(20)) // many lines in a 84px-wide cell
		expect(fitRow(t.table, 0, measure)).toBeGreaterThan(44)
		expect(growRow(t.table, 0, measure).rowH[0]).toBeGreaterThan(44)
		expect(growRow(t.table, 0, measure).rowH[1]).toBe(44)
		t.table.cells[1][0] = text("a")
		expect(fitRow(t.table, 1, measure)).toBe(44)
		expect(growRow(t.table, 1, measure)).toBe(t.table) // unchanged: the same object comes back
	})
})

describe("where the active cell goes after a change", () => {
	const t = make(3, 3).table
	it("shifts when something is inserted before it and clamps when its row or column goes", () => {
		expect(cellAfter("rowAbove", { row: 1, col: 1 }, t)).toEqual({ row: 2, col: 1 })
		expect(cellAfter("colLeft", { row: 1, col: 1 }, t)).toEqual({ row: 1, col: 2 })
		expect(cellAfter("rowBelow", { row: 1, col: 1 }, t)).toEqual({ row: 1, col: 1 })
		expect(cellAfter("removeRow", { row: 2, col: 0 }, make(2, 3).table)).toEqual({
			row: 1,
			col: 0,
		})
		expect(cellAfter("removeColumn", { row: 0, col: 2 }, make(3, 2).table)).toEqual({
			row: 0,
			col: 1,
		})
	})
})

describe("setTrackSize", () => {
	it("sets one row, within the limits", () => {
		const table = make(3, 2).table
		const next = setTrackSize(table, "row", 1, 90)
		expect(next.rowH).toEqual([table.rowH[0], 90, table.rowH[2]])
		expect(setTrackSize(table, "row", 1, 1).rowH[1]).toBe(20)
		expect(setTrackSize(table, "row", 1, 99999).rowH[1]).toBe(2000)
	})

	it("a row stops at the height of its text", () => {
		const base = make(2, 2).table
		const table = {
			...base,
			cells: [[text("hello world this is long", 16), null], base.cells[1]],
		}
		const next = setTrackSize(table, "row", 0, 20, measure)
		expect(next.rowH[0]).toBeGreaterThan(20)
	})

	it("a narrower column makes its row taller where the text wraps", () => {
		const base = make(2, 2).table
		const table = {
			...base,
			cells: [[text("hello world this is long", 16), null], base.cells[1]],
		}
		const next = setTrackSize(table, "col", 0, 40, measure)
		expect(next.colW[0]).toBe(40)
		expect(next.rowH[0]).toBeGreaterThan(table.rowH[0])
	})
})
