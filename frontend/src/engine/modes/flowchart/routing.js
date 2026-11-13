// Orthogonal routing of flowchart arrows between logical ports: bottom to top for a chart that
// flows downward, right to left for one that flows rightward. Pure: nothing here knows about the
// DOM or the store. Arrows leave and arrive with a straight stub, edges that would run into each
// other are spread a little, and edges that go back (or whose target lies behind the source) go
// around the outside of the two nodes. A route that would pass through another step is searched
// again over the lines that run round the steps (see ``searchRoute``).

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

// ----- obstacle avoidance -----

const CLEAR = 12 // how far a searched route keeps from a step
const TOLERANCE = 6 // a planned route may come this close to a step before it is searched again
// What a search looks at, tried in this order: the margin it keeps from the steps, how far beyond
// the two ends it looks for steps, and how many of them (the closest) it takes lines from.
const ATTEMPTS = [
	{ margin: CLEAR, reach: 140, steps: 24 },
	{ margin: CLEAR, reach: 500, steps: 24 },
	{ margin: 6, reach: 500, steps: 40 },
	{ margin: 2, reach: Infinity, steps: 80 },
]
const HASTE = 2.5 // weight of the distance still to go: above 1 trades a little length for speed
const BEND = 30 // cost of a turn, in units of length
const SHARE = 0.5 // extra cost per unit of length that runs along another route
const MAX_EXPANSIONS = 3000 // states one search may expand
const BASE_WORK = 16000 // work (states expanded, lines built) all searches of one routeAll may do
const SMALL_CHART = 200 // a chart of fewer steps may do more, 250 per missing step

const DX = [1, 0, -1, 0]
const DY = [0, 1, 0, -1]
const dirIndex = (d) => (d.x > 0 ? 0 : d.y > 0 ? 1 : d.x < 0 ? 2 : 3)

// True when the open segment a-b passes through the inside of ``box`` grown by ``margin``.
function segmentHits(a, b, box, margin) {
	return (
		Math.max(a.x, b.x) > box.x - margin + EPS &&
		Math.min(a.x, b.x) < box.x + box.w + margin - EPS &&
		Math.max(a.y, b.y) > box.y - margin + EPS &&
		Math.min(a.y, b.y) < box.y + box.h + margin - EPS
	)
}

// True when a route runs through (or within ``margin`` of) a step other than its two ends. The
// first piece is the source's own stub and the last one the target's, so they are not held
// against those two (a diamond's stub may start inside its box); the pieces in between must keep
// out of the ends too.
function blocked(points, from, to, obstacles, margin) {
	let x0 = Infinity
	let y0 = Infinity
	let x1 = -Infinity
	let y1 = -Infinity
	for (const p of points) {
		x0 = Math.min(x0, p.x)
		y0 = Math.min(y0, p.y)
		x1 = Math.max(x1, p.x)
		y1 = Math.max(y1, p.y)
	}
	const last = points.length - 2
	for (const o of obstacles) {
		const { box } = o
		if (
			box.x - margin >= x1 ||
			box.x + box.w + margin <= x0 ||
			box.y - margin >= y1 ||
			box.y + box.h + margin <= y0
		)
			continue
		const isFrom = o.id === from
		const isTo = o.id === to
		for (let i = 0; i <= last; i++) {
			if ((isFrom && i === 0) || (isTo && i === last)) continue
			if (segmentHits(points[i], points[i + 1], box, isFrom || isTo ? 0 : margin)) {
				return true
			}
		}
	}
	return false
}

// What the routes found so far occupy, so that a later search prefers to keep off them:
// horizontal pieces by y, vertical ones by x, as [from, to] spans.
function newUsage() {
	return { h: new Map(), v: new Map() }
}

function addUsage(usage, points) {
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1]
		const b = points[i]
		const horizontal = Math.abs(a.y - b.y) < EPS
		const map = horizontal ? usage.h : usage.v
		const key = Math.round(horizontal ? a.y : a.x)
		if (!map.has(key)) map.set(key, [])
		map.get(key).push(
			horizontal
				? [Math.min(a.x, b.x), Math.max(a.x, b.x)]
				: [Math.min(a.y, b.y), Math.max(a.y, b.y)],
		)
	}
}

// The spans of ``map`` that lie within COINCIDE of the line at ``coord``.
function spansNear(map, coord) {
	const spans = []
	const key = Math.round(coord)
	for (let k = key - COINCIDE; k <= key + COINCIDE; k++) {
		const list = map.get(k)
		if (list) for (const s of list) spans.push(s)
	}
	return spans
}

// Scratch buffers of the search, kept between searches so that none allocates much.
const scratch = { size: 0, g: null, parent: null, stamp: null, closed: null, round: 0 }

function ensureScratch(size) {
	if (scratch.size >= size) return
	scratch.size = size
	scratch.g = new Float64Array(size)
	scratch.parent = new Int32Array(size)
	scratch.stamp = new Uint32Array(size)
	scratch.closed = new Uint32Array(size)
	scratch.round = 0
}

// A binary min-heap of states ordered by f, then by insertion (so that ties come out stably).
class Heap {
	constructor() {
		this.f = []
		this.n = []
		this.state = []
	}
	get size() {
		return this.f.length
	}
	before(i, j) {
		return this.f[i] < this.f[j] || (this.f[i] === this.f[j] && this.n[i] < this.n[j])
	}
	swap(i, j) {
		const { f, n, state } = this
		;[f[i], f[j]] = [f[j], f[i]]
		;[n[i], n[j]] = [n[j], n[i]]
		;[state[i], state[j]] = [state[j], state[i]]
	}
	push(f, n, state) {
		this.f.push(f)
		this.n.push(n)
		this.state.push(state)
		let i = this.f.length - 1
		while (i > 0) {
			const p = (i - 1) >> 1
			if (!this.before(i, p)) break
			this.swap(i, p)
			i = p
		}
	}
	// Removes the first entry and returns its state.
	pop() {
		const top = this.state[0]
		const last = this.f.length - 1
		this.swap(0, last)
		this.f.pop()
		this.n.pop()
		this.state.pop()
		let i = 0
		for (;;) {
			const l = 2 * i + 1
			const r = l + 1
			let m = i
			if (l < last && this.before(l, m)) m = l
			if (r < last && this.before(r, m)) m = r
			if (m === i) break
			this.swap(i, m)
			i = m
		}
		return top
	}
}

// Shortest orthogonal path from ``s`` (leaving along ``out``) to ``e`` (arriving along ``into``,
// both direction indexes) over the lines that run round the steps: the four sides of every
// obstacle grown by ``margin`` (plus a second lane beside a side another route already uses), the
// lines through the two ends and a frame round everything. Cost is length, plus BEND per turn,
// plus SHARE per unit that runs along another route. Returns the corner points from s to e, or
// null. ``budget.left`` counts the states that may still be expanded.
function searchPath(s, e, out, into, obstacles, blockers, margin, usage, budget) {
	// the lines, by value rounded to a thousandth; the first value given for a line is kept
	const xs = new Map()
	const ys = new Map()
	const key = (v) => Math.round(v * 1000)
	const addX = (v) => xs.has(key(v)) || xs.set(key(v), v)
	const addY = (v) => ys.has(key(v)) || ys.set(key(v), v)
	let fx0 = Math.min(s.x, e.x)
	let fy0 = Math.min(s.y, e.y)
	let fx1 = Math.max(s.x, e.x)
	let fy1 = Math.max(s.y, e.y)
	addX(s.x)
	addX(e.x)
	addY(s.y)
	addY(e.y)
	for (const { box } of obstacles) {
		const x0 = box.x - margin
		const x1 = box.x + box.w + margin
		const y0 = box.y - margin
		const y1 = box.y + box.h + margin
		fx0 = Math.min(fx0, x0)
		fy0 = Math.min(fy0, y0)
		fx1 = Math.max(fx1, x1)
		fy1 = Math.max(fy1, y1)
		addX(x0)
		addX(x1)
		addY(y0)
		addY(y1)
		// a second lane beside a side that another route already runs along, away from the step
		if (spansNear(usage.v, x0).length) addX(x0 - LANE_SPACING)
		if (spansNear(usage.v, x1).length) addX(x1 + LANE_SPACING)
		if (spansNear(usage.h, y0).length) addY(y0 - LANE_SPACING)
		if (spansNear(usage.h, y1).length) addY(y1 + LANE_SPACING)
	}
	addX(fx0 - AROUND)
	addX(fx1 + AROUND)
	addY(fy0 - AROUND)
	addY(fy1 + AROUND)

	const xl = [...xs.values()].sort((a, b) => a - b)
	const yl = [...ys.values()].sort((a, b) => a - b)
	const NX = xl.length
	const NY = yl.length
	const xi = new Map(xl.map((v, i) => [key(v), i]))
	const yi = new Map(yl.map((v, i) => [key(v), i]))
	const cells = NX * NY
	ensureScratch(cells * 4)
	budget.left -= 50 + (cells >> 4) // building the lines costs a little too

	// Which pieces between neighbouring lines run through the inside of a step (any step that
	// reaches the lines, not only the ones the lines come from).
	const hBlock = new Uint8Array(cells)
	const vBlock = new Uint8Array(cells)
	const below = (list, v) => {
		// the first index whose line is at or beyond v
		let lo = 0
		let hi = list.length
		while (lo < hi) {
			const mid = (lo + hi) >> 1
			if (list[mid] < v) lo = mid + 1
			else hi = mid
		}
		return lo
	}
	const frame = { x0: xl[0], x1: xl[NX - 1], y0: yl[0], y1: yl[NY - 1] }
	for (const { box } of blockers) {
		const X0 = box.x - margin
		const X1 = box.x + box.w + margin
		const Y0 = box.y - margin
		const Y1 = box.y + box.h + margin
		if (X1 <= frame.x0 || X0 >= frame.x1 || Y1 <= frame.y0 || Y0 >= frame.y1) continue
		// the lines strictly inside the step, and the pieces whose span meets its inside
		const T = 1e-6
		const xa = Math.max(0, below(xl, X0 + T) - 1)
		const xb = Math.min(NX - 1, below(xl, X1 - T))
		const ya = Math.max(0, below(yl, Y0 + T) - 1)
		const yb = Math.min(NY - 1, below(yl, Y1 - T))
		const xFrom = below(xl, X0 + 2 * T)
		const xTo = below(xl, X1 - T)
		const yFrom = below(yl, Y0 + 2 * T)
		const yTo = below(yl, Y1 - T)
		for (let y = yFrom; y < yTo; y++) for (let x = xa; x < xb; x++) hBlock[y * NX + x] = 1
		for (let x = xFrom; x < xTo; x++) for (let y = ya; y < yb; y++) vBlock[y * NX + x] = 1
	}

	// Extra cost of the pieces that run along a route that is already there: the spans near each
	// line are merged once, the first time the line is looked at.
	const hSpans = new Array(NY)
	const vSpans = new Array(NX)
	const merged = (map, coord) => {
		const list = spansNear(map, coord).sort((a, b) => a[0] - b[0])
		const result = []
		for (const [from, to] of list) {
			const last = result[result.length - 1]
			if (last && from <= last[1]) last[1] = Math.max(last[1], to)
			else result.push([from, to])
		}
		return result
	}
	const shareOf = (vertical, line, a, b) => {
		const spans = vertical
			? (vSpans[line] ??= merged(usage.v, xl[line]))
			: (hSpans[line] ??= merged(usage.h, yl[line]))
		let sum = 0
		for (const [from, to] of spans) {
			if (from >= b) break
			if (to > a) sum += Math.min(b, to) - Math.max(a, from)
		}
		return SHARE * sum
	}
	const crowded = usage.h.size > 0 || usage.v.size > 0

	const sx = xi.get(key(s.x))
	const sy = yi.get(key(s.y))
	const ex = xi.get(key(e.x))
	const ey = yi.get(key(e.y))
	const goal = ey * NX + ex
	const { g, parent, stamp, closed } = scratch
	const round = ++scratch.round
	// at least the distance, and one turn unless the goal lies straight ahead
	const heuristic = (x, y) => {
		const dx = Math.abs(xl[x] - e.x)
		const dy = Math.abs(yl[y] - e.y)
		return HASTE * (dx + dy + (dx > 0 && dy > 0 ? BEND : 0))
	}
	const heap = new Heap()
	let seq = 0
	const start = (sy * NX + sx) * 4 + out
	stamp[start] = round
	g[start] = 0
	parent[start] = -1
	heap.push(heuristic(sx, sy), seq++, start)
	let found = -1
	let expanded = 0
	while (heap.size) {
		const state = heap.pop()
		if (closed[state] === round) continue
		closed[state] = round
		const d = state & 3
		const cell = state >> 2
		const cx = cell % NX
		const cy = (cell - cx) / NX
		if (cell === goal && d !== (into + 2) % 4) {
			found = state
			break
		}
		if (++expanded > MAX_EXPANSIONS || --budget.left < 0) return null
		for (let nd = 0; nd < 4; nd++) {
			if (nd === (d + 2) % 4) continue
			const nx = cx + DX[nd]
			const ny = cy + DY[nd]
			if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue
			// the piece between the two cells: stored at its left or upper end
			const lo = nd === 0 ? cell : nd === 1 ? cell : nd === 2 ? cell - 1 : cell - NX
			if ((nd & 1 ? vBlock : hBlock)[lo]) continue
			const length = nd & 1 ? Math.abs(yl[ny] - yl[cy]) : Math.abs(xl[nx] - xl[cx])
			let cost = length
			if (crowded) {
				cost +=
					nd & 1
						? shareOf(true, cx, Math.min(yl[ny], yl[cy]), Math.max(yl[ny], yl[cy]))
						: shareOf(false, cy, Math.min(xl[nx], xl[cx]), Math.max(xl[nx], xl[cx]))
			}
			if (nd !== d) cost += BEND
			const next = (ny * NX + nx) * 4 + nd
			if (ny * NX + nx === goal && nd !== into) cost += BEND
			const total = g[state] + cost
			if (stamp[next] === round && g[next] <= total) continue
			stamp[next] = round
			g[next] = total
			parent[next] = state
			heap.push(total + heuristic(nx, ny), seq++, next)
		}
	}
	if (found < 0) return null
	const corners = []
	for (let state = found; state >= 0; state = parent[state]) {
		const cell = state >> 2
		const cx = cell % NX
		corners.push({ x: xl[cx], y: yl[(cell - cx) / NX] })
	}
	return corners.reverse()
}

// A route from p0 to p1 that keeps ``margin`` away from every obstacle, or null. The stubs start
// where ``plan`` put them (a diamond's may be longer so that they end outside its box).
function searchRoute(p0, p1, out, enter, ends, obstacles, usage, budget) {
	const o = DIR[out]
	const en = DIR[enter]
	const into = { x: -en.x, y: -en.y }
	const reach = (p, d, box, margin) => {
		// how far to go from the port along d to be ``margin`` beyond the box
		const past =
			d.x > 0
				? box.x + box.w - p.x
				: d.x < 0
					? p.x - box.x
					: d.y > 0
						? box.y + box.h - p.y
						: p.y - box.y
		return Math.max(STUB, Math.max(0, past) + margin + 0.5)
	}
	const [boxA, boxB] = ends
	for (const { margin, reach: R, steps } of ATTEMPTS) {
		const la = reach(p0, o, boxA.box, margin)
		const lb = reach(p1, en, boxB.box, margin)
		const s = { x: p0.x + o.x * la, y: p0.y + o.y * la }
		const e = { x: p1.x + en.x * lb, y: p1.y + en.y * lb }
		const xmin = Math.min(s.x, e.x)
		const xmax = Math.max(s.x, e.x)
		const ymin = Math.min(s.y, e.y)
		const ymax = Math.max(s.y, e.y)
		const near = obstacles.filter(({ box: b }) => {
			return (
				b.x - margin < xmax + R &&
				b.x + b.w + margin > xmin - R &&
				b.y - margin < ymax + R &&
				b.y + b.h + margin > ymin - R
			)
		})
		let chosen = near
		if (near.length > steps) {
			const cx = (xmin + xmax) / 2
			const cy = (ymin + ymax) / 2
			const score = (ob) =>
				ob === boxA || ob === boxB
					? -1
					: Math.abs(ob.box.x + ob.box.w / 2 - cx) +
						Math.abs(ob.box.y + ob.box.h / 2 - cy)
			chosen = [...near]
				.sort((a, b) => score(a) - score(b) || (a.id < b.id ? -1 : 1))
				.slice(0, steps)
		}
		if (budget.left <= 0) return null
		const corners = searchPath(
			s,
			e,
			dirIndex(o),
			dirIndex(into),
			chosen,
			obstacles,
			margin,
			usage,
			budget,
		)
		if (!corners) continue
		const points = clean([p0, ...corners, p1])
		if (sound(points, o, into) && !blocked(points, ends[0].id, ends[1].id, obstacles, 1))
			return points
	}
	return null
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

	// The planned routes; one that passes through another step is searched again, in edge order,
	// keeping off the routes that are already there.
	const finals = plans.map((p) => (p.lane ? p.build(p.lane.coord) : p.build()))
	const obstacles = solid.map(({ id, box }) => ({ id, box }))
	const obstacleOf = new Map(obstacles.map((o) => [o.id, o]))
	const usage = newUsage()
	const retry = []
	finals.forEach((points, i) => {
		const { edge } = plans[i]
		if (blocked(points, edge.from, edge.to, obstacles, TOLERANCE)) retry.push(i)
		else addUsage(usage, points)
	})
	const budget = { left: BASE_WORK + Math.max(0, SMALL_CHART - nodes.length) * 250 }
	for (const i of retry) {
		const p = plans[i]
		const found =
			budget.left > 0 &&
			searchRoute(
				p.p0,
				p.p1,
				p.out,
				p.into,
				[obstacleOf.get(p.edge.from), obstacleOf.get(p.edge.to)],
				obstacles,
				usage,
				budget,
			)
		if (found) finals[i] = found
		addUsage(usage, finals[i])
	}

	const routes = new Map()
	plans.forEach((p, i) => {
		const points = finals[i]
		const n = points.length
		routes.set(p.edge.id, {
			points,
			fromSide: p.out,
			toSide: p.into,
			label: labelPoint(points),
			startDir: unit(points[0], points[1]),
			endDir: unit(points[n - 2], points[n - 1]),
		})
	})
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
