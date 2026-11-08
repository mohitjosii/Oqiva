// Smart guides: while a selection is dragged, its edges and centre line up with those of
// other objects (and the page) with a light snap. This is pure arithmetic on axis-aligned
// boxes; the controller feeds it the dragged box and the boxes to compare with.

// The x (or y) positions of a box's two edges and its centre.
const xs = (box) => [box.x, box.x + box.w / 2, box.x + box.w]
const ys = (box) => [box.y, box.y + box.h / 2, box.y + box.h]

function nearest(mine, theirs, threshold) {
	let best = null
	for (const a of mine) {
		for (const b of theirs) {
			const delta = b - a
			if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best)))
				best = delta
		}
	}
	return best
}

const near = (a, b) => Math.abs(a - b) < 0.5

// ``box`` is where the dragged selection would be; ``targets`` are the boxes to line up
// with; ``threshold`` is how close, in board units, counts as lined up. Returns the nudge to
// apply and the guide lines to draw (each {x1, y1, x2, y2}).
export function snapToGuides(box, targets, threshold) {
	const dx = nearest(xs(box), targets.flatMap(xs), threshold) ?? 0
	const dy = nearest(ys(box), targets.flatMap(ys), threshold) ?? 0
	const moved = { ...box, x: box.x + dx, y: box.y + dy }
	return { dx, dy, guides: guidesFor(moved, targets) }
}

function guidesFor(moved, targets) {
	const guides = []
	const seen = new Set()
	const add = (guide) => {
		const key = `${guide.x1},${guide.y1},${guide.x2},${guide.y2}`
		if (!seen.has(key)) {
			seen.add(key)
			guides.push(guide)
		}
	}
	for (const target of targets) {
		for (const mine of xs(moved)) {
			for (const theirs of xs(target)) {
				if (!near(mine, theirs)) continue
				add({
					x1: mine,
					x2: mine,
					y1: Math.min(moved.y, target.y),
					y2: Math.max(moved.y + moved.h, target.y + target.h),
				})
			}
		}
		for (const mine of ys(moved)) {
			for (const theirs of ys(target)) {
				if (!near(mine, theirs)) continue
				add({
					y1: mine,
					y2: mine,
					x1: Math.min(moved.x, target.x),
					x2: Math.max(moved.x + moved.w, target.x + target.w),
				})
			}
		}
	}
	return guides
}
