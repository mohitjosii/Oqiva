// Orthogonal routing of flowchart arrows between logical ports: bottom to top for a chart that
// flows downward, right to left for one that flows rightward. Pure: nothing here knows about the
// DOM or the store, and (apart from a decision's side exit, see routeAll) nothing avoids obstacles. Arrows leave and arrive with a straight stub,
// edges that would run into each other are spread a little, and edges that go back (or whose target
// lies behind the source) go around the outside of the two nodes.

import { backEdgeIds } from "./layout"
import { nodeSize } from "./model"

export const STUB = 18 // shortest straight piece at each end of an arrow
export const AROUND = 36 // how far beyond the nodes an outer lane runs
export const PORT_SPACING = 14 // between ports that share a side
export const LANE_SPACING = 10 // between lanes that would coincide
const SNAP = 2 // aligned within this many units counts as straight
const COINCIDE = 4 // lanes this close count as one lane
const EPS = 1e-9

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || byId(a, b)

const DIR = {
	top: { x: 0, y: -1 },
	right: { x: 1, y: 0 },
	bottom: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
}

// Sides for the edges leaving a node. Back-edges leave by the side away from the flow's main
// column; a decision sends its outputs (back-edges not counted) bottom, right, left, bottom, ...
// for a downward chart and right, bottom, top, right, ... for a rightward one.
function sidesFor(chart, node, outEdges, back) {
	const horizontal = chart.direction === "LR"
	const forward = horizontal ? "right" : "bottom"
	const outside = horizontal ? "bottom" : "right"
	const cycle = horizontal ? ["right", "bottom", "top"] : ["bottom", "right", "left"]
	const sides = new Map()
	let k = 0
	for (const edge of [...outEdges].sort(byOrder)) {
		if (back.has(edge.id)) {
			sides.set(edge.id, outside)
			continue
		}
		sides.set(edge.id, node.type === "decision" ? cycle[k % cycle.length] : forward)
		k++
	}
	return sides
}

// Map<edgeId, side> for the edges leaving ``node``.
export function outSides(chart, nodes, edges, node) {
	const back = backEdgeIds(chart, nodes, edges)
	return sidesFor(
		chart,
		node,
		edges.filter((e) => e.from === node.id),
		back,
	)
}

// The side an edge arrives by. A back-edge comes back in on the side it left by.
export function inSide(chart, edge, backEdges) {
	const horizontal = chart.direction === "LR"
	if (backEdges?.has(edge.id)) return horizontal ? "bottom" : "right"
	return horizontal ? "left" : "top"
}

// A point on one side of a node. ``size`` is {w, h}. With ``count`` ports on the side they are
// spread along it (PORT_SPACING apart, never over more than 80% of the side). A decision's ports lie
// on the diamond's edge, a junction always uses the middle of its side.
export function portPoint(node, size, side, index = 0, count = 1) {
	const sideways = side === "left" || side === "right"
	const length = sideways ? size.h : size.w
	let offset = 0
	if (count > 1 && node.type !== "junction") {
		const spacing = Math.min(PORT_SPACING, (length * 0.8) / (count - 1))
		offset = (index - (count - 1) / 2) * spacing
	}
	const hw = size.w / 2
	const hh = size.h / 2
	if (node.type === "decision") {
		const k = Math.abs(offset)
		if (side === "top") return { x: node.x + offset, y: node.y - hh * (1 - k / hw) }
		if (side === "bottom") return { x: node.x + offset, y: node.y + hh * (1 - k / hw) }
		if (side === "left") return { x: node.x - hw * (1 - k / hh), y: node.y + offset }
		return { x: node.x + hw * (1 - k / hh), y: node.y + offset }
	}
	if (side === "top") return { x: node.x + offset, y: node.y - hh }
	if (side === "bottom") return { x: node.x + offset, y: node.y + hh }
	if (side === "left") return { x: node.x - hw, y: node.y + offset }
	return { x: node.x + hw, y: node.y + offset }
}

const near = (a, b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

// Drops repeated points and the middle point of two collinear segments that go the same way.
function clean(points) {
	const deduped = []
	for (const p of points)
		if (!deduped.length || !near(deduped[deduped.length - 1], p)) deduped.push(p)
	if (deduped.length < 3) return deduped
	const result = [deduped[0]]
	for (let i = 1; i < deduped.length - 1; i++) {
		const a = result[result.length - 1]
		const b = deduped[i]
		const c = deduped[i + 1]
		const abx = b.x - a.x
		const aby = b.y - a.y
		const bcx = c.x - b.x
		const bcy = c.y - b.y
		const collinear =
			(Math.abs(abx) < EPS && Math.abs(bcx) < EPS) ||
			(Math.abs(aby) < EPS && Math.abs(bcy) < EPS)
		if (collinear && abx * bcx + aby * bcy > 0) continue
		result.push(b)
	}
	result.push(deduped[deduped.length - 1])
	return result
}

// True when the route leaves along ``out``, arrives along ``into`` (both unit vectors), keeps a
// stub at each end and never turns back on itself.
function sound(points, out, into) {
	if (points.length < 2) return false
	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x
		const dy = points[i].y - points[i - 1].y
		if (Math.abs(dx) > EPS && Math.abs(dy) > EPS) return false
		if (i > 1) {
			const px = points[i - 1].x - points[i - 2].x
			const py = points[i - 1].y - points[i - 2].y
			if (px * dx + py * dy < 0) return false
		}
	}
	const n = points.length
	const first = { x: points[1].x - points[0].x, y: points[1].y - points[0].y }
	const last = { x: points[n - 1].x - points[n - 2].x, y: points[n - 1].y - points[n - 2].y }
	return (
		first.x * out.x + first.y * out.y >= STUB - 1e-6 &&
		last.x * into.x + last.y * into.y >= STUB - 1e-6
	)
}

const boxOf = (node, size) => ({
	x: node.x - size.w / 2,
	y: node.y - size.h / 2,
	w: size.w,
	h: size.h,
})

// Works out the shape of one route. Returns {p0, p1, build(coord) -> points, lane}: ``lane`` (when
// there is one) is the middle piece that other routes may coincide with, see ``spreadLanes``.
function plan(p0, p1, outSide, enterSide, boxA, boxB, canMove0, canMove1) {
	const out = DIR[outSide]
	const enter = DIR[enterSide]
	const into = { x: -enter.x, y: -enter.y }
	const horiz = out.x !== 0
	const sign = horiz ? out.x : out.y
	const along = (p) => (horiz ? p.x : p.y)
	const cross = (p) => (horiz ? p.y : p.x)
	const make = (a, c) => (horiz ? { x: a, y: c } : { x: c, y: a })
	const lo = (box) => (horiz ? box.x : box.y)
	const hi = (box) => (horiz ? box.x + box.w : box.y + box.h)
	const crossLo = (box) => (horiz ? box.y : box.x)
	const crossHi = (box) => (horiz ? box.y + box.h : box.x + box.w)
	const stubbed = (p, d) => ({ x: p.x + d.x * STUB, y: p.y + d.y * STUB })
	const s = stubbed(p0, out)
	const e = stubbed(p1, enter)
	const fixedAlong = horiz ? "x" : "y"
	const fixedCross = horiz ? "y" : "x"
	const fixed = (pts) => ({ p0, p1, build: () => pts })

	if (horiz === (enter.x !== 0)) {
		if (out.x === enter.x && out.y === enter.y) {
			// Leaves and arrives by the same side: round the outside.
			const reach =
				sign > 0
					? Math.max(hi(boxA), hi(boxB)) + AROUND
					: Math.min(lo(boxA), lo(boxB)) - AROUND
			return {
				p0,
				p1,
				build: (X) => clean([p0, make(X, cross(p0)), make(X, cross(p1)), p1]),
				lane: {
					kind: "outer",
					fixed: fixedAlong,
					coord: reach,
					dir: sign,
					from: Math.min(cross(p0), cross(p1)),
					to: Math.max(cross(p0), cross(p1)),
				},
			}
		}
		// Facing sides (the usual forward edge).
		const room = sign * (along(p1) - along(p0))
		if (room >= STUB) {
			const diff = Math.abs(cross(p1) - cross(p0))
			if (diff > 0 && diff <= SNAP && (canMove1 || canMove0)) {
				if (canMove1) p1 = make(along(p1), cross(p0))
				else p0 = make(along(p0), cross(p1))
			}
			if (Math.abs(cross(p1) - cross(p0)) < EPS) return fixed(clean([p0, p1]))
		}
		if (room >= STUB * 2) {
			const mid = (along(p0) + along(p1)) / 2
			return {
				p0,
				p1,
				build: (L) => clean([p0, make(L, cross(p0)), make(L, cross(p1)), p1]),
				lane: {
					kind: "mid",
					fixed: fixedAlong,
					coord: mid,
					min: Math.min(along(p0) + sign * STUB, along(p1) - sign * STUB),
					max: Math.max(along(p0) + sign * STUB, along(p1) - sign * STUB),
					from: Math.min(cross(p0), cross(p1)),
					to: Math.max(cross(p0), cross(p1)),
				},
			}
		}
		// The target is behind or too close: go round the side of the two nodes.
		const right = Math.max(crossHi(boxA), crossHi(boxB)) + AROUND
		const left = Math.min(crossLo(boxA), crossLo(boxB)) - AROUND
		const cost = (X) => Math.abs(X - cross(s)) + Math.abs(X - cross(e))
		const X = cost(right) <= cost(left) ? right : left
		return {
			p0,
			p1,
			build: (c) => clean([p0, s, make(along(s), c), make(along(e), c), e, p1]),
			lane: {
				kind: "outer",
				fixed: fixedCross,
				coord: X,
				dir: X === right ? 1 : -1,
				from: Math.min(along(s), along(e)),
				to: Math.max(along(s), along(e)),
			},
		}
	}

	// One side horizontal, the other vertical: a single bend, either way round, else go round.
	for (const corner of [make(along(e), cross(s)), make(along(s), cross(e))]) {
		const points = clean([p0, s, corner, e, p1])
		if (sound(points, out, into)) return fixed(points)
	}
	const farAlong =
		sign > 0 ? Math.max(hi(boxA), hi(boxB)) + AROUND : Math.min(lo(boxA), lo(boxB)) - AROUND
	let points
	if (horiz) {
		const Y =
			enter.y < 0
				? Math.min(boxA.y, boxB.y) - AROUND
				: Math.max(boxA.y + boxA.h, boxB.y + boxB.h) + AROUND
		points = [p0, { x: farAlong, y: p0.y }, { x: farAlong, y: Y }, { x: e.x, y: Y }, e, p1]
	} else {
		const X =
			enter.x < 0
				? Math.min(boxA.x, boxB.x) - AROUND
				: Math.max(boxA.x + boxA.w, boxB.x + boxB.w) + AROUND
		points = [p0, { x: p0.x, y: farAlong }, { x: X, y: farAlong }, { x: X, y: e.y }, e, p1]
	}
	return fixed(clean(points))
}

// Routes whose middle lanes would coincide (within COINCIDE units and overlapping in extent) are
// moved LANE_SPACING apart, in order of edge.order and id: between nodes they fan out around the
// middle, round the outside they step outward.
function spreadLanes(plans) {
	const groups = new Map()
	for (const p of plans) {
		if (!p.lane) continue
		const key = `${p.lane.kind}|${p.lane.fixed}|${p.lane.dir ?? 0}`
		if (!groups.has(key)) groups.set(key, [])
		groups.get(key).push(p)
	}
	for (const group of groups.values()) {
		group.sort((a, b) => a.lane.coord - b.lane.coord || byOrder(a.edge, b.edge))
		let cluster = []
		const flush = () => {
			if (cluster.length > 1) spreadCluster(cluster)
			cluster = []
		}
		for (const p of group) {
			if (cluster.length && p.lane.coord - cluster[cluster.length - 1].lane.coord > COINCIDE)
				flush()
			cluster.push(p)
		}
		flush()
	}
}

function spreadCluster(cluster) {
	const parent = cluster.map((_, i) => i)
	const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
	for (let i = 0; i < cluster.length; i++) {
		for (let j = i + 1; j < cluster.length; j++) {
			const a = cluster[i].lane
			const b = cluster[j].lane
			if (Math.min(a.to, b.to) - Math.max(a.from, b.from) > EPS) parent[find(j)] = find(i)
		}
	}
	const parts = new Map()
	cluster.forEach((p, i) => {
		const root = find(i)
		if (!parts.has(root)) parts.set(root, [])
		parts.get(root).push(p)
	})
	for (const part of parts.values()) {
		if (part.length < 2) continue
		part.sort((a, b) => byOrder(a.edge, b.edge))
		const coords = part.map((p) => p.lane.coord)
		if (part[0].lane.kind === "mid") {
			const centre = coords.reduce((sum, c) => sum + c, 0) / coords.length
			part.forEach((p, i) => {
				const wanted = centre + (i - (part.length - 1) / 2) * LANE_SPACING
				p.lane.coord = Math.min(p.lane.max, Math.max(p.lane.min, wanted))
			})
		} else {
			const dir = part[0].lane.dir
			const base = dir > 0 ? Math.min(...coords) : Math.max(...coords)
			part.forEach((p, i) => (p.lane.coord = base + dir * i * LANE_SPACING))
		}
	}
}

// Where to put an edge's label: the middle of its longest segment.
function labelPoint(points) {
	let best = 0
	let bestLength = -1
	for (let i = 1; i < points.length; i++) {
		const length =
			Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y)
		if (length > bestLength + EPS) {
			bestLength = length
			best = i
		}
	}
	const a = points[best - 1]
	const b = points[best]
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

const unit = (a, b) => {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const length = Math.abs(dx) + Math.abs(dy)
	return length ? { x: dx / length, y: dy / length } : { x: 0, y: 0 }
}

// Map<edgeId, {points, fromSide, toSide, label, startDir, endDir}> for every edge whose two nodes
// exist. ``points`` is an orthogonal polyline from the out-port to the in-port.
export function routeAll(chart, nodes, edges, measure) {
	const byNode = new Map(nodes.map((n) => [n.id, n]))
	const sizes = new Map(nodes.map((n) => [n.id, nodeSize(n, measure)]))
	const back = backEdgeIds(chart, nodes, edges)
	const valid = edges.filter((e) => byNode.has(e.from) && byNode.has(e.to)).sort(byOrder)

	const leaving = new Map()
	for (const edge of valid) {
		if (!leaving.has(edge.from)) leaving.set(edge.from, [])
		leaving.get(edge.from).push(edge)
	}
	const outSide = new Map()
	for (const [id, list] of leaving)
		for (const [edgeId, side] of sidesFor(chart, byNode.get(id), list, back))
			outSide.set(edgeId, side)

	// A decision's side exit (right or left, or bottom or top in a rightward chart) runs straight
	// across the row to the target's column. When another step stands in that way, the arrow leaves
	// by the forward side instead, like the first output does.
	const horizontal = chart.direction === "LR"
	const forward = horizontal ? "right" : "bottom"
	const solid = nodes.map((n) => ({ id: n.id, box: boxOf(n, sizes.get(n.id)) }))
	const crosses = (rect, skip) =>
		solid.some(
			({ id, box }) =>
				!skip.has(id) &&
				rect.x < box.x + box.w + 6 &&
				rect.x + rect.w > box.x - 6 &&
				rect.y < box.y + box.h + 6 &&
				rect.y + rect.h > box.y - 6,
		)
	for (const edge of valid) {
		const side = outSide.get(edge.id)
		const from = byNode.get(edge.from)
		const to = byNode.get(edge.to)
		if (from.type !== "decision" || back.has(edge.id) || side === forward) continue
		const fs = sizes.get(from.id)
		const ts = sizes.get(to.id)
		const sign = side === "right" || side === "bottom" ? 1 : -1
		let run
		let drop
		if (horizontal) {
			const y0 = from.y + (sign * fs.h) / 2
			run = { x: from.x, y: Math.min(y0, to.y), w: 2, h: Math.abs(to.y - y0) }
			drop = { x: from.x, y: to.y - 1, w: Math.max(2, to.x - ts.w / 2 - from.x), h: 2 }
		} else {
			const x0 = from.x + (sign * fs.w) / 2
			run = { x: Math.min(x0, to.x), y: from.y, w: Math.abs(to.x - x0), h: 2 }
			drop = { x: to.x - 1, y: from.y, w: 2, h: Math.max(2, to.y - ts.h / 2 - from.y) }
		}
		if (crosses(run, new Set([from.id, to.id])) || crosses(drop, new Set([from.id, to.id])))
			outSide.set(edge.id, forward)
	}

	// Ports: every (node, side) with the edges that use it, in the order of the other end.
	const ports = new Map()
	const onAxisX = (side) => side === "top" || side === "bottom"
	const join = (nodeId, side, entry) => {
		const key = `${nodeId}|${side}`
		if (!ports.has(key)) ports.set(key, [])
		ports.get(key).push(entry)
	}
	const enterSide = new Map()
	for (const edge of valid) {
		const from = byNode.get(edge.from)
		const to = byNode.get(edge.to)
		const out = outSide.get(edge.id)
		const into = inSide(chart, edge, back)
		enterSide.set(edge.id, into)
		join(edge.from, out, { edge, role: 0, key: onAxisX(out) ? to.x : to.y })
		join(edge.to, into, { edge, role: 1, key: onAxisX(into) ? from.x : from.y })
	}
	const slot = new Map() // `${edgeId}|${role}` -> {index, count}
	for (const list of ports.values()) {
		list.sort((a, b) => a.key - b.key || a.role - b.role || byOrder(a.edge, b.edge))
		list.forEach((entry, index) =>
			slot.set(`${entry.edge.id}|${entry.role}`, { index, count: list.length }),
		)
	}

	const movable = (node) => node.type !== "decision" && node.type !== "junction"
	const plans = []
	for (const edge of valid) {
		const from = byNode.get(edge.from)
		const to = byNode.get(edge.to)
		const out = outSide.get(edge.id)
		const into = enterSide.get(edge.id)
		const a = slot.get(`${edge.id}|0`)
		const b = slot.get(`${edge.id}|1`)
		const p0 = portPoint(from, sizes.get(from.id), out, a.index, a.count)
		const p1 = portPoint(to, sizes.get(to.id), into, b.index, b.count)
		const shape = plan(
			p0,
			p1,
			out,
			into,
			boxOf(from, sizes.get(from.id)),
			boxOf(to, sizes.get(to.id)),
			movable(from),
			movable(to),
		)
		plans.push({ edge, out, into, ...shape })
	}
	spreadLanes(plans)

	const routes = new Map()
	for (const p of plans) {
		const points = p.lane ? p.build(p.lane.coord) : p.build()
		const n = points.length
		routes.set(p.edge.id, {
			points,
			fromSide: p.out,
			toSide: p.into,
			label: labelPoint(points),
			startDir: unit(points[0], points[1]),
			endDir: unit(points[n - 2], points[n - 1]),
		})
	}
	return routes
}

export function routeBounds(route) {
	const xs = route.points.map((p) => p.x)
	const ys = route.points.map((p) => p.y)
	const x = Math.min(...xs)
	const y = Math.min(...ys)
	return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function distanceToSegment(p, a, b) {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const lengthSquared = dx * dx + dy * dy
	const t = lengthSquared
		? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
		: 0
	return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

// Shortest distance from ``point`` to any segment of the route.
export function distanceToRoute(route, point) {
	let best = Infinity
	for (let i = 1; i < route.points.length; i++)
		best = Math.min(best, distanceToSegment(point, route.points[i - 1], route.points[i]))
	return best
}

export const hitRoute = (route, point, tolerance = 6) => distanceToRoute(route, point) <= tolerance

// The point at half the length of the route.
export function routeMid(route) {
	const { points } = route
	const lengths = []
	let total = 0
	for (let i = 1; i < points.length; i++) {
		const length =
			Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y)
		lengths.push(length)
		total += length
	}
	let left = total / 2
	for (let i = 0; i < lengths.length; i++) {
		if (left <= lengths[i] || i === lengths.length - 1) {
			const t = lengths[i] ? left / lengths[i] : 0
			const a = points[i]
			const b = points[i + 1]
			return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
		}
		left -= lengths[i]
	}
	return { ...points[0] }
}
