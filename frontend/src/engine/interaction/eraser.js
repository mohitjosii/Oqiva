// The eraser, without any screen or store in it. Ink mode cuts the part of a stroke the tip touches,
// leaving the pieces that survive (each its own stroke); object mode takes away whole objects under
// the tip. A sweep keeps its own pending result, so the screen can show what is being cut while the
// pointer moves, and one pointer-up turns all of it into a single undo step.

import { centerOf, objectBounds, rotatePoint } from "../geometry/bounds"
import { isAttached } from "../geometry/connectors"
import { pointInObject } from "../geometry/hit"
import { createStroke, distanceToStroke, eraseFromPoints, boardPoints } from "../model/strokes"

export const ERASER_RADIUS = { s: 6, m: 14, l: 30 } // board units, the tip's radius
export const ERASER_SIZES = Object.keys(ERASER_RADIUS)

export const newSweep = () => ({
	sources: new Map(), // stroke id -> {object, pieces: [points...]} for strokes that were touched
	hide: new Set(), // strokes that are being cut (drawn as their pieces instead)
	pieces: [], // the stroke objects that replace them
	marks: new Set(), // object mode: objects the tip has touched
	connectors: new Set(), // object mode: lines the tip has touched
})

// A stroke's points in board coordinates, turned with the object if it is rotated.
export function strokePoints(object) {
	const points = boardPoints(object)
	if (!object.rotation) return points
	const centre = centerOf(object)
	return points.map(([x, y]) => {
		const p = rotatePoint({ x, y }, centre, object.rotation)
		return [p.x, p.y]
	})
}

function rebuildPieces(sweep) {
	const out = []
	for (const { object, pieces } of sweep.sources.values()) {
		for (const points of pieces)
			out.push(
				createStroke({
					points,
					color: object.style.stroke,
					width: object.style.strokeWidth,
					ink: object.ink,
					z: object.z,
				}),
			)
	}
	sweep.pieces = out
}

// Ink mode: moves the tip from ``from`` to ``to`` ([x, y] board points) and cuts every stroke it
// touches. Returns true when something new was cut.
export function sweepInk(sweep, strokes, from, to, radius) {
	const left = Math.min(from[0], to[0]) - radius
	const right = Math.max(from[0], to[0]) + radius
	const top = Math.min(from[1], to[1]) - radius
	const bottom = Math.max(from[1], to[1]) + radius
	let changed = false
	for (const object of strokes) {
		if (object.kind !== "stroke") continue
		const box = objectBounds(object)
		if (box.x > right || box.x + box.w < left || box.y > bottom || box.y + box.h < top) continue
		const current = sweep.sources.get(object.id)
		const pieces = current ? current.pieces : [strokePoints(object)]
		const next = []
		let touched = false
		for (const piece of pieces) {
			const result = eraseFromPoints(piece, from, to, radius + object.style.strokeWidth / 4)
			if (result.changed) touched = true
			next.push(...result.pieces)
		}
		if (!touched) continue
		changed = true
		sweep.sources.set(object.id, { object, pieces: next })
		sweep.hide.add(object.id)
	}
	if (changed) rebuildPieces(sweep)
	return changed
}

// Object mode: marks the objects the tip touches, along the move from ``from`` to ``to``.
export function sweepObjects(sweep, objects, from, to, radius) {
	const length = Math.hypot(to[0] - from[0], to[1] - from[1])
	const steps = Math.max(1, Math.ceil(length / Math.max(2, radius / 2)))
	let changed = false
	for (let i = 0; i <= steps; i++) {
		const point = {
			x: from[0] + ((to[0] - from[0]) * i) / steps,
			y: from[1] + ((to[1] - from[1]) * i) / steps,
		}
		for (const object of objects) {
			if (sweep.marks.has(object.id) || object.kind === "frame") continue
			let hit
			if (object.kind === "stroke") {
				const local = object.rotation
					? rotatePoint(point, centerOf(object), -object.rotation)
					: point
				hit =
					distanceToStroke(object, local.x - object.x, local.y - object.y) <=
					radius + object.style.strokeWidth / 2
			} else hit = pointInObject(object, point, radius)
			if (hit) {
				sweep.marks.add(object.id)
				changed = true
			}
		}
	}
	return changed
}

// The operations that make a finished sweep one undo step, or [] when nothing was touched. Lines
// attached to something removed go with it, as they do for any delete.
export function sweepOps(sweep, connectors = []) {
	const ops = []
	const removeObjects = [...sweep.hide, ...sweep.marks]
	const gone = new Set(removeObjects)
	const lines = new Set(sweep.connectors)
	for (const c of connectors)
		if (
			(isAttached(c.from) && gone.has(c.from.objectId)) ||
			(isAttached(c.to) && gone.has(c.to.objectId))
		)
			lines.add(c.id)
	if (lines.size) ops.push({ t: "remove", list: "connectors", ids: [...lines] })
	if (removeObjects.length) ops.push({ t: "remove", list: "objects", ids: removeObjects })
	if (sweep.pieces.length) ops.push({ t: "add", list: "objects", items: sweep.pieces })
	return ops
}
