// What the arrange tiles do, as pure functions: each takes objects and returns the list of
// changes ({id, patch}) to apply, so the store can record the whole thing as one undo step.
// Nothing here touches the store, which keeps every rule easy to test.

import { boundsOfObjects, centerOf, objectBounds, rotatePoint } from "../geometry/bounds"
import { normalizeRotation } from "../model/schema"

const SAME = 0.0001

// --- stacking order ---

// ``list`` is every item of one kind, lowest first. ``ids`` are the ones to move.
export function reorderChanges(list, ids, mode) {
	const chosen = new Set(ids)
	const moving = list.filter((item) => chosen.has(item.id))
	if (!moving.length) return []
	if (mode === "front" || mode === "back") {
		const rest = list.filter((item) => !chosen.has(item.id))
		if (!rest.length) return []
		const edge = mode === "front" ? rest.at(-1).z : rest[0].z
		if (mode === "front" && moving.every((item, i) => list.at(-moving.length + i) === item))
			return []
		if (mode === "back" && moving.every((item, i) => list[i] === item)) return []
		return moving.map((item, i) => ({
			id: item.id,
			patch: { z: mode === "front" ? edge + 1 + i : edge - moving.length + i },
		}))
	}
	// One step: swap places with the nearest neighbour that is not also being moved.
	const order = [...list]
	if (mode === "forward") {
		for (let i = order.length - 2; i >= 0; i--)
			if (chosen.has(order[i].id) && !chosen.has(order[i + 1].id))
				[order[i], order[i + 1]] = [order[i + 1], order[i]]
	} else {
		for (let i = 1; i < order.length; i++)
			if (chosen.has(order[i].id) && !chosen.has(order[i - 1].id))
				[order[i], order[i - 1]] = [order[i - 1], order[i]]
	}
	const slots = list.map((item) => item.z)
	const changes = []
	order.forEach((item, index) => {
		if (item.z !== slots[index]) changes.push({ id: item.id, patch: { z: slots[index] } })
	})
	return changes
}

// --- alignment and spacing ---

const shift = (object, dx, dy) =>
	Math.abs(dx) < SAME && Math.abs(dy) < SAME
		? null
		: { id: object.id, patch: { x: object.x + dx, y: object.y + dy } }

const compact = (list) => list.filter(Boolean)

// ``reference`` is a rectangle to line up with: the selection's own box, another object's
// box or the canvas.
export function alignChanges(objects, mode, reference) {
	return compact(
		objects.map((object) => {
			const box = objectBounds(object)
			switch (mode) {
				case "left":
					return shift(object, reference.x - box.x, 0)
				case "center":
					return shift(object, reference.x + reference.w / 2 - (box.x + box.w / 2), 0)
				case "right":
					return shift(object, reference.x + reference.w - (box.x + box.w), 0)
				case "top":
					return shift(object, 0, reference.y - box.y)
				case "middle":
					return shift(object, 0, reference.y + reference.h / 2 - (box.y + box.h / 2))
				case "bottom":
					return shift(object, 0, reference.y + reference.h - (box.y + box.h))
				default:
					return null
			}
		}),
	)
}

// Equal gaps between objects along one axis, the two outermost staying where they are.
export function distributeChanges(objects, axis) {
	if (objects.length < 3) return []
	const horizontal = axis === "horizontal"
	const boxes = objects.map((object) => ({ object, box: objectBounds(object) }))
	boxes.sort((a, b) => (horizontal ? a.box.x - b.box.x : a.box.y - b.box.y))
	const start = horizontal ? boxes[0].box.x : boxes[0].box.y
	const last = boxes.at(-1).box
	const end = horizontal ? last.x + last.w : last.y + last.h
	const used = boxes.reduce((sum, { box }) => sum + (horizontal ? box.w : box.h), 0)
	const gap = (end - start - used) / (boxes.length - 1)
	return packed(boxes, horizontal, start, gap)
}

// Closes every gap: objects touch, starting from the first one.
export function removeGapsChanges(objects, axis) {
	if (objects.length < 2) return []
	const horizontal = axis === "horizontal"
	const boxes = objects.map((object) => ({ object, box: objectBounds(object) }))
	boxes.sort((a, b) => (horizontal ? a.box.x - b.box.x : a.box.y - b.box.y))
	return packed(boxes, horizontal, horizontal ? boxes[0].box.x : boxes[0].box.y, 0)
}

function packed(boxes, horizontal, start, gap) {
	const changes = []
	let cursor = start
	for (const { object, box } of boxes) {
		const delta = cursor - (horizontal ? box.x : box.y)
		const change = horizontal ? shift(object, delta, 0) : shift(object, 0, delta)
		if (change) changes.push(change)
		cursor += (horizontal ? box.w : box.h) + gap
	}
	return changes
}

// --- size and position swaps ---

// Makes every object the width, height or both of ``reference``, keeping each one's centre.
export function sameSizeChanges(objects, reference, dimension) {
	return compact(
		objects
			.filter((object) => object.id !== reference.id && object.kind !== "table")
			.map((object) => {
				const w = dimension === "height" ? object.w : reference.w
				const h = dimension === "width" ? object.h : reference.h
				if (w === object.w && h === object.h) return null
				const c = centerOf(object)
				return { id: object.id, patch: { w, h, x: c.x - w / 2, y: c.y - h / 2 } }
			}),
	)
}

export function swapChanges(a, b) {
	const ca = centerOf(a)
	const cb = centerOf(b)
	return [
		{ id: a.id, patch: { x: cb.x - a.w / 2, y: cb.y - a.h / 2 } },
		{ id: b.id, patch: { x: ca.x - b.w / 2, y: ca.y - b.h / 2 } },
	]
}

// --- rotate and flip ---

const selectionCentre = (objects) => centerOf(boundsOfObjects(objects))

// Turns the whole selection about its common centre; a single object turns about itself.
export function rotateChanges(objects, degrees) {
	const about = selectionCentre(objects)
	return objects.map((object) => {
		const c = centerOf(object)
		const moved = rotatePoint(c, about, degrees)
		return {
			id: object.id,
			patch: {
				x: moved.x - object.w / 2,
				y: moved.y - object.h / 2,
				rotation: normalizeRotation((object.rotation || 0) + degrees),
			},
		}
	})
}

// Mirrors the selection. A flipped object is drawn mirrored before it is rotated, so
// mirroring it again on screen also reverses its rotation.
export function flipChanges(objects, axis) {
	const about = selectionCentre(objects)
	const horizontal = axis === "horizontal"
	return objects.map((object) => {
		const c = centerOf(object)
		const flagName = horizontal ? "flipX" : "flipY"
		const patch = {
			x: (horizontal ? 2 * about.x - c.x : c.x) - object.w / 2,
			y: (horizontal ? c.y : 2 * about.y - c.y) - object.h / 2,
			rotation: normalizeRotation(-(object.rotation || 0)),
			[flagName]: object[flagName] ? undefined : true,
		}
		return { id: object.id, patch }
	})
}

// --- groups ---

export function groupChanges(objects, groupId) {
	return objects.length < 2
		? []
		: objects.map((object) => ({ id: object.id, patch: { groupId } }))
}

export function ungroupChanges(objects) {
	return objects
		.filter((object) => object.groupId)
		.map((object) => ({ id: object.id, patch: { groupId: undefined } }))
}

// Every object that shares a group with one of ``ids``, so a group is picked as one.
export function expandToGroups(objects, ids) {
	const wanted = new Set(ids)
	const groups = new Set(
		objects.filter((o) => wanted.has(o.id) && o.groupId).map((o) => o.groupId),
	)
	if (!groups.size) return [...ids]
	const result = new Set(ids)
	for (const object of objects) if (groups.has(object.groupId)) result.add(object.id)
	return [...result]
}
