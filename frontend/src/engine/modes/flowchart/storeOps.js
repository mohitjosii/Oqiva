// Flowchart edits as store operations. The pure functions in ops.js return a change set; this turns
// it into store operations and runs the whole thing as ONE undoable step.

// The operations for a change set (see ops.js): edges go before the nodes they hang on when
// removing, and nodes before their edges when adding.
export function opsForFlowChange(chartId, change) {
	const ops = []
	const remove = change.remove || {}
	const update = change.update || {}
	const add = change.add || {}
	if (remove.edges?.length) ops.push({ t: "remove", list: "flowedges", ids: remove.edges })
	if (remove.nodes?.length) ops.push({ t: "remove", list: "flownodes", ids: remove.nodes })
	if (change.chart && Object.keys(change.chart).length)
		ops.push({ t: "update", list: "charts", changes: [{ id: chartId, patch: change.chart }] })
	if (update.nodes?.length) ops.push({ t: "update", list: "flownodes", changes: update.nodes })
	if (update.edges?.length) ops.push({ t: "update", list: "flowedges", changes: update.edges })
	if (add.nodes?.length) ops.push({ t: "add", list: "flownodes", items: add.nodes })
	if (add.edges?.length) ops.push({ t: "add", list: "flowedges", items: add.edges })
	return ops
}

// Runs a change set as one step. ``select`` is an id (or a function of the change) to select
// afterwards, ``selectUndo`` the selection to restore on Undo.
export function applyFlowChange(store, chartId, change, { label, select, selectUndo } = {}) {
	if (!change) return false
	const ops = opsForFlowChange(chartId, change)
	if (!ops.length) return false
	const after = typeof select === "function" ? select(change) : select
	return store.applyOps(ops, {
		label,
		select: after ? [after].flat() : undefined,
		selectUndo,
	})
}

// A new chart (a record plus its first nodes and edges, as ``newChartChange`` makes them).
export function addChartOps(chart, change) {
	return [{ t: "add", list: "charts", items: [chart] }, ...opsForFlowChange(chart.id, change)]
}

// Removes a whole chart: its edges, nodes and the chart itself.
export function removeChart(store, chartId, label = "Delete flowchart") {
	const nodes = store.nodesOfChart(chartId).map((n) => n.id)
	const edges = store.edgesOfChart(chartId).map((e) => e.id)
	const ops = []
	if (edges.length) ops.push({ t: "remove", list: "flowedges", ids: edges })
	if (nodes.length) ops.push({ t: "remove", list: "flownodes", ids: nodes })
	ops.push({ t: "remove", list: "charts", ids: [chartId] })
	return store.applyOps(ops, { label, selectUndo: nodes.slice(0, 1) })
}
