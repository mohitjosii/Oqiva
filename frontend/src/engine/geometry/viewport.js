// The one transform between the screen and the board, used by every interaction (drawing,
// selecting, dragging, text, zoom). A viewport is {x, y, scale}: a board point p appears
// on screen at p * scale + (x, y). Distances in the model are always board units.

export const MIN_SCALE = 0.1
export const MAX_SCALE = 4
export const ZOOM_STEP = 0.1

export const createViewport = () => ({ x: 0, y: 0, scale: 1 })

export const clampScale = (scale) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

export const toScreen = (viewport, point) => ({
	x: point.x * viewport.scale + viewport.x,
	y: point.y * viewport.scale + viewport.y,
})

export const toBoard = (viewport, point) => ({
	x: (point.x - viewport.x) / viewport.scale,
	y: (point.y - viewport.y) / viewport.scale,
})

// Zoom to ``scale`` while keeping the board point under ``screenPoint`` where it is.
export function zoomAt(viewport, screenPoint, scale) {
	const next = clampScale(scale)
	const anchor = toBoard(viewport, screenPoint)
	return { scale: next, x: screenPoint.x - anchor.x * next, y: screenPoint.y - anchor.y * next }
}

// One 10% step in or out, snapped to a multiple of 10% so repeated steps land on round numbers.
export function zoomStep(viewport, screenPoint, direction) {
	const tenths = Math.round(viewport.scale / ZOOM_STEP)
	const next = (direction > 0 ? tenths + 1 : Math.max(1, tenths - 1)) * ZOOM_STEP
	return zoomAt(viewport, screenPoint, next)
}

export const panBy = (viewport, dx, dy) => ({ ...viewport, x: viewport.x + dx, y: viewport.y + dy })

// The rectangle of the board that is on screen.
export function visibleRect(viewport, size) {
	const topLeft = toBoard(viewport, { x: 0, y: 0 })
	return {
		x: topLeft.x,
		y: topLeft.y,
		w: size.width / viewport.scale,
		h: size.height / viewport.scale,
	}
}

// A viewport showing ``bounds`` centred with ``padding`` screen pixels around it. It never
// zooms in past ``maxScale``, so one small shape is not blown up to fill the screen.
export function fitBounds(bounds, size, { padding = 48, maxScale = 1 } = {}) {
	if (!bounds || bounds.w <= 0 || bounds.h <= 0)
		return { x: size.width / 2, y: size.height / 2, scale: 1 }
	const room = {
		w: Math.max(1, size.width - padding * 2),
		h: Math.max(1, size.height - padding * 2),
	}
	const scale = clampScale(Math.min(room.w / bounds.w, room.h / bounds.h, maxScale))
	return {
		scale,
		x: (size.width - bounds.w * scale) / 2 - bounds.x * scale,
		y: (size.height - bounds.h * scale) / 2 - bounds.y * scale,
	}
}

// Keeps the view from drifting off its content. The window may move until only a strip of
// ``slack`` screen pixels of ``extent`` is still visible. Used for the preset-size canvas,
// where the pannable area is the page and its margin, growing to include anything dragged out.
export function clampToExtent(viewport, size, extent, slack = 80) {
	const room = slack / viewport.scale
	const left = extent.x
	const right = extent.x + extent.w
	const top = extent.y
	const bottom = extent.y + extent.h
	return {
		...viewport,
		x: clamp(
			viewport.x,
			-(right - room) * viewport.scale,
			size.width - (left + room) * viewport.scale,
		),
		y: clamp(
			viewport.y,
			-(bottom - room) * viewport.scale,
			size.height - (top + room) * viewport.scale,
		),
	}
}

const clamp = (value, low, high) =>
	low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value))
