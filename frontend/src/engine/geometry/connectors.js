// Connectors: where their ends are, and the line between them. A connector stores what it is
// attached to (an object and one of its eight anchors) or a free point; positions are worked
// out here from the current objects, so a connector follows its shapes through move, resize
// and rotate without anything being stored twice.

import { objectBounds, rotatePoint } from "./bounds"
import { HANDLES, handlePoint } from "./resize"

export const ANCHORS = Object.keys(HANDLES)
export const CONNECTABLE_KINDS = new Set(["shape", "text", "image", "table"])
export const FAN_SPACING = 14 // board units between connectors sharing one anchor
const MIN_STUB = 24 // how far an elbow leaves a shape before turning
const CURVE_SAMPLES = 32
const AVOID_MARGIN = 10 // how far a curve keeps from a card it goes round
const AVOID_REACH = 360 // cards further than this from the two ends are not looked at
// The sideways pushes tried, in order, until a curve clears every card.
const BEND_STEPS = [0, 45, -45, 100, -100, 170, -170, 260, -260, 380, -380]

const length = (v) => Math.hypot(v.x, v.y)
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (v, k) => ({ x: v.x * k, y: v.y * k })
const unit = (v) => {
	const n = length(v)
	return n ? { x: v.x / n, y: v.y / n } : { x: 1, y: 0 }
}

export const isAttached = (end) => Boolean(end && typeof end.objectId === "string")

export const anchorPoint = (object, anchor) => handlePoint(object, anchor)

// The direction pointing out of an object at an anchor, in board space.
export function anchorDirection(object, anchor) {
	const { hx, hy } = HANDLES[anchor]
	const local = unit({ x: hx, y: hy })
	return object.rotation ? rotatePoint(local, { x: 0, y: 0 }, object.rotation) : local
}

// The nearest of the four axis directions, used where a route can only turn at right angles.
export function axisOf(vector) {
	return Math.abs(vector.x) >= Math.abs(vector.y)
		? { x: Math.sign(vector.x) || 1, y: 0 }
		: { x: 0, y: Math.sign(vector.y) }
}

// The anchor (of any connectable object) closest to ``point`` and within ``maxDistance``.
export function nearestAnchor(objects, point, maxDistance, skipId = null) {
	let best = null
	for (const object of objects) {
		if (object.id === skipId || !CONNECTABLE_KINDS.has(object.kind)) continue
		for (const anchor of ANCHORS) {
			const p = anchorPoint(object, anchor)
			const distance = Math.hypot(p.x - point.x, p.y - point.y)
			if (distance <= maxDistance && (!best || distance < best.distance))
				best = { object, anchor, point: p, distance }
		}
	}
	return best
}

function fanOffset(object, anchor, index, count) {
	if (count < 2 || anchor.length > 1) return { x: 0, y: 0 } // corners are not shared out
	const side = anchor === "n" || anchor === "s" ? object.w : object.h
	const spacing = Math.min(FAN_SPACING, (side * 0.8) / (count - 1))
	const along = (index - (count - 1) / 2) * spacing
	const local = anchor === "n" || anchor === "s" ? { x: along, y: 0 } : { x: 0, y: along }
	return object.rotation ? rotatePoint(local, { x: 0, y: 0 }, object.rotation) : local
}

// Positions and directions for every connector. Several connectors on the same anchor are
// spread along its side so they do not sit on top of each other.
export function resolveConnectors(connectors, byId) {
	const groups = new Map()
	for (const connector of connectors) {
		for (const end of ["from", "to"]) {
			const spec = connector[end]
			if (isAttached(spec) && byId.has(spec.objectId)) {
				const key = `${spec.objectId}:${spec.anchor}`
				if (!groups.has(key)) groups.set(key, [])
				groups.get(key).push(`${connector.id}:${end}`)
			}
		}
	}
	const result = new Map()
	let world = null // the cards a curve must not cross, worked out once and only if one is needed
	const cards = () =>
		(world ||= [...byId.values()]
			.filter((object) => object.kind !== "frame")
			.map((object) => ({ id: object.id, ...objectBounds(object) })))
	for (const connector of connectors) {
		const ends = {}
		for (const end of ["from", "to"]) {
			const spec = connector[end]
			if (isAttached(spec)) {
				const object = byId.get(spec.objectId)
				if (!object) break
				const group = groups.get(`${spec.objectId}:${spec.anchor}`)
				const offset = fanOffset(
					object,
					spec.anchor,
					group.indexOf(`${connector.id}:${end}`),
					group.length,
				)
				ends[end] = {
					point: add(anchorPoint(object, spec.anchor), offset),
					dir: anchorDirection(object, spec.anchor),
					attached: true,
				}
			} else {
				ends[end] = { point: { x: spec.x, y: spec.y }, dir: null, attached: false }
			}
		}
		if (!ends.from || !ends.to) continue
		// A free end leaves in the direction of the other end.
		const toward = sub(ends.to.point, ends.from.point)
		ends.from.dir ||= unit(toward)
		ends.to.dir ||= unit(scale(toward, -1))
		result.set(connector.id, {
			p0: ends.from.point,
			p1: ends.to.point,
			d0: ends.from.dir,
			d1: ends.to.dir,
			// Only a curved line with no bend of its own steers round cards.
			cards: connector.geometry === "curved" && !connector.bend ? cards : null,
			own: [connector.from.objectId, connector.to.objectId],
		})
	}
	return result
}

// The corners of an elbow route: right angles only, a simple three-part route that turns
// at the middle, with a short stub out of each shape. It does not steer around other shapes.
export function elbowPoints(p0, d0, p1, d1) {
	const a = axisOf(d0)
	const b = axisOf(d1)
	const horizontalA = a.x !== 0
	const horizontalB = b.x !== 0
	if (horizontalA !== horizontalB) {
		// One leg out, one leg in: a single turn.
		return horizontalA ? [p0, { x: p1.x, y: p0.y }, p1] : [p0, { x: p0.x, y: p1.y }, p1]
	}
	if (horizontalA) {
		const facing = a.x * (p1.x - p0.x) > MIN_STUB * 2 && b.x * (p0.x - p1.x) > MIN_STUB * 2
		if (facing) {
			const midX = (p0.x + p1.x) / 2
			return [p0, { x: midX, y: p0.y }, { x: midX, y: p1.y }, p1]
		}
		const sx = p0.x + a.x * MIN_STUB
		const ex = p1.x + b.x * MIN_STUB
		const midY = p0.y === p1.y ? p0.y - MIN_STUB * 2 : (p0.y + p1.y) / 2
		return [
			p0,
			{ x: sx, y: p0.y },
			{ x: sx, y: midY },
			{ x: ex, y: midY },
			{ x: ex, y: p1.y },
			p1,
		]
	}
	const facing = a.y * (p1.y - p0.y) > MIN_STUB * 2 && b.y * (p0.y - p1.y) > MIN_STUB * 2
	if (facing) {
		const midY = (p0.y + p1.y) / 2
		return [p0, { x: p0.x, y: midY }, { x: p1.x, y: midY }, p1]
	}
	const sy = p0.y + a.y * MIN_STUB
	const ey = p1.y + b.y * MIN_STUB
	const midX = p0.x === p1.x ? p0.x - MIN_STUB * 2 : (p0.x + p1.x) / 2
	return [p0, { x: p0.x, y: sy }, { x: midX, y: sy }, { x: midX, y: ey }, { x: p1.x, y: ey }, p1]
}

function bezier(c, t) {
	const u = 1 - t
	return {
		x:
			u * u * u * c[0].x +
			3 * u * u * t * c[1].x +
			3 * u * t * t * c[2].x +
			t * t * t * c[3].x,
		y:
			u * u * u * c[0].y +
			3 * u * u * t * c[1].y +
			3 * u * t * t * c[2].y +
			t * t * t * c[3].y,
	}
}

const perpendicular = (v) => ({ x: -v.y, y: v.x })

const dot = (a, b) => a.x * b.x + a.y * b.y

// The control points of a curved connector. ``bend`` pushes the middle sideways.
//
// An end that points away from the other end would, with a plain handle, fold the curve back
// through its own card. It gets a longer handle that also leans toward the other end, so the
// curve leaves the card and swings round it.
export function curveControls(p0, d0, p1, d1, bend = 0) {
	const toward = sub(p1, p0)
	const distance = length(toward)
	const dir = unit(toward)
	const reach = Math.min(200, Math.max(30, distance * 0.45))
	const handle = (point, out, facing, lean) => {
		const away = Math.max(0, -dot(out, facing)) // 0 when it points at the other end, 1 when away
		const length = reach * (1 + away * 0.9)
		const side = perpendicular(out)
		const swing = scale(dot(side, lean) >= 0 ? side : scale(side, -1), away * reach * 0.9)
		return add(add(point, scale(out, length)), swing)
	}
	const push = scale(perpendicular(dir), bend)
	return [
		p0,
		add(handle(p0, d0, dir, toward), push),
		add(handle(p1, d1, scale(dir, -1), scale(toward, -1)), push),
		p1,
	]
}

const samples = (controls) =>
	Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => bezier(controls, i / CURVE_SAMPLES))

// How many sampled points of a curve lie inside a card (grown a little). The first and last few
// are ignored: they are on the cards the line belongs to.
function crossings(points, cards) {
	let count = 0
	for (let i = 2; i < points.length - 2; i++) {
		const p = points[i]
		if (
			cards.some(
				(c) =>
					p.x > c.x - AVOID_MARGIN &&
					p.x < c.x + c.w + AVOID_MARGIN &&
					p.y > c.y - AVOID_MARGIN &&
					p.y < c.y + c.h + AVOID_MARGIN,
			)
		)
			count++
	}
	return count
}

// The cards close enough to the two ends of a line to be in its way.
const nearCards = (p0, p1, cards) =>
	cards.filter(
		(c) =>
			c.x + c.w > Math.min(p0.x, p1.x) - AVOID_REACH &&
			c.x < Math.max(p0.x, p1.x) + AVOID_REACH &&
			c.y + c.h > Math.min(p0.y, p1.y) - AVOID_REACH &&
			c.y < Math.max(p0.y, p1.y) + AVOID_REACH,
	)

// A short text that changes when a card that could be in this line's way is moved, resized or
// added, so a cached path is drawn again. Empty for a line that does not steer.
export function avoidanceKey(resolved) {
	if (!resolved.cards) return ""
	const own = new Set(resolved.own)
	return nearCards(
		resolved.p0,
		resolved.p1,
		resolved.cards().filter((c) => !own.has(c.id)),
	)
		.map((c) => `${c.id}:${c.x},${c.y},${c.w},${c.h}`)
		.join(";")
}

// The sideways push, among a few, that takes a curve clear of the cards in its way; the plain curve
// if nothing is in the way, and the least bad one if no push gets clear.
export function autoBend(p0, d0, p1, d1, cards) {
	const near = nearCards(p0, p1, cards)
	if (!near.length) return 0
	let best = { bend: 0, count: Infinity }
	for (const bend of BEND_STEPS) {
		const count = crossings(samples(curveControls(p0, d0, p1, d1, bend)), near)
		if (count === 0) return bend
		if (count < best.count) best = { bend, count }
	}
	return best.bend
}

function pathLength(points) {
	return points.slice(1).reduce((sum, p, i) => sum + length(sub(p, points[i])), 0)
}

function pointAlong(points, distance) {
	let remaining = distance
	for (let i = 1; i < points.length; i++) {
		const segment = length(sub(points[i], points[i - 1]))
		if (remaining <= segment || i === points.length - 1) {
			const t = segment ? Math.min(1, remaining / segment) : 0
			return add(points[i - 1], scale(sub(points[i], points[i - 1]), t))
		}
		remaining -= segment
	}
	return points[0]
}

// Everything needed to draw and hit-test a connector: its outline as a list of points, the SVG
// path, the middle (where the label sits), and the direction at each end (for arrowheads).
export function connectorPath(connector, resolved) {
	const { p0, p1, d0, d1 } = resolved
	let points
	let d
	let mid
	if (connector.geometry === "curved") {
		let bend = connector.bend || 0
		if (!bend && resolved.cards) {
			const own = new Set(resolved.own)
			bend = autoBend(
				p0,
				d0,
				p1,
				d1,
				resolved.cards().filter((card) => !own.has(card.id)),
			)
		}
		const controls = curveControls(p0, d0, p1, d1, bend)
		points = samples(controls)
		d = `M${controls[0].x} ${controls[0].y} C${controls[1].x} ${controls[1].y} ${controls[2].x} ${controls[2].y} ${controls[3].x} ${controls[3].y}`
		mid = bezier(controls, 0.5)
	} else {
		points = connector.geometry === "elbow" ? elbowPoints(p0, d0, p1, d1) : [p0, p1]
		d = `M${points.map((p) => `${p.x} ${p.y}`).join(" L")}`
		mid = pointAlong(points, pathLength(points) / 2)
	}
	const first = points[1] ? sub(points[0], points[1]) : d0
	const last = points[points.length - 2]
		? sub(points[points.length - 1], points[points.length - 2])
		: d1
	return { points, d, mid, startDir: unit(first), endDir: unit(last), p0, p1 }
}

export function distanceToSegment(p, a, b) {
	const ab = sub(b, a)
	const lengthSquared = ab.x * ab.x + ab.y * ab.y
	const t = lengthSquared
		? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / lengthSquared))
		: 0
	return length(sub(p, add(a, scale(ab, t))))
}

export function distanceToPath(path, point) {
	let best = Infinity
	for (let i = 1; i < path.points.length; i++)
		best = Math.min(best, distanceToSegment(point, path.points[i - 1], path.points[i]))
	return best
}

export function pathBounds(path) {
	const xs = path.points.map((p) => p.x)
	const ys = path.points.map((p) => p.y)
	const x = Math.min(...xs)
	const y = Math.min(...ys)
	return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// The bend that puts the middle of a curved connector under ``point``.
export function bendFor(connector, resolved, point) {
	const flat = curveControls(resolved.p0, resolved.d0, resolved.p1, resolved.d1, 0)
	const middle = bezier(flat, 0.5)
	const side = perpendicular(unit(sub(resolved.p1, resolved.p0)))
	// Moving both control points by b along ``side`` moves the middle by 0.75 b.
	return ((point.x - middle.x) * side.x + (point.y - middle.y) * side.y) / 0.75
}

export const connectorHit = (path, point, tolerance) => distanceToPath(path, point) <= tolerance

// Whether any part of a connector's line passes through ``rect`` (used by the marquee).
export function pathIntersectsRect(path, rect) {
	const inside = (p) =>
		p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h
	for (let i = 0; i < path.points.length; i++) {
		if (inside(path.points[i])) return true
		if (i > 0 && segmentCrossesRect(path.points[i - 1], path.points[i], rect)) return true
	}
	return false
}

// Liang-Barsky clipping: does the segment a-b enter the rectangle?
function segmentCrossesRect(a, b, rect) {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const p = [-dx, dx, -dy, dy]
	const q = [a.x - rect.x, rect.x + rect.w - a.x, a.y - rect.y, rect.y + rect.h - a.y]
	let t0 = 0
	let t1 = 1
	for (let i = 0; i < 4; i++) {
		if (p[i] === 0) {
			if (q[i] < 0) return false
			continue
		}
		const t = q[i] / p[i]
		if (p[i] < 0) t0 = Math.max(t0, t)
		else t1 = Math.min(t1, t)
		if (t0 > t1) return false
	}
	return true
}
