// Freehand strokes (the pen and the highlighter). A stroke is an ordinary object: it has a box
// (x, y, w, h), a rotation and a style, so moving, resizing, rotating, copying, arranging and
// exporting it all work like for any other object. Its shape is a list of points stored as fractions
// of that box (0 to 1), so resizing the box resizes the drawing with no other bookkeeping. The box
// includes half the pen's width on every side, so the whole ink is inside it.
//
// Points are thinned WHILE drawing (see ``thinPoints``); a finished stroke is never reshaped, and
// what is drawn is always worked out from the stored points the same way, on every screen.

import { getStroke } from "perfect-freehand"
import { newId } from "./ids"

export const STROKE_LIMITS = { maxPoints: 4000, minWidth: 1, maxWidth: 80 }
export const INKS = {
	pen: { thinning: 0.5, smoothing: 0.5, streamline: 0.5, opacity: 1, width: 4, color: "#1E293B" },
	highlighter: {
		thinning: 0,
		smoothing: 0.6,
		streamline: 0.6,
		opacity: 0.4,
		width: 18,
		color: "#FACC15",
	},
}
export const INK_NAMES = Object.keys(INKS)

const round4 = (value) => Math.round(value * 10000) / 10000
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

// Drops a point that is closer than ``minGap`` to the last one kept, so a slow hand does not pile
// up points. The first point and the last one always stay.
export function thinPoints(points, minGap) {
	if (points.length < 3) return points.map((p) => [...p])
	const kept = [[...points[0]]]
	for (let i = 1; i < points.length - 1; i++) {
		const last = kept[kept.length - 1]
		if (Math.hypot(points[i][0] - last[0], points[i][1] - last[1]) >= minGap)
			kept.push([...points[i]])
	}
	const end = points[points.length - 1]
	const last = kept[kept.length - 1]
	if (end[0] !== last[0] || end[1] !== last[1]) kept.push([...end])
	return kept
}

// Keeps a stroke to the point limit by dropping every other point as often as needed.
export function capPoints(points, max = STROKE_LIMITS.maxPoints) {
	let out = points
	while (out.length > max) out = out.filter((_, i) => i % 2 === 0 || i === out.length - 1)
	return out
}

// The box (with room for the pen) round points given in board coordinates.
export function strokeBox(points, width) {
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const [x, y] of points) {
		minX = Math.min(minX, x)
		minY = Math.min(minY, y)
		maxX = Math.max(maxX, x)
		maxY = Math.max(maxY, y)
	}
	const pad = width / 2
	return { x: minX - pad, y: minY - pad, w: maxX - minX + width, h: maxY - minY + width }
}

// A stroke object from points in board coordinates.
export function createStroke({ points, color, width, ink = "pen", z = 0, id = null }) {
	const kind = INKS[ink] || INKS.pen
	const size = clamp(Number(width) || kind.width, STROKE_LIMITS.minWidth, STROKE_LIMITS.maxWidth)
	const pts = capPoints(points)
	const box = strokeBox(pts, size)
	const w = Math.max(1, box.w)
	const h = Math.max(1, box.h)
	return {
		id: id || newId(),
		kind: "stroke",
		shape: "rectangle",
		x: Math.round(box.x * 100) / 100,
		y: Math.round(box.y * 100) / 100,
		w: Math.round(w * 100) / 100,
		h: Math.round(h * 100) / 100,
		rotation: 0,
		z,
		style: {
			fill: null,
			stroke: color || kind.color,
			strokeWidth: size,
			dash: "solid",
			opacity: kind.opacity,
			radius: 0,
		},
		text: null,
		ink: ink in INKS ? ink : "pen",
		// a pen that reports pressure keeps it as a third number; a mouse or finger has none
		points: pts.map(([x, y, p]) => {
			const point = [round4((x - box.x) / w), round4((y - box.y) / h)]
			if (Number.isFinite(p)) point.push(round4(clamp(p, 0, 1)))
			return point
		}),
	}
}

// The points of a stroke in its own coordinates (0 to w, 0 to h).
export const localPoints = (object) =>
	(object.points || []).map(([x, y, p]) =>
		Number.isFinite(p) ? [x * object.w, y * object.h, p] : [x * object.w, y * object.h],
	)

// The points of a stroke in board coordinates, ignoring rotation.
export const boardPoints = (object) =>
	localPoints(object).map(([x, y, p]) =>
		Number.isFinite(p) ? [object.x + x, object.y + y, p] : [object.x + x, object.y + y],
	)

const average = (a, b) => (a + b) / 2

// The filled outline of a stroke as an SVG path, from points in any one coordinate space.
export function outlinePath(points, width, ink = "pen") {
	const kind = INKS[ink] || INKS.pen
	if (!points.length) return ""
	if (points.length === 1) {
		const [x, y] = points[0]
		const r = width / 2
		return `M${x - r},${y} a${r},${r} 0 1,0 ${width},0 a${r},${r} 0 1,0 ${-width},0Z`
	}
	const outline = getStroke(points, {
		size: width,
		thinning: kind.thinning,
		smoothing: kind.smoothing,
		streamline: kind.streamline,
		// real pressure when the pen reported it, else a simulated one from the speed
		simulatePressure: !points.some((p) => Number.isFinite(p[2])),
		last: true,
	})
	if (outline.length < 4) return ""
	let a = outline[0]
	let b = outline[1]
	const c = outline[2]
	let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`
	for (let i = 2, max = outline.length - 1; i < max; i++) {
		a = outline[i]
		b = outline[i + 1]
		d += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `
	}
	return `${d}Z`
}

// The outline of a stroke object in its own coordinates. Remembered, because it is asked for on
// every draw and only changes when the points, the pen or the box do.
const cache = new Map()
export function strokePath(object) {
	const key = `${object.w}|${object.h}|${object.style.strokeWidth}|${object.ink}|${object.points?.length}|${object.points?.[0]}|${object.points?.[object.points.length - 1]}`
	const hit = cache.get(object.id)
	if (hit && hit.key === key && hit.points === object.points) return hit.d
	const d = outlinePath(localPoints(object), object.style.strokeWidth, object.ink)
	if (cache.size > 2000) cache.clear()
	cache.set(object.id, { key, points: object.points, d })
	return d
}

// ----- hit testing and erasing -----

export function distanceToSegment(px, py, ax, ay, bx, by) {
	const dx = bx - ax
	const dy = by - ay
	const lengthSquared = dx * dx + dy * dy
	const t = lengthSquared ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1) : 0
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// How far a point (in the stroke's own coordinates) is from the stroke's centre line.
export function distanceToStroke(object, x, y) {
	const pts = localPoints(object)
	if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1])
	let best = Infinity
	for (let i = 1; i < pts.length; i++)
		best = Math.min(
			best,
			distanceToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]),
		)
	return best
}

// Puts extra points on long segments, so an eraser can cut in the middle of one.
export function densify(points, step) {
	if (points.length < 2) return points.map((p) => [...p])
	const out = [[...points[0]]]
	for (let i = 1; i < points.length; i++) {
		const [ax, ay] = points[i - 1]
		const [bx, by] = points[i]
		const length = Math.hypot(bx - ax, by - ay)
		const pieces = Math.max(1, Math.ceil(length / step))
		const pa = points[i - 1][2]
		const pb = points[i][2]
		for (let k = 1; k <= pieces; k++) {
			const point = [ax + ((bx - ax) * k) / pieces, ay + ((by - ay) * k) / pieces]
			if (Number.isFinite(pa) && Number.isFinite(pb))
				point.push(pa + ((pb - pa) * k) / pieces)
			out.push(point)
		}
	}
	return out
}

// Removes the part of a polyline that the eraser tip, moved from ``from`` to ``to`` with radius
// ``radius``, touches. Returns the pieces left (each with at least two points), or the same single
// piece (``changed`` false) when nothing was touched.
export function eraseFromPoints(points, from, to, radius) {
	const reach = radius
	const dense = densify(points, Math.max(1.5, radius / 3))
	const pieces = []
	let run = []
	let touched = false
	for (const [x, y] of dense) {
		if (distanceToSegment(x, y, from[0], from[1], to[0], to[1]) <= reach) {
			touched = true
			if (run.length >= 2) pieces.push(run)
			run = []
		} else run.push([x, y])
	}
	if (run.length >= 2) pieces.push(run)
	if (!touched) return { changed: false, pieces: [points] }
	return { changed: true, pieces }
}

// The box of a stroke's centre line, in board coordinates, widened by half the pen.
export function inkBounds(object) {
	return { x: object.x, y: object.y, w: object.w, h: object.h }
}
