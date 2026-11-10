// Layout: where each visible node goes, worked out from the tree alone (positions are derived,
// never stored). One pass up to measure subtree heights and one pass down to place boxes, so it
// is O(n) and uses no recursion.

import { childrenMap, subtreeIds } from "./tree"

export const LAYOUT_DEFAULTS = {
	fontSize: 16,
	paddingX: 14,
	paddingY: 8,
	lineHeight: 1.35,
	gapX: 64, // parent's edge to child's edge
	gapY: 14, // between sibling subtrees
	rootFontSize: 20,
	maxWidth: 260,
	minWidth: 40,
}

// Splits a line at word breaks so each piece fits `inner`; a word that is too long on its own is
// cut by characters.
function wrapLine(line, measure, size, inner) {
	if (!line || measure(line, size) <= inner) return [line]
	const lines = []
	let current = ""
	for (const word of line.split(/\s+/).filter(Boolean)) {
		const candidate = current ? `${current} ${word}` : word
		if (measure(candidate, size) <= inner) {
			current = candidate
			continue
		}
		if (current) lines.push(current)
		current = word
		if (measure(word, size) > inner) {
			let piece = ""
			for (const ch of Array.from(word)) {
				if (piece && measure(piece + ch, size) > inner) {
					lines.push(piece)
					piece = ch
				} else piece += ch
			}
			current = piece
		}
	}
	if (current) lines.push(current)
	return lines.length ? lines : [""]
}

// The lines a node's text is drawn in: its own lines, each wrapped to fit ``inner`` pixels. The drawing
// uses this so it breaks lines exactly where the layout did when it sized the node.
export function wrapNodeText(text, size, measure, inner) {
	return String(text ?? "")
		.split("\n")
		.flatMap((line) => wrapLine(line, measure, size, Math.max(1, inner)))
}

// Room a node's marker takes at the left of its text.
export const MARKER_ROOM = 22
export const markerRoom = (node) =>
	node.marker && (node.marker.icon || node.marker.dot) ? MARKER_ROOM : 0

function boxSize(text, size, measure, o, extra = 0) {
	const inner = Math.max(1, o.maxWidth - 2 * o.paddingX - extra)
	const lines = String(text ?? "")
		.split("\n")
		.flatMap((line) => wrapLine(line, measure, size, inner))
	let widest = 0
	for (const line of lines) widest = Math.max(widest, measure(line, size))
	return {
		w: Math.min(o.maxWidth, Math.max(o.minWidth, widest + 2 * o.paddingX + extra)),
		h: lines.length * size * o.lineHeight + 2 * o.paddingY,
	}
}

const visibleChildren = (node, kids) => (node.collapsed ? [] : (kids.get(node.id) ?? []))

export function layoutMap(map, nodes, measure, options = {}) {
	const o = { ...LAYOUT_DEFAULTS, ...options }
	const origin = map.origin ?? { x: 0, y: 0 }
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const root = byId.get(map.rootId)
	const boxes = new Map()
	if (!root) return { boxes, bounds: { x: origin.x, y: origin.y, w: 0, h: 0 } }
	const kids = childrenMap(nodes)

	// Visible nodes in depth-first order (a parent always before its children), with side and
	// depth, and each node's own size.
	const pre = []
	const meta = new Map()
	meta.set(root.id, {
		side: "root",
		depth: 0,
		...boxSize(root.text, root.fontSize || o.rootFontSize, measure, o, markerRoom(root)),
	})
	const stack = [root.id]
	while (stack.length) {
		const id = stack.pop()
		pre.push(id)
		const node = byId.get(id)
		const info = meta.get(id)
		const children = visibleChildren(node, kids)
		children.forEach((child, i) => {
			const side =
				info.side === "root"
					? map.layout === "right" || i % 2 === 0
						? "right"
						: "left"
					: info.side
			meta.set(child.id, {
				side,
				depth: info.depth + 1,
				...boxSize(child.text, child.fontSize || o.fontSize, measure, o, markerRoom(child)),
			})
		})
		for (let i = children.length - 1; i >= 0; i--) stack.push(children[i].id)
	}

	// Height of each subtree (children stacked with gapY, or the node itself if taller), bottom up.
	const stackHeight = new Map() // total height of a node's children block
	const subtreeHeight = new Map()
	const blockOf = (children) =>
		children.reduce((sum, c) => sum + subtreeHeight.get(c.id), 0) +
		o.gapY * Math.max(0, children.length - 1)
	for (let i = pre.length - 1; i >= 0; i--) {
		const id = pre[i]
		const children = visibleChildren(byId.get(id), kids)
		const block = blockOf(children)
		stackHeight.set(id, block)
		subtreeHeight.set(id, Math.max(meta.get(id).h, block))
	}

	const top = new Map() // the top of each node's block
	const placeBlock = (children, start) => {
		let cursor = start
		for (const child of children) {
			top.set(child.id, cursor)
			cursor += subtreeHeight.get(child.id) + o.gapY
		}
	}

	const rootMeta = meta.get(root.id)
	boxes.set(root.id, {
		x: origin.x - rootMeta.w / 2,
		y: origin.y - rootMeta.h / 2,
		w: rootMeta.w,
		h: rootMeta.h,
		side: "root",
		depth: 0,
	})
	const rootChildren = visibleChildren(root, kids)
	for (const side of ["right", "left"]) {
		const list = rootChildren.filter((c) => meta.get(c.id).side === side)
		if (list.length) placeBlock(list, origin.y - blockOf(list) / 2)
	}

	for (const id of pre) {
		if (id === root.id) continue
		const node = byId.get(id)
		const { side, depth, w, h } = meta.get(id)
		const parent = boxes.get(node.parentId)
		const blockTop = top.get(id)
		const height = subtreeHeight.get(id)
		boxes.set(id, {
			x: side === "right" ? parent.x + parent.w + o.gapX : parent.x - o.gapX - w,
			y: blockTop + height / 2 - h / 2,
			w,
			h,
			side,
			depth,
		})
		const children = visibleChildren(node, kids)
		if (children.length) placeBlock(children, blockTop + (height - stackHeight.get(id)) / 2)
	}

	return { boxes, bounds: unionBounds(boxes.values()) }
}

function unionBounds(list) {
	let left = Infinity
	let topEdge = Infinity
	let right = -Infinity
	let bottom = -Infinity
	for (const b of list) {
		left = Math.min(left, b.x)
		topEdge = Math.min(topEdge, b.y)
		right = Math.max(right, b.x + b.w)
		bottom = Math.max(bottom, b.y + b.h)
	}
	if (left === Infinity) return null
	return { x: left, y: topEdge, w: right - left, h: bottom - topEdge }
}

// The ids that get a box: everything reachable from the root without passing a collapsed node's
// children. Depth first, in reading order.
export function visibleIds(map, nodes) {
	const kids = childrenMap(nodes)
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const root = byId.get(map.rootId)
	if (!root) return []
	const result = []
	const stack = [root.id]
	while (stack.length) {
		const id = stack.pop()
		result.push(id)
		const children = visibleChildren(byId.get(id), kids)
		for (let i = children.length - 1; i >= 0; i--) stack.push(children[i].id)
	}
	return result
}

// The rectangle around a node and its visible descendants, or null if none has a box.
export function subtreeBounds(boxes, nodes, id) {
	const list = subtreeIds(nodes, id)
		.map((nodeId) => boxes.get(nodeId))
		.filter(Boolean)
	return unionBounds(list)
}
