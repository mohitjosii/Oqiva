// Where to put a new shape that grows out of an existing one (quick-add).

import { anchorDirection } from "../geometry/connectors"
import { rectsIntersect } from "../geometry/bounds"

export const OPPOSITE = { n: "s", s: "n", e: "w", w: "e", ne: "sw", sw: "ne", nw: "se", se: "nw" }
export const QUICK_GAP = 60

const MAX_TRIES = 12

// A rectangle for a copy of ``source``, ``QUICK_GAP`` away on ``side`` (n, e, s or w), moved
// along the edge until it clears everything else. A rotated source places its copy the same
// way round.
export function quickAddRect(source, side, obstacles) {
	const dir = anchorDirection(source, side)
	const vertical = side === "n" || side === "s"
	const reach = (vertical ? source.h : source.w) + QUICK_GAP
	const cx = source.x + source.w / 2 + dir.x * reach
	const cy = source.y + source.h / 2 + dir.y * reach
	const step = (vertical ? source.w : source.h) + QUICK_GAP / 2
	const along = { x: -dir.y, y: dir.x }
	for (let attempt = 0; attempt <= MAX_TRIES; attempt++) {
		const shift = attempt === 0 ? 0 : Math.ceil(attempt / 2) * (attempt % 2 ? 1 : -1) * step
		const rect = {
			x: cx + along.x * shift - source.w / 2,
			y: cy + along.y * shift - source.h / 2,
			w: source.w,
			h: source.h,
		}
		const margin = QUICK_GAP / 4
		const grown = {
			x: rect.x - margin,
			y: rect.y - margin,
			w: rect.w + margin * 2,
			h: rect.h + margin * 2,
		}
		if (!obstacles.some((box) => rectsIntersect(grown, box))) return rect
	}
	return { x: cx - source.w / 2, y: cy - source.h / 2, w: source.w, h: source.h } // boxed in: overlap rather than refuse
}

// ----- where the shape library puts a shape -----

// True when ``a`` overlaps ``b`` grown by ``margin`` on every side. Touching edges do not count.
export const rectsOverlap = (a, b, margin = 0) =>
	a.x < b.x + b.w + margin &&
	a.x + a.w > b.x - margin &&
	a.y < b.y + b.h + margin &&
	a.y + a.h > b.y - margin

export const centredAt = (point, size) => ({
	x: point.x - size.w / 2,
	y: point.y - size.h / 2,
	w: size.w,
	h: size.h,
})

// Rounds the top-left corner to the grid; no change without one.
export const snapRect = (rect, grid) =>
	grid > 0
		? { ...rect, x: Math.round(rect.x / grid) * grid, y: Math.round(rect.y / grid) * grid }
		: rect

// The nearest clear spot around ``center`` for a shape of ``size``: the centre itself, then rings of
// cells around it. If everything is taken the centre is used anyway (an overlapping shape the
// user can move is better than no shape).
export function freeSpotNear(center, size, obstacles, { gap = 40, maxRings = 6 } = {}) {
	const origin = centredAt(center, size)
	const clear = (rect) => !obstacles.some((box) => rectsOverlap(rect, box, gap / 2))
	if (clear(origin)) return origin
	const stepX = size.w + gap
	const stepY = size.h + gap
	for (let ring = 1; ring <= maxRings; ring++) {
		const cells = []
		for (let dx = -ring; dx <= ring; dx++) {
			for (let dy = -ring; dy <= ring; dy++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
				cells.push({ dx, dy, distance: Math.hypot(dx * stepX, dy * stepY) })
			}
		}
		cells.sort((a, b) => a.distance - b.distance)
		for (const cell of cells) {
			const rect = { ...origin, x: origin.x + cell.dx * stepX, y: origin.y + cell.dy * stepY }
			if (clear(rect)) return rect
		}
	}
	return origin
}

// A spot ``gap`` away from ``source`` on ``side`` (n, e, s or w), centred on it, stepping along
// the edge until it clears everything (as quick-add does). Falls back to the natural spot.
export function placementFor(source, side, size, obstacles, gap = 80, maxAttempts = 12) {
	const horizontal = side === "e" || side === "w"
	const dir = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[side]
	const spacing = gap / 2
	const cx = source.x + source.w / 2 + dir[0] * ((source.w + size.w) / 2 + gap)
	const cy = source.y + source.h / 2 + dir[1] * ((source.h + size.h) / 2 + gap)
	const step = (horizontal ? size.h : size.w) + spacing
	const at = (shift) =>
		centredAt({ x: cx + (horizontal ? 0 : shift), y: cy + (horizontal ? shift : 0) }, size)
	for (let attempt = 0; attempt <= maxAttempts; attempt++) {
		const shift = attempt === 0 ? 0 : Math.ceil(attempt / 2) * (attempt % 2 ? 1 : -1) * step
		const rect = at(shift)
		if (!obstacles.some((box) => rectsOverlap(rect, box, spacing / 2))) return rect
	}
	return at(0)
}

// Click: beside the one selected shape, or near the middle of what is on screen. Drop: centred on
// the point. Always snapped to the grid.
export function libraryPlacement({ size, drop, selected, viewCenter, obstacles, grid = 0 }) {
	if (drop) return snapRect(centredAt(drop, size), grid)
	const others = selected ? obstacles.filter((box) => box !== selected.box) : obstacles
	const rect = selected
		? placementFor(selected.box, "e", size, others)
		: freeSpotNear(viewCenter, size, others)
	return snapRect(rect, grid)
}
