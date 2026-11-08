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
