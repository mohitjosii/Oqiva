// Moving around the board: pan, zoom and fit. All of it goes through the one viewport
// transform, and in a preset-size canvas the pannable area is kept to the page and what
// has been dragged beyond it.

import { boundsOfObjects, growRect, unionBounds } from "../geometry/bounds"
import { connectorPath, pathBounds, resolveConnectors } from "../geometry/connectors"
import { clampToExtent, fitBounds, zoomAt, zoomStep } from "../geometry/viewport"
import { pageSize } from "../model/schema"

const PAN_SLACK = 80

// The box around every object, line, mind map and flowchart (a free line can lie outside every shape).
export function contentBounds(store) {
	const objects = store.objects.value
	const byId = new Map(objects.map((object) => [object.id, object]))
	const connectors = store.connectors.value
	const resolved = connectors.length ? resolveConnectors(connectors, byId) : new Map()
	const lines = connectors
		.filter((connector) => resolved.has(connector.id))
		.map((connector) => pathBounds(connectorPath(connector, resolved.get(connector.id))))
	// Mind maps and flowcharts are laid out by the controller, which tells the store where they are.
	const drawn = store.extraBounds ? store.extraBounds() : []
	const boxes = [...(objects.length ? [boundsOfObjects(objects)] : []), ...lines, ...drawn]
	return boxes.length ? unionBounds(boxes) : null
}

// What the view may roam over: the page (preset canvas) plus any objects outside it.
export function panExtent(store) {
	const canvas = store.canvas.value
	if (canvas.mode !== "preset") return null
	const { width, height } = pageSize(canvas)
	const content = contentBounds(store)
	return growRect(
		unionBounds([{ x: 0, y: 0, w: width, h: height }, ...(content ? [content] : [])]),
		0,
	)
}

export function setViewport(store, viewport) {
	const extent = panExtent(store)
	const { width, height } = store.state.size
	store.state.viewport =
		extent && width ? clampToExtent(viewport, store.state.size, extent, PAN_SLACK) : viewport
}

const centre = (store) => ({ x: store.state.size.width / 2, y: store.state.size.height / 2 })

export const zoomIn = (store) =>
	setViewport(store, zoomStep(store.state.viewport, centre(store), 1))
export const zoomOut = (store) =>
	setViewport(store, zoomStep(store.state.viewport, centre(store), -1))
export const zoomTo = (store, scale) =>
	setViewport(store, zoomAt(store.state.viewport, centre(store), scale))

// Frame everything: the objects, or the page when the canvas has a preset size and is empty.
export function fitView(store, padding = 48) {
	const canvas = store.canvas.value
	const content = contentBounds(store)
	let target = content
	if (canvas.mode === "preset") {
		const { width, height } = pageSize(canvas)
		target = unionBounds([{ x: 0, y: 0, w: width, h: height }, ...(content ? [content] : [])])
	}
	setViewport(store, fitBounds(target, store.state.size, { padding, maxScale: 1 }))
}

// Scrolls the view so a point on the board is in the middle of the screen.
export function centerOn(store, point) {
	const { scale } = store.state.viewport
	const { width, height } = store.state.size
	setViewport(store, {
		...store.state.viewport,
		x: width / 2 - point.x * scale,
		y: height / 2 - point.y * scale,
	})
}
