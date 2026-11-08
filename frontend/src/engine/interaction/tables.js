// Which cell of a table is chosen. The choice is remembered with the table's id; it only counts
// while that table is the one thing selected.

export function activeCell(store) {
	const cell = store.state.tableCell
	if (!cell) return null
	const selected = store.state.selection
	if (selected.length !== 1 || selected[0] !== cell.id) return null
	const object = store.getObject(cell.id)
	if (!object || object.kind !== "table") return null
	const { row, col } = cell
	return row < object.table.rowH.length && col < object.table.colW.length ? { row, col } : null
}
