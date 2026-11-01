// Resize and rotation handles. Handles sit on the eight points of an object's box and
// rotate with it. All maths is done in the object's own (unrotated) frame, so a rotated
// shape resizes along its own edges.

import { centerOf, rotatePoint } from "./bounds"
import { MIN_SIZE } from "../model/shapes"

const RAD = Math.PI / 180

// Which way each handle pulls: -1 is the near edge, +1 the far edge, 0 leaves that axis alone.
export const HANDLES = {
	nw: { hx: -1, hy: -1 },
	n: { hx: 0, hy: -1 },
	ne: { hx: 1, hy: -1 },
	e: { hx: 1, hy: 0 },
	se: { hx: 1, hy: 1 },
	s: { hx: 0, hy: 1 },
	sw: { hx: -1, hy: 1 },
	w: { hx: -1, hy: 0 },
}

export const HANDLE_NAMES = Object.keys(HANDLES)

export function handlePoint(object, name) {
	const { hx, hy } = HANDLES[name]
	const center = centerOf(object)
	const point = { x: center.x + (hx * object.w) / 2, y: center.y + (hy * object.h) / 2 }
	return object.rotation ? rotatePoint(point, center, object.rotation) : point
}

// Where the rotation handle sits: ``distance`` board units above the top edge's midpoint.
export function rotationHandlePoint(object, distance) {
	const center = centerOf(object)
	const point = { x: center.x, y: object.y - distance }
	return object.rotation ? rotatePoint(point, center, object.rotation) : point
}

// The box after dragging ``handle`` to ``pointer`` (board coordinates). The opposite edge
// or corner stays where it is. ``keepAspect`` holds the width-to-height ratio.
export function resizeBox(
	object,
	handle,
	pointer,
	{ keepAspect = false, minSize = MIN_SIZE, minHeight = minSize } = {},
) {
	const { hx, hy } = HANDLES[handle]
	const center = centerOf(object)
	const cos = Math.cos(object.rotation * RAD)
	const sin = Math.sin(object.rotation * RAD)
	const dx = pointer.x - center.x
	const dy = pointer.y - center.y
	// The pointer in the object's own frame, relative to its centre.
	const lx = dx * cos + dy * sin
	const ly = -dx * sin + dy * cos
	const anchorX = hx === 0 ? 0 : (-hx * object.w) / 2
	const anchorY = hy === 0 ? 0 : (-hy * object.h) / 2
	let w = hx === 0 ? object.w : Math.max(minSize, (lx - anchorX) * hx)
	let h = hy === 0 ? object.h : Math.max(minHeight, (ly - anchorY) * hy)
	if (keepAspect && object.w > 0 && object.h > 0) {
		const ratio = object.w / object.h
		if (hx !== 0 && hy !== 0) {
			const factor = Math.max(w / object.w, h / object.h)
			w = Math.max(minSize, object.w * factor)
			h = Math.max(minSize, w / ratio)
			w = Math.max(minSize, h * ratio)
		} else if (hx !== 0) {
			h = Math.max(minSize, w / ratio)
		} else {
			w = Math.max(minSize, h * ratio)
		}
	}
	const localCenter = {
		x: hx === 0 ? 0 : anchorX + (hx * w) / 2,
		y: hy === 0 ? 0 : anchorY + (hy * h) / 2,
	}
	const shifted = {
		x: center.x + localCenter.x * cos - localCenter.y * sin,
		y: center.y + localCenter.x * sin + localCenter.y * cos,
	}
	return { x: shifted.x - w / 2, y: shifted.y - h / 2, w, h }
}

// The rotation that points the handle at ``pointer``. 0 means upright.
export function rotationFor(object, pointer) {
	const center = centerOf(object)
	return Math.atan2(pointer.y - center.y, pointer.x - center.x) / RAD + 90
}

export const snapAngle = (degrees, step = 15) => Math.round(degrees / step) * step
