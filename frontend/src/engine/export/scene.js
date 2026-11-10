// Works out what an export contains and how big it is. All of it is plain data, so the rules
// (what a selection export holds, which background each format gets) are easy to test.

import { boundsOfObjects, growRect, unionBounds } from "../geometry/bounds"
import { connectorPath, pathBounds, resolveConnectors, isAttached } from "../geometry/connectors"
import { pageSize } from "../model/schema"
import { layoutMap } from "../modes/mindmap/layout"
import { layoutBounds, layoutChart } from "../modes/flowchart/layouts"
import { sized } from "../modes/mindmap/layouts"
import { measureText } from "../text/measure"

export const PADDING = 24
export const MIN_SIDE = 40

// Formats that cannot be see-through get a white page; PNG and SVG stay transparent unless
// the board has a background colour of its own.
const OPAQUE_FORMATS = new Set(["jpeg", "pdf", "print", "thumbnail"])

export function exportBackground(canvas, format) {
	if (canvas?.background) return canvas.background
	return OPAQUE_FORMATS.has(format) ? "#FFFFFF" : null
}

// The objects and lines to draw. A selection export takes what is selected, plus any line
// whose two ends are both on selected shapes.
export function collectItems(store, scope = "board") {
	const objects = store.objects.value
	const connectors = store.connectors.value
	// Every object is kept by id, because a line must be placed even when its shape is not exported.
	const byId = new Map(objects.map((object) => [object.id, object]))
	// A mind map is exported whole: the map, its nodes and its cross-links.
	const wholeMap = (map) => ({
		map,
		nodes: store.nodesOfMap(map.id),
		crosslinks: store.crosslinksOfMap(map.id),
	})
	const wholeChart = (chart) => ({
		chart,
		nodes: store.nodesOfChart(chart.id),
		edges: store.edgesOfChart(chart.id),
	})
	if (scope !== "selection")
		return {
			objects: [...objects],
			connectors: [...connectors],
			byId,
			maps: store.maps.value.map(wholeMap),
			charts: store.charts.value.map(wholeChart),
		}
	const chosen = new Set(store.state.selection)
	const pickedMaps = store.maps.value
		.filter((map) => store.nodesOfMap(map.id).some((n) => chosen.has(n.id)))
		.map(wholeMap)
	const pickedCharts = store.charts.value
		.filter(
			(chart) =>
				store.nodesOfChart(chart.id).some((n) => chosen.has(n.id)) ||
				store.edgesOfChart(chart.id).some((e) => chosen.has(e.id)),
		)
		.map(wholeChart)
	const picked = objects.filter((object) => chosen.has(object.id))
	const ids = new Set(picked.map((object) => object.id))
	return {
		objects: picked,
		byId,
		maps: pickedMaps,
		charts: pickedCharts,
		connectors: connectors.filter(
			(connector) =>
				chosen.has(connector.id) ||
				(isAttached(connector.from) &&
					isAttached(connector.to) &&
					ids.has(connector.from.objectId) &&
					ids.has(connector.to.objectId)),
		),
	}
}

// The rectangle to draw: the page of a preset-size board, otherwise the content with a margin.
export function exportArea(store, items, scope = "board", measure = measureText) {
	const canvas = store.canvas.value
	if (scope !== "selection" && canvas.mode === "preset") {
		const { width, height } = pageSize(canvas)
		return { x: 0, y: 0, w: width, h: height }
	}
	const resolved = items.connectors.length
		? resolveConnectors(items.connectors, items.byId)
		: new Map()
	const boxes = items.connectors
		.filter((connector) => resolved.has(connector.id))
		.map((connector) => pathBounds(connectorPath(connector, resolved.get(connector.id))))
	if (items.objects.length) boxes.push(boundsOfObjects(items.objects))
	for (const m of items.maps || []) boxes.push(layoutMap(m.map, m.nodes, sized(measure)).bounds)
	for (const c of items.charts || []) {
		const box = layoutBounds(layoutChart(c.chart, c.nodes, c.edges, measure))
		if (box) boxes.push(box)
	}
	if (!boxes.length) return null
	const area = growRect(unionBounds(boxes), PADDING)
	return {
		x: area.x,
		y: area.y,
		w: Math.max(MIN_SIDE, Math.round(area.w)),
		h: Math.max(MIN_SIDE, Math.round(area.h)),
	}
}

export const isEmpty = (items) =>
	!items.objects.length &&
	!items.connectors.length &&
	!(items.maps || []).length &&
	!(items.charts || []).length

// The largest picture a browser canvas can be trusted to make.
export const MAX_SIDE = 8192
export const MAX_PIXELS = 40_000_000

// The scale to draw at: what was asked for, or less if the picture would be too big. The
// second value says whether it had to be reduced.
export function fitScale(width, height, wanted = 1) {
	let scale = wanted
	scale = Math.min(scale, MAX_SIDE / Math.max(width, height))
	scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (width * height)))
	return { scale, reduced: scale < wanted - 1e-9 }
}
