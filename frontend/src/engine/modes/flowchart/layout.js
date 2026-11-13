// Pure layout for the flowchart mode: a layered layout (Tidy up), where a new node goes, how far a
// chart shifts when a node is spliced in, and the box of a chart. No DOM, no store: every function
// takes the records of ONE chart and returns new values.
//
// Directions: "TB" ranks go downward (y grows), "LR" ranks go rightward (x grows). "Along" is the
// flow axis, "across" the other one. Across, positive means right for TB and down for LR: that is
// where a decision's second output goes (see routing.js, which leaves by the matching side).

import { GAPS, TYPE_INFO, nodeSize } from "./model"

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || byId(a, b)

const COMPONENT_GAP = GAPS.across * 2
const SWEEPS = 4 // barycenter sweeps (each is one down and one up)
const PASSES = 6 // coordinate passes (each is one up and one down)
const DECISION_WEIGHT = 4 // how hard a decision pulls its outputs into their slots
const SLOT_EPSILON = 1e-4 // breaks ties between the outputs of one decision when ordering
const CLEARANCE = 16 // closest a placed node may come to another one

// Edges that point backwards, found with an iterative depth-first search that starts at the
// sources (nodes with no incoming edge) and then at any node left over, by id. An edge into a node
// that is still on the search stack closes a cycle; a self reference always counts.
export function backEdgeIds(chart, nodes, edges) {
	const known = new Set(nodes.map((n) => n.id))
	const back = new Set()
	const out = new Map()
	const hasIn = new Set()
	for (const edge of [...edges].sort(byOrder)) {
		if (!known.has(edge.from) || !known.has(edge.to)) continue
		if (edge.from === edge.to) {
			back.add(edge.id)
			continue
		}
		if (!out.has(edge.from)) out.set(edge.from, [])
		out.get(edge.from).push(edge)
		hasIn.add(edge.to)
	}
	const ids = nodes.map((n) => n.id).sort()
	const state = new Map() // 1 = on the stack, 2 = finished
	for (const root of [...ids.filter((id) => !hasIn.has(id)), ...ids]) {
		if (state.has(root)) continue
		state.set(root, 1)
		const stack = [[root, 0]]
		while (stack.length) {
			const frame = stack[stack.length - 1]
			const list = out.get(frame[0]) ?? []
			if (frame[1] >= list.length) {
				state.set(frame[0], 2)
				stack.pop()
				continue
			}
			const edge = list[frame[1]++]
			const seen = state.get(edge.to)
			if (seen === 1) back.add(edge.id)
			else if (!seen) {
				state.set(edge.to, 1)
				stack.push([edge.to, 0])
			}
		}
	}
	return back
}

// The forward edges (no back-edges, no dangling ones) grouped by node, each list by (order, id).
function forwardGraph(chart, nodes, edges) {
	const back = backEdgeIds(chart, nodes, edges)
	const out = new Map(nodes.map((n) => [n.id, []]))
	const into = new Map(nodes.map((n) => [n.id, []]))
	for (const edge of [...edges].sort(byOrder)) {
		if (back.has(edge.id) || !out.has(edge.from) || !into.has(edge.to)) continue
		out.get(edge.from).push(edge)
		into.get(edge.to).push(edge)
	}
	return { back, out, into }
}

// The targets of a node's outputs, each once, in (order, id) of the output.
const targetsOf = (outEdges) => [...new Set(outEdges.map((e) => e.to))]

// Puts the first output in the middle, the second to its right, the third to its left, and so on:
// [o5, o3, o1, o2, o4].
function balanced(list) {
	const result = []
	list.forEach((item, i) => {
		if (i === 0 || i % 2 === 1) result.push(item)
		else result.unshift(item)
	})
	return result
}

// Where each output of a decision sits across the flow, as a whole number of slots from the first.
const slotIndex = (i) => (i === 0 ? 0 : i % 2 === 1 ? (i + 1) / 2 : -i / 2)

// Places ordered items as close as possible to their desired centres without overlapping: clusters
// of items that collide are merged and put at their weighted mean (the classic compaction used by
// layered layouts). ``items`` are {d: desired centre, q: weight, w: width}; returns the centres.
function pack(items, gap) {
	const clusters = []
	items.forEach((item, i) => {
		clusters.push({
			from: i,
			to: i,
			q: item.q,
			sum: item.q * (item.d - item.w / 2),
			len: item.w,
		})
		while (clusters.length > 1) {
			const cur = clusters[clusters.length - 1]
			const prev = clusters[clusters.length - 2]
			if (prev.sum / prev.q + prev.len + gap <= cur.sum / cur.q + 1e-9) break
			prev.sum += cur.sum - cur.q * (prev.len + gap)
			prev.q += cur.q
			prev.len += gap + cur.len
			prev.to = cur.to
			clusters.pop()
		}
	})
	const centres = new Array(items.length)
	for (const c of clusters) {
		let left = c.sum / c.q
		for (let i = c.from; i <= c.to; i++) {
			centres[i] = left + items[i].w / 2
			left += items[i].w + gap
		}
	}
	return centres
}

// Lays out one connected component: ranks, order inside the ranks, then coordinates. Returns
// Map<id, {along, cross}> with the flow starting at 0 and the cross coordinates centred on 0.
function layoutComponent(members, graph, size, types) {
	const { out, into } = graph
	// Ranks: the longest path from the sources over forward edges.
	const rank = new Map()
	const indegree = new Map()
	const queue = []
	for (const id of members) {
		indegree.set(id, into.get(id).length)
		if (!indegree.get(id)) {
			rank.set(id, 0)
			queue.push(id)
		}
	}
	for (let head = 0; head < queue.length; head++) {
		const u = queue[head]
		for (const edge of out.get(u)) {
			rank.set(edge.to, Math.max(rank.get(edge.to) ?? 0, rank.get(u) + 1))
			indegree.set(edge.to, indegree.get(edge.to) - 1)
			if (!indegree.get(edge.to)) queue.push(edge.to)
		}
	}
	for (const id of members) if (!rank.has(id)) rank.set(id, 0) // cannot happen: back-edges are cut
	const rankCount = Math.max(...rank.values()) + 1

	// Slots of the outputs of every decision.
	const slots = new Map() // decisionId -> Map<targetId, slot index>
	const offsets = new Map() // decisionId -> Map<targetId, distance across from the decision>
	for (const id of members) {
		if (types.get(id) !== "decision") continue
		const targets = targetsOf(out.get(id))
		if (targets.length < 2) continue
		slots.set(id, new Map(targets.map((t, i) => [t, slotIndex(i)])))
		const offs = new Map([[targets[0], 0]])
		let right = size.get(targets[0]).cross / 2
		let left = -right
		targets.forEach((t, i) => {
			if (i === 0) return
			const c = size.get(t).cross
			if (i % 2 === 1) {
				offs.set(t, right + GAPS.across + c / 2)
				right += GAPS.across + c
			} else {
				offs.set(t, left - GAPS.across - c / 2)
				left -= GAPS.across + c
			}
		})
		offsets.set(id, offs)
	}
	const slotOf = (edge) => slots.get(edge.from)?.get(edge.to) ?? 0
	const offsetOf = (edge) => offsets.get(edge.from)?.get(edge.to) ?? 0
	const weightOf = (edge) => (types.get(edge.from) === "decision" ? DECISION_WEIGHT : 1)

	// Initial order: sources by id, then each rank follows the order of its parents' outputs.
	const lists = Array.from({ length: rankCount }, () => [])
	const placed = new Set()
	for (const id of members) {
		if (rank.get(id) === 0 && !into.get(id).length) {
			lists[0].push(id)
			placed.add(id)
		}
	}
	for (let r = 0; r < rankCount; r++) {
		for (const id of lists[r]) {
			let targets = targetsOf(out.get(id))
			if (types.get(id) === "decision" && targets.length > 1) targets = balanced(targets)
			for (const t of targets) {
				if (placed.has(t)) continue
				placed.add(t)
				lists[rank.get(t)].push(t)
			}
		}
	}
	for (const id of members) if (!placed.has(id)) lists[rank.get(id)].push(id)

	// Fewer crossings: barycenter sweeps.
	const pos = new Map()
	const reindex = (r) => lists[r].forEach((id, i) => pos.set(id, i))
	lists.forEach((_, r) => reindex(r))
	const norm = (id) => (pos.get(id) + 0.5) / lists[rank.get(id)].length
	const sortRank = (r, downward) => {
		const keyed = lists[r].map((id, i) => {
			const edges = downward ? into.get(id) : out.get(id)
			if (!edges.length) return { id, i, key: (i + 0.5) / lists[r].length }
			let sum = 0
			for (const edge of edges) {
				sum +=
					norm(downward ? edge.from : edge.to) +
					(downward ? slotOf(edge) * SLOT_EPSILON : 0)
			}
			return { id, i, key: sum / edges.length }
		})
		keyed.sort((a, b) => a.key - b.key || a.i - b.i)
		lists[r] = keyed.map((k) => k.id)
		reindex(r)
	}
	if (rankCount > 1) {
		for (let s = 0; s < SWEEPS; s++) {
			for (let r = 1; r < rankCount; r++) sortRank(r, true)
			for (let r = rankCount - 2; r >= 0; r--) sortRank(r, false)
		}
	}
	// A decision's outputs keep their slots (first in the middle, then right, left, ...): swap
	// them among the places they already hold.
	for (const [id, slotMap] of slots) {
		const r = rank.get(id) + 1
		const mine = [...slotMap.keys()].filter((t) => rank.get(t) === r)
		if (mine.length < 2) continue
		const want = balanced(mine)
		const places = mine.map((t) => pos.get(t)).sort((a, b) => a - b)
		if (want.every((t, i) => pos.get(t) === places[i])) continue
		want.forEach((t, i) => (lists[r][places[i]] = t))
		reindex(r)
	}

	// Along the flow: each rank as far from the previous as its biggest node plus the gap.
	const along = new Map()
	let cursor = 0
	lists.forEach((list) => {
		const extent = Math.max(...list.map((id) => size.get(id).along))
		for (const id of list) along.set(id, cursor + extent / 2)
		cursor += extent + GAPS.along
	})

	// Across the flow: start packed, then pull every node toward its neighbours (down, then up)
	// without ever overlapping; the last pass goes down so outputs follow their parent.
	const cross = new Map()
	for (const list of lists) {
		const total = list.reduce((sum, id) => sum + size.get(id).cross + GAPS.across, -GAPS.across)
		let left = -total / 2
		for (const id of list) {
			cross.set(id, left + size.get(id).cross / 2)
			left += size.get(id).cross + GAPS.across
		}
	}
	const pass = (r, downward) => {
		const list = lists[r]
		const items = list.map((id) => {
			const w = size.get(id).cross
			const edges = downward ? into.get(id) : out.get(id)
			if (!edges.length) return { d: cross.get(id), q: 1, w }
			let sum = 0
			let q = 0
			for (const edge of edges) {
				const weight = weightOf(edge)
				const offset = offsetOf(edge)
				sum +=
					weight *
					(downward ? cross.get(edge.from) + offset : cross.get(edge.to) - offset)
				q += weight
			}
			return { d: sum / q, q, w }
		})
		const centres = pack(items, GAPS.across)
		list.forEach((id, i) => cross.set(id, centres[i]))
	}
	if (rankCount > 1 || lists[0].length > 1) {
		for (let p = 0; p < PASSES; p++) {
			for (let r = rankCount - 1; r >= 0; r--) pass(r, false)
			for (let r = 0; r < rankCount; r++) pass(r, true)
		}
	}
	return new Map(members.map((id) => [id, { along: along.get(id), cross: cross.get(id) }]))
}

// Positions for ALL nodes of a chart (centres): a layered layout that follows the chart's
// direction. The top-left of the chart's bounding box stays where it is now.
export function tidyLayout(chart, nodes, edges, measure) {
	const result = new Map()
	if (!nodes.length) return result
	const horizontal = chart.direction === "LR"
	const graph = forwardGraph(chart, nodes, edges)
	const sorted = [...nodes].sort(byId)
	const size = new Map()
	const types = new Map()
	for (const node of sorted) {
		const s = nodeSize(node, measure)
		size.set(node.id, {
			w: s.w,
			h: s.h,
			along: horizontal ? s.w : s.h,
			cross: horizontal ? s.h : s.w,
		})
		types.set(node.id, node.type)
	}

	// Connected components (an edge of any kind joins two nodes), ordered by their first id.
	const parent = new Map(sorted.map((n) => [n.id, n.id]))
	const find = (id) => {
		let root = id
		while (parent.get(root) !== root) root = parent.get(root)
		while (parent.get(id) !== root) {
			const next = parent.get(id)
			parent.set(id, root)
			id = next
		}
		return root
	}
	for (const edge of edges) {
		if (!parent.has(edge.from) || !parent.has(edge.to)) continue
		const a = find(edge.from)
		const b = find(edge.to)
		if (a !== b) parent.set(a < b ? b : a, a < b ? a : b)
	}
	const components = new Map()
	for (const node of sorted) {
		const root = find(node.id)
		if (!components.has(root)) components.set(root, [])
		components.get(root).push(node.id)
	}

	const raw = new Map()
	let next = 0
	for (const members of components.values()) {
		const local = layoutComponent(members, graph, size, types)
		let low = Infinity
		let high = -Infinity
		for (const [id, p] of local) {
			low = Math.min(low, p.cross - size.get(id).cross / 2)
			high = Math.max(high, p.cross + size.get(id).cross / 2)
		}
		for (const [id, p] of local) raw.set(id, { along: p.along, cross: p.cross + next - low })
		next += high - low + COMPONENT_GAP
	}

	const centreOf = (id) => {
		const p = raw.get(id)
		return horizontal ? { x: p.along, y: p.cross } : { x: p.cross, y: p.along }
	}
	let left = Infinity
	let top = Infinity
	let oldLeft = Infinity
	let oldTop = Infinity
	for (const node of sorted) {
		const c = centreOf(node.id)
		const s = size.get(node.id)
		left = Math.min(left, c.x - s.w / 2)
		top = Math.min(top, c.y - s.h / 2)
		oldLeft = Math.min(oldLeft, node.x - s.w / 2)
		oldTop = Math.min(oldTop, node.y - s.h / 2)
	}
	const round = (v) => Math.round(v * 100) / 100
	for (const node of nodes) {
		const c = centreOf(node.id)
		result.set(node.id, { x: round(c.x + oldLeft - left), y: round(c.y + oldTop - top) })
	}
	return result
}

const boxOf = (node, size) => ({
	x: node.x - size.w / 2,
	y: node.y - size.h / 2,
	w: size.w,
	h: size.h,
})

const clashes = (a, b, margin = CLEARANCE) =>
	a.x < b.x + b.w + margin &&
	b.x < a.x + a.w + margin &&
	a.y < b.y + b.h + margin &&
	b.y < a.y + a.h + margin

const newSize = (type, measure) => nodeSize({ type, text: TYPE_INFO[type]?.text ?? "" }, measure)

// Where a new node goes when it will be connected FROM ``parentId``: one rank further along the
// flow, in the parent's column for the first output. Further outputs of a decision go to the
// right, left, further right, ... Anything in the way is dodged in whole steps across the flow.
export function placeChild(chart, nodes, edges, parentId, type, measure, { branch = null } = {}) {
	const parent = nodes.find((n) => n.id === parentId)
	if (!parent) return placeAt(nodes, { x: 0, y: 0 }, type, measure)
	const horizontal = chart.direction === "LR"
	const size = newSize(type, measure)
	const parentSize = nodeSize(parent, measure)
	const step = (horizontal ? size.h : size.w) + GAPS.across

	let index = 0
	if (parent.type === "decision") {
		if (branch == null) {
			const back = backEdgeIds(chart, nodes, edges)
			index = edges.filter((e) => e.from === parent.id && !back.has(e.id)).length
		} else index = Math.max(0, Math.floor(branch))
	}
	const base = slotIndex(index) * step

	const at = (offset) =>
		horizontal
			? {
					x: parent.x + parentSize.w / 2 + GAPS.along + size.w / 2,
					y: parent.y + offset,
				}
			: {
					x: parent.x + offset,
					y: parent.y + parentSize.h / 2 + GAPS.along + size.h / 2,
				}
	const others = nodes
		.filter((n) => n.id !== parent.id)
		.map((n) => boxOf(n, nodeSize(n, measure)))
	const free = (point) => {
		const box = boxOf(point, size)
		return !others.some((other) => clashes(box, other))
	}
	const direction = base >= 0 ? 1 : -1
	const candidates = [base]
	for (let m = 1; m <= nodes.length + 1; m++) {
		candidates.push(base + direction * m * step, base - direction * m * step)
	}
	for (const offset of candidates) {
		const point = at(offset)
		if (free(point)) return point
	}
	return at(base)
}

// A dropped point: the point itself (rounded), moved down past anything it would overlap.
export function placeAt(nodes, point, type, measure) {
	const size = newSize(type, measure)
	const boxes = nodes.map((n) => boxOf(n, nodeSize(n, measure)))
	const x = Math.round(point.x)
	let y = Math.round(point.y)
	for (let i = 0; i <= boxes.length; i++) {
		const box = boxOf({ x, y }, size)
		let lowest = null
		for (const other of boxes) {
			if (clashes(box, other) && (lowest === null || other.y + other.h > lowest))
				lowest = other.y + other.h
		}
		if (lowest === null) break
		y = Math.round(lowest + CLEARANCE + size.h / 2)
	}
	return { x, y }
}

// Patches that move every node reachable from ``startNodeIds`` (those included) forward along the
// flow by ``amount``. Back-edges are not followed, so a loop never drags the start of the chart.
export function shiftDownstream(chart, nodes, edges, startNodeIds, amount) {
	const { out } = forwardGraph(chart, nodes, edges)
	const reached = new Set()
	const stack = []
	for (const id of startNodeIds) {
		if (out.has(id) && !reached.has(id)) {
			reached.add(id)
			stack.push(id)
		}
	}
	while (stack.length) {
		const id = stack.pop()
		for (const edge of out.get(id)) {
			if (reached.has(edge.to)) continue
			reached.add(edge.to)
			stack.push(edge.to)
		}
	}
	const horizontal = chart.direction === "LR"
	return nodes
		.filter((n) => reached.has(n.id))
		.map((n) => ({
			id: n.id,
			patch: horizontal ? { x: n.x + amount, y: n.y } : { x: n.x, y: n.y + amount },
		}))
}

// {x, y, w, h} of every node box together, or null for an empty chart.
export function chartBounds(chart, nodes, measure) {
	if (!nodes.length) return null
	let left = Infinity
	let top = Infinity
	let right = -Infinity
	let bottom = -Infinity
	for (const node of nodes) {
		const box = boxOf(node, nodeSize(node, measure))
		left = Math.min(left, box.x)
		top = Math.min(top, box.y)
		right = Math.max(right, box.x + box.w)
		bottom = Math.max(bottom, box.y + box.h)
	}
	return { x: left, y: top, w: right - left, h: bottom - top }
}

// The centre for a new chart of ``size`` below ``bounds``, left edges aligned.
export function positionBelow(bounds, size = TYPE_INFO.terminator, gap = 80) {
	if (!bounds) return { x: 0, y: 0 }
	return { x: bounds.x + size.w / 2, y: bounds.y + bounds.h + gap + size.h / 2 }
}
