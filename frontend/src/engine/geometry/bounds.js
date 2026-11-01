// Rectangles, rotation and extents. A rectangle is {x, y, w, h}. An object is rotated
// about its centre, by ``rotation`` degrees clockwise.

const RAD = Math.PI / 180

export const centerOf = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })

export function rotatePoint(point, center, degrees) {
	const cos = Math.cos(degrees * RAD)
	const sin = Math.sin(degrees * RAD)
	const dx = point.x - center.x
	const dy = point.y - center.y
	return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

// The four corners of an object in board coordinates: top-left, top-right, bottom-right, bottom-left.
export function corners(object) {
	const center = centerOf(object)
	return [
		{ x: object.x, y: object.y },
		{ x: object.x + object.w, y: object.y },
		{ x: object.x + object.w, y: object.y + object.h },
		{ x: object.x, y: object.y + object.h },
	].map((point) => (object.rotation ? rotatePoint(point, center, object.rotation) : point))
}

const boundsCache = new WeakMap()

// The axis-aligned box around a (possibly rotated) object. Objects are replaced, never
// edited in place, so the result is cached per object.
export function objectBounds(object) {
	let bounds = boundsCache.get(object)
	if (!bounds) {
		if (!object.rotation) {
			bounds = { x: object.x, y: object.y, w: object.w, h: object.h }
		} else {
			const points = corners(object)
			const xs = points.map((p) => p.x)
			const ys = points.map((p) => p.y)
			const x = Math.min(...xs)
			const y = Math.min(...ys)
			bounds = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
		}
		boundsCache.set(object, bounds)
	}
	return bounds
}

export function unionBounds(boxes) {
	if (!boxes.length) return null
	const left = Math.min(...boxes.map((b) => b.x))
	const top = Math.min(...boxes.map((b) => b.y))
	const right = Math.max(...boxes.map((b) => b.x + b.w))
	const bottom = Math.max(...boxes.map((b) => b.y + b.h))
	return { x: left, y: top, w: right - left, h: bottom - top }
}

export const boundsOfObjects = (objects) => unionBounds(objects.map(objectBounds))

export function rectsIntersect(a, b) {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function rectFromPoints(a, b) {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		w: Math.abs(a.x - b.x),
		h: Math.abs(a.y - b.y),
	}
}

export const growRect = (box, amount) => ({
	x: box.x - amount,
	y: box.y - amount,
	w: box.w + amount * 2,
	h: box.h + amount * 2,
})
