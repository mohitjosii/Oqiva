// How a mind map is drawn, as plain data (see nodes.js): the curved branches in each branch's
// colour, the nodes, their markers, collapse badges and notes, and the dotted cross-links. The
// editor and export both use this, so what is exported is what is on screen.

import { iconData } from "../model/icons"
import { shade, branchColor, textColorFor } from "../modes/mindmap/colors"
import { MARKER_ROOM, wrapNodeText } from "../modes/mindmap/layout"
import { el, FONT, textNodes, txt } from "./nodes"

const ACCENT = "#2563eb"
const ROOT_FILL = "#334155"
const FONT_SIZE = 16
const ROOT_FONT_SIZE = 20
const LINE_HEIGHT = 1.35
const PAD_X = 14

const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

// Where a branch leaves the parent and enters the child.
function branchEnds(parent, child) {
	const right = child.side !== "left"
	const p =
		parent.side === "root"
			? right
				? parent.x + parent.w
				: parent.x
			: right
				? parent.x + parent.w
				: parent.x
	const c = right ? child.x : child.x + child.w
	return { x1: p, y1: parent.y + parent.h / 2, x2: c, y2: child.y + child.h / 2 }
}

function branchPath({ x1, y1, x2, y2 }) {
	const dx = (x2 - x1) / 2
	return `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
}

// The nearest sides of two boxes, for a cross-link between them.
function linkEnds(a, b) {
	const ca = centre(a)
	const cb = centre(b)
	const horizontal = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y)
	if (horizontal) {
		const rightward = cb.x >= ca.x
		return {
			p0: { x: rightward ? a.x + a.w : a.x, y: ca.y },
			p1: { x: rightward ? b.x : b.x + b.w, y: cb.y },
			d: { x: rightward ? 1 : -1, y: 0 },
		}
	}
	const downward = cb.y >= ca.y
	return {
		p0: { x: ca.x, y: downward ? a.y + a.h : a.y },
		p1: { x: cb.x, y: downward ? b.y : b.y + b.h },
		d: { x: 0, y: downward ? 1 : -1 },
	}
}

function nodeAppearance(node, nodes, box) {
	const isRoot = box.depth === 0
	const base = branchColor(nodes, node.id)
	if (isRoot)
		return {
			fill: node.color || ROOT_FILL,
			stroke: "none",
			text: textColorFor(node.color || ROOT_FILL),
			size: node.fontSize || ROOT_FONT_SIZE,
		}
	if (box.depth === 1)
		return {
			fill: base,
			stroke: "none",
			text: textColorFor(base),
			size: node.fontSize || FONT_SIZE,
		}
	const tint = shade(base, box.depth)
	return { fill: tint, stroke: base, text: "#1F2937", size: node.fontSize || FONT_SIZE }
}

// ``layout``: {map, nodes, boxes}. ``ctx``: {measure, detail, selected: Set, editingId, focus: Set|null,
// crosslinks, drag: {id, point, target}|null, offset: {dx, dy}|null, interactive}.
export function mapScene(layout, crosslinks, ctx) {
	const { map, nodes, boxes } = layout
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const kids = new Map()
	for (const n of nodes) {
		if (n.parentId) kids.set(n.parentId, (kids.get(n.parentId) || 0) + 1)
	}
	const dim = (id) => (ctx.focus && !ctx.focus.has(id) ? 0.22 : 1)
	const branches = []
	const shapes = []
	const extras = []
	for (const node of nodes) {
		const box = boxes.get(node.id)
		if (!box) continue
		const parentBox = node.parentId ? boxes.get(node.parentId) : null
		if (parentBox) {
			const color = branchColor(nodes, node.id)
			branches.push(
				el("path", {
					d: branchPath(branchEnds(parentBox, box)),
					fill: "none",
					stroke: color,
					"stroke-width": Math.max(2, 5 - box.depth),
					"stroke-linecap": "round",
					opacity: dim(node.id),
				}),
			)
		}
		const look = nodeAppearance(node, nodes, box)
		const selected = ctx.selected.has(node.id)
		const children = [
			el("rect", {
				x: box.x,
				y: box.y,
				width: box.w,
				height: box.h,
				rx: box.depth === 0 ? 14 : 10,
				fill: look.fill,
				stroke: selected ? ACCENT : look.stroke,
				"stroke-width": selected ? 3 : 2,
			}),
		]
		if (node.note) children.push(el("title", {}, [txt(node.note)]))
		const hasMarker = Boolean(node.marker && (node.marker.icon || node.marker.dot))
		const textX = box.x + PAD_X + (hasMarker ? MARKER_ROOM : 0)
		const width = box.w - PAD_X * 2 - (hasMarker ? MARKER_ROOM : 0)
		if (ctx.detail && node.id !== ctx.editingId && node.text) {
			const lines = wrapNodeText(node.text, look.size, ctx.measure, width)
			const lineHeight = look.size * LINE_HEIGHT
			const top = box.y + (box.h - lines.length * lineHeight) / 2
			children.push(
				...textNodes(
					{ lines: lines.map((t) => ({ runs: [{ t }] })), lineHeight },
					{ align: "left", size: look.size, color: look.text },
					{ x: textX, width, top },
				),
			)
		}
		if (hasMarker && ctx.detail) {
			const cx = box.x + PAD_X + 8
			const cy = box.y + box.h / 2
			if (node.marker.dot)
				children.push(
					el("circle", {
						cx,
						cy: node.marker.icon ? cy + 9 : cy,
						r: node.marker.icon ? 3.5 : 6,
						fill: node.marker.dot,
						stroke: "#ffffff",
						"stroke-width": 1.5,
					}),
				)
			const data = node.marker.icon ? iconData(node.marker.icon) : null
			if (data)
				children.push(
					el(
						"g",
						{
							transform: `translate(${cx - 8} ${cy - 11}) scale(${16 / 24})`,
							fill: "none",
							stroke: look.text,
							"stroke-width": 2.2,
							"stroke-linecap": "round",
							"stroke-linejoin": "round",
						},
						data.shapes.map(([tag, attrs]) => el(tag, attrs)),
					),
				)
		}
		if (node.note && ctx.detail) {
			children.push(
				el("circle", {
					cx: box.x + box.w - 6,
					cy: box.y + 6,
					r: 3.5,
					fill: "#FACC15",
					stroke: "#ffffff",
					"stroke-width": 1,
				}),
			)
		}
		shapes.push(el("g", { opacity: dim(node.id), "data-mmnode": node.id }, children))

		// the collapse badge, and a toggle on a selected parent
		const count = kids.get(node.id) || 0
		if (count && box.depth >= 0) {
			const right = box.side !== "left"
			const bx = right ? box.x + box.w + 12 : box.x - 12
			const by = box.y + box.h / 2
			if (node.collapsed) {
				const hidden = hiddenCount(node.id, byId, kids)
				extras.push(
					el(
						"g",
						{
							"data-mmtoggle": node.id,
							style: "cursor: pointer",
							"pointer-events": "all",
							opacity: dim(node.id),
						},
						[
							el("circle", {
								cx: bx,
								cy: by,
								r: 10,
								fill: "#ffffff",
								stroke: branchColor(nodes, node.id),
								"stroke-width": 2,
							}),
							el(
								"text",
								{
									x: bx,
									y: by,
									"text-anchor": "middle",
									"dominant-baseline": "central",
									"font-size": 11,
									"font-weight": 600,
									"font-family": FONT,
									fill: "#334155",
									"pointer-events": "none",
								},
								[txt(hidden > 99 ? "99+" : hidden)],
							),
						],
					),
				)
			} else if (selected && ctx.interactive) {
				extras.push(
					el(
						"g",
						{
							"data-mmtoggle": node.id,
							style: "cursor: pointer",
							"pointer-events": "all",
						},
						[
							el("circle", {
								cx: bx,
								cy: by,
								r: 9,
								fill: "#ffffff",
								stroke: ACCENT,
								"stroke-width": 1.5,
							}),
							el("path", {
								d: `M${bx - 4} ${by} L${bx + 4} ${by}`,
								stroke: ACCENT,
								"stroke-width": 2,
								"stroke-linecap": "round",
								"pointer-events": "none",
							}),
						],
					),
				)
			}
		}
		// the "+" of a selected node: one click adds a child (for a screen with no Tab key)
		if (selected && ctx.interactive && ctx.selected.size === 1 && !node.collapsed) {
			const right = box.side !== "left"
			const ax = (right ? box.x + box.w : box.x) + (right ? 1 : -1) * (count ? 34 : 14)
			const ay = box.y + box.h / 2
			extras.push(
				el(
					"g",
					{ "data-mmadd": node.id, style: "cursor: pointer", "pointer-events": "all" },
					[
						el("circle", { cx: ax, cy: ay, r: 10, fill: ACCENT }),
						el("path", {
							d: `M${ax - 5} ${ay} L${ax + 5} ${ay} M${ax} ${ay - 5} L${ax} ${ay + 5}`,
							stroke: "#ffffff",
							"stroke-width": 2,
							"stroke-linecap": "round",
							"pointer-events": "none",
						}),
					],
				),
			)
		}
	}
	// dotted cross-links with an optional label
	const links = []
	const linkLabels = [] // drawn above the nodes, so a label is never hidden behind one
	for (const link of crosslinks) {
		const a = boxes.get(link.from)
		const b = boxes.get(link.to)
		if (!a || !b) continue
		const { p0, p1, d } = linkEnds(a, b)
		const reach = Math.max(40, Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.35)
		const c1 = { x: p0.x + d.x * reach, y: p0.y + d.y * reach }
		const c2 = { x: p1.x - d.x * reach, y: p1.y - d.y * reach }
		links.push(
			el("path", {
				d: `M${p0.x} ${p0.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p1.x} ${p1.y}`,
				fill: "none",
				stroke: "#64748B",
				"stroke-width": 2,
				"stroke-dasharray": "2 5",
				"stroke-linecap": "round",
				opacity: Math.min(dim(link.from), dim(link.to)),
			}),
		)
		if (link.label && ctx.detail) {
			const mx = (p0.x + 3 * c1.x + 3 * c2.x + p1.x) / 8
			const my = (p0.y + 3 * c1.y + 3 * c2.y + p1.y) / 8
			const w = ctx.measure(link.label, 12) + 14
			linkLabels.push(
				el("rect", {
					x: mx - w / 2,
					y: my - 10,
					width: w,
					height: 20,
					rx: 10,
					fill: ctx.background || "#ffffff",
				}),
				el(
					"text",
					{
						x: mx,
						y: my,
						"text-anchor": "middle",
						"dominant-baseline": "central",
						"font-size": 12,
						"font-family": FONT,
						fill: "#475569",
					},
					[txt(link.label)],
				),
			)
		}
	}
	// drag feedback
	const feedback = []
	if (ctx.drag && ctx.drag.target) {
		const t = boxes.get(ctx.drag.target.id)
		if (t && ctx.drag.target.type === "into")
			feedback.push(
				el("rect", {
					x: t.x - 4,
					y: t.y - 4,
					width: t.w + 8,
					height: t.h + 8,
					rx: 12,
					fill: ACCENT,
					"fill-opacity": 0.12,
					stroke: ACCENT,
					"stroke-width": 2,
					"stroke-dasharray": "5 4",
				}),
			)
		else if (t)
			feedback.push(
				el("path", {
					d: `M${t.x} ${ctx.drag.target.type === "before" ? t.y - 7 : t.y + t.h + 7} L${t.x + t.w} ${ctx.drag.target.type === "before" ? t.y - 7 : t.y + t.h + 7}`,
					stroke: ACCENT,
					"stroke-width": 4,
					"stroke-linecap": "round",
				}),
			)
	}
	const attrs = { "data-mindmap": map.id }
	if (ctx.offset) attrs.transform = `translate(${ctx.offset.dx} ${ctx.offset.dy})`
	return el("g", attrs, [...links, ...branches, ...shapes, ...linkLabels, ...feedback, ...extras])
}

function hiddenCount(id, byId, kids) {
	// every descendant of a collapsed node
	let total = 0
	const stack = [id]
	const children = new Map()
	for (const n of byId.values()) {
		if (n.parentId) {
			if (!children.has(n.parentId)) children.set(n.parentId, [])
			children.get(n.parentId).push(n.id)
		}
	}
	while (stack.length) {
		for (const child of children.get(stack.pop()) || []) {
			total++
			stack.push(child)
		}
	}
	void kids
	return total
}
