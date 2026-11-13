// The drawn form of every flowchart on the board: node sizes and edge routes, kept up to date as a
// computed value. A chart is worked out again only when its own nodes, edges, text or direction
// change (a signature of those, cheap to build); moving a shape or editing another chart costs
// nothing here. A node being dragged is drawn where the pointer is, and its edges follow.

import { computed } from "vue"
import { nodeSize } from "./model"
import { routeAll } from "./routing"

const sizedMeasure = (measure) => (text, size) => measure(text, { size })

const signature = (chart, nodes, edges, fonts, drag) =>
	[
		chart.id,
		chart.direction,
		fonts,
		drag ? `${drag.nodeId}:${drag.dx},${drag.dy}` : "",
		...nodes.map((n) => `${n.id}|${n.type}|${n.x}|${n.y}|${n.text}|${n.fontSize || ""}`),
		"#",
		...edges.map((e) => `${e.id}|${e.from}|${e.to}|${e.order}|${e.label}`),
	].join("\u0001")

// The drawn form of one chart, worked out directly (export and thumbnails use this; the editor
// keeps the cached ``createFlowLayouts`` instead). ``measure`` is the engine's measurer.
export function layoutChart(chart, nodes, edges, measure) {
	const size = sizedMeasure(measure)
	return {
		chart,
		nodes,
		edges,
		sizes: new Map(nodes.map((n) => [n.id, nodeSize(n, size)])),
		routes: routeAll(chart, nodes, edges, size),
	}
}

// The box round everything a chart draws: its steps and every arrow's route.
export function layoutBounds(layout) {
	let x1 = Infinity
	let y1 = Infinity
	let x2 = -Infinity
	let y2 = -Infinity
	for (const n of layout.nodes) {
		const s = layout.sizes.get(n.id)
		x1 = Math.min(x1, n.x - s.w / 2)
		y1 = Math.min(y1, n.y - s.h / 2)
		x2 = Math.max(x2, n.x + s.w / 2)
		y2 = Math.max(y2, n.y + s.h / 2)
	}
	for (const route of layout.routes.values())
		for (const p of route.points) {
			x1 = Math.min(x1, p.x)
			y1 = Math.min(y1, p.y)
			x2 = Math.max(x2, p.x)
			y2 = Math.max(y2, p.y)
		}
	return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

// ``measure(text, style)`` is the engine's text measurer; ``fonts()`` changes when web fonts load.
export function createFlowLayouts(store, measure, fonts = () => 0) {
	const cache = new Map()
	const size = sizedMeasure(measure)
	return computed(() => {
		const charts = store.charts.value
		const allNodes = store.flowNodes.value
		const allEdges = store.flowEdges.value
		const drag = store.state.flowDrag?.nodeId ? store.state.flowDrag : null
		const nodesBy = new Map()
		const edgesBy = new Map()
		for (const n of allNodes) nodesBy.set(n.chartId, [...(nodesBy.get(n.chartId) || []), n])
		for (const e of allEdges) edgesBy.set(e.chartId, [...(edgesBy.get(e.chartId) || []), e])
		const out = new Map()
		const alive = new Set()
		for (const chart of charts) {
			alive.add(chart.id)
			let nodes = nodesBy.get(chart.id) || []
			const edges = edgesBy.get(chart.id) || []
			const moving = drag && nodes.some((n) => n.id === drag.nodeId) ? drag : null
			if (moving)
				nodes = nodes.map((n) =>
					n.id === moving.nodeId ? { ...n, x: n.x + moving.dx, y: n.y + moving.dy } : n,
				)
			const key = signature(chart, nodes, edges, fonts(), moving)
			const hit = cache.get(chart.id)
			if (hit && hit.key === key) {
				// What is drawn only depends on the above; the records themselves (a node's manual
				// flag, say) are always the current ones.
				out.set(chart.id, { ...hit.layout, chart, nodes, edges })
				continue
			}
			const sizes = new Map(nodes.map((n) => [n.id, nodeSize(n, size)]))
			const routes = routeAll(chart, nodes, edges, size)
			const layout = { chart, nodes, edges, sizes, routes }
			cache.set(chart.id, { key, layout })
			out.set(chart.id, layout)
		}
		for (const id of cache.keys()) if (!alive.has(id)) cache.delete(id)
		return out
	})
}

// The box of a node in board coordinates ({x, y} top-left, w, h) from its centre and size.
export const nodeBox = (node, size) => ({
	x: node.x - size.w / 2,
	y: node.y - size.h / 2,
	w: size.w,
	h: size.h,
})
