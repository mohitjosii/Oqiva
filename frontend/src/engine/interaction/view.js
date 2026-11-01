// Moving around the board: pan, zoom and fit. All of it goes through the one viewport
// transform, and in a preset-size canvas the pannable area is kept to the page and what
// has been dragged beyond it.

import { boundsOfObjects, growRect, unionBounds } from "../geometry/bounds"
import { clampToExtent, fitBounds, zoomAt, zoomStep } from "../geometry/viewport"
import { pageSize } from "../model/schema"

const PAN_SLACK = 80

// What the view may roam over: the page (preset canvas) plus any objects outside it.
export function panExtent(store) {
	const canvas = store.canvas.value
	if (canvas.mode !== "preset") return null
	const { width, height } = pageSize(canvas)
	const content = boundsOfObjects(store.objects.value)
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
	const content = boundsOfObjects(store.objects.value)
	let target = content
	if (canvas.mode === "preset") {
		const { width, height } = pageSize(canvas)
		target = unionBounds([{ x: 0, y: 0, w: width, h: height }, ...(content ? [content] : [])])
	}
	setViewport(store, fitBounds(target, store.state.size, { padding, maxScale: 1 }))
}
