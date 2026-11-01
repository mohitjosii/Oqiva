// Which object is under a point, and which are inside a rectangle. Hit testing follows the
// real outline of each shape, so a click in the empty corner of a circle misses it.

import { rotatePoint, centerOf, objectBounds, rectsIntersect } from "./bounds"
import { polygonPoints } from "../model/shapes"

function pointInPolygon(point, polygon) {
	let inside = false
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const [xi, yi] = polygon[i]
		const [xj, yj] = polygon[j]
		if (
			yi > point.y !== yj > point.y &&
			point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
		) {
			inside = !inside
		}
	}
	return inside
}

// ``tolerance`` widens the shape by that many board units on every side, so thin shapes
// stay easy to click at any zoom.
export function pointInObject(object, point, tolerance = 0) {
	const local = object.rotation ? rotatePoint(point, centerOf(object), -object.rotation) : point
	const x = local.x - object.x
	const y = local.y - object.y
	const w = object.w
	const h = object.h
	if (x < -tolerance || y < -tolerance || x > w + tolerance || y > h + tolerance) return false
	if (object.kind === "text" || object.shape === "rectangle") return true
	if (object.shape === "ellipse") {
		const rx = w / 2 + tolerance
		const ry = h / 2 + tolerance
		return ((x - w / 2) / rx) ** 2 + ((y - h / 2) / ry) ** 2 <= 1
	}
	const polygon = polygonPoints(object)
	if (!polygon) return true
	if (pointInPolygon({ x, y }, polygon)) return true
	// Close to the outline counts as a hit for the tolerance band.
	return tolerance > 0 && distanceToPolygon({ x, y }, polygon) <= tolerance
}

function distanceToSegment(p, [ax, ay], [bx, by]) {
	const dx = bx - ax
	const dy = by - ay
	const lengthSquared = dx * dx + dy * dy
	const t = lengthSquared
		? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / lengthSquared))
		: 0
	return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy))
}

function distanceToPolygon(point, polygon) {
	return Math.min(
		...polygon.map((vertex, i) =>
			distanceToSegment(point, vertex, polygon[(i + 1) % polygon.length]),
		),
	)
}

// The topmost object at ``point``. ``objects`` is in drawing order, bottom first.
export function topObjectAt(objects, point, tolerance = 0) {
	for (let i = objects.length - 1; i >= 0; i--) {
		if (pointInObject(objects[i], point, tolerance)) return objects[i]
	}
	return null
}

// Objects whose outline box touches ``rect``, as a marquee selects them.
export function objectsInRect(objects, rect) {
	return objects.filter((object) => rectsIntersect(objectBounds(object), rect))
}
