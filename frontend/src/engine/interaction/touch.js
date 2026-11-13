// Two fingers on a touch screen pan and zoom the board, as on any map. This follows the fingers and
// says, for each move of either one, how the view should change: the middle point's movement (a pan) and
// how much the distance between the fingers grew (a zoom around that middle).

export function createPinch() {
	const fingers = new Map() // pointer id -> {x, y}
	let last = null // {x, y, distance} of the two fingers at the last report

	const measure = () => {
		const [a, b] = [...fingers.values()]
		return {
			x: (a.x + b.x) / 2,
			y: (a.y + b.y) / 2,
			distance: Math.hypot(a.x - b.x, a.y - b.y),
		}
	}

	return {
		get count() {
			return fingers.size
		},
		down(id, point) {
			fingers.set(id, { x: point.x, y: point.y })
			if (fingers.size === 2) last = measure()
			return fingers.size
		},
		// A finger moved. With exactly two down, returns {center, dx, dy, ratio}; else null.
		move(id, point) {
			if (!fingers.has(id)) return null
			fingers.set(id, { x: point.x, y: point.y })
			if (fingers.size !== 2 || !last) return null
			const now = measure()
			const ratio = last.distance > 4 && now.distance > 4 ? now.distance / last.distance : 1
			const out = {
				center: { x: now.x, y: now.y },
				dx: now.x - last.x,
				dy: now.y - last.y,
				ratio,
			}
			last = now
			return out
		},
		up(id) {
			fingers.delete(id)
			if (fingers.size < 2) last = null
			return fingers.size
		},
		reset() {
			fingers.clear()
			last = null
		},
	}
}
