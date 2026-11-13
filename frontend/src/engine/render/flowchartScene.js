// How a flowchart is drawn, as plain data (see nodes.js): the routed arrows with their labels, the
// steps in their shapes, step numbers, and the handles of a selected step. The editor and export
// both use it, so an exported chart is the chart on screen.

import { fontSizeOf, wrapFlowText } from "../modes/flowchart/model"
import { outSides, portPoint } from "../modes/flowchart/routing"
import { el, FONT, headNode, textNodes, txt } from "./nodes"

const ACCENT = "#2563eb"
const LINE = "#475569"
const LINE_HEIGHT = 1.35

// Fill and outline of each step type.
const LOOK = {
	terminator: { fill: "#DCFCE7", stroke: "#16A34A" },
	process: { fill: "#E7F0FE", stroke: "#2563EB" },
	decision: { fill: "#FEEEDC", stroke: "#EA580C" },
	io: { fill: "#EFEAFD", stroke: "#6D4AE0" },
	junction: { fill: "#475569", stroke: "#475569" },
}

const points = (list) => list.map((p) => `${p.x},${p.y}`).join(" ")

// The outline of a step, as an SVG element, around its centre.
function shape(node, size, look, selected) {
	const { w, h } = size
	const x = node.x - w / 2
	const y = node.y - h / 2
	const paint = {
		fill: look.fill,
		stroke: selected ? ACCENT : look.stroke,
		"stroke-width": selected ? 3 : 2,
		"stroke-linejoin": "round",
	}
	switch (node.type) {
		case "terminator":
			return el("rect", { x, y, width: w, height: h, rx: h / 2, ...paint })
		case "decision":
			return el("polygon", {
				points: points([
					{ x: node.x, y },
					{ x: x + w, y: node.y },
					{ x: node.x, y: y + h },
					{ x, y: node.y },
				]),
				...paint,
			})
		case "io": {
			const skew = Math.min(28, w * 0.18)
			return el("polygon", {
				points: points([
					{ x: x + skew, y },
					{ x: x + w, y },
					{ x: x + w - skew, y: y + h },
					{ x, y: y + h },
				]),
				...paint,
			})
		}
		case "junction":
			return el("circle", { cx: node.x, cy: node.y, r: w / 2, ...paint })
		default:
			return el("rect", { x, y, width: w, height: h, rx: 8, ...paint })
	}
}

// ``layout``: {chart, nodes, edges, sizes, routes}. ``ctx``: {measure(text, size), detail, selected: Set,
// editingId, background, numbers: Map|null, drag: {from, point}|null, interactive}.
export function flowScene(layout, ctx) {
	const { chart, nodes, edges, sizes, routes } = layout
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const wires = []
	const labels = []
	for (const edge of edges) {
		const route = routes.get(edge.id)
		if (!route) continue
		const selected = ctx.selected.has(edge.id)
		const color = selected ? ACCENT : LINE
		const d = `M${route.points.map((p) => `${p.x} ${p.y}`).join(" L")}`
		wires.push(
			el("path", {
				d,
				fill: "none",
				stroke: color,
				"stroke-width": selected ? 3 : 2,
				"stroke-linejoin": "round",
				"stroke-linecap": "round",
			}),
		)
		const end = route.points[route.points.length - 1]
		wires.push(headNode("arrow", end, route.endDir, color, selected ? 3 : 2))
		if (edge.label && ctx.detail && edge.id !== ctx.editingId) {
			const width = ctx.measure(edge.label, 13) + 14
			labels.push(
				el("rect", {
					x: route.label.x - width / 2,
					y: route.label.y - 10,
					width,
					height: 20,
					rx: 10,
					fill: ctx.background || "#ffffff",
					stroke: selected ? ACCENT : "none",
					"stroke-width": 1.5,
				}),
				el(
					"text",
					{
						x: route.label.x,
						y: route.label.y,
						"text-anchor": "middle",
						"dominant-baseline": "central",
						"font-size": 13,
						"font-family": FONT,
						fill: "#1f2937",
					},
					[txt(edge.label)],
				),
			)
		}
		// a wide, invisible line under the pointer makes a thin arrow easy to hit when interactive
		if (ctx.interactive)
			wires.push(
				el("path", {
					d,
					fill: "none",
					stroke: "transparent",
					"stroke-width": 14,
					"data-flowedge": edge.id,
					"pointer-events": "stroke",
					style: "cursor: pointer",
				}),
			)
	}

	const shapes = []
	const extras = []
	for (const node of nodes) {
		const size = sizes.get(node.id)
		const look = LOOK[node.type] || LOOK.process
		const selected = ctx.selected.has(node.id)
		const children = [shape(node, size, look, selected)]
		if (node.text && ctx.detail && node.id !== ctx.editingId && node.type !== "junction") {
			const inner =
				size.w * (node.type === "decision" ? 0.58 : node.type === "io" ? 0.8 : 0.9) - 8
			const fontSize = fontSizeOf(node)
			const lines = wrapFlowText(
				node.text,
				(t, s) => ctx.measure(t, s),
				Math.max(40, inner),
				fontSize,
			)
			const lineHeight = fontSize * LINE_HEIGHT
			children.push(
				...textNodes(
					{ lines: lines.map((t) => ({ runs: [{ t }] })), lineHeight },
					{ align: "center", size: fontSize, color: "#1f2937" },
					{
						x: node.x - size.w / 2,
						width: size.w,
						top: node.y - (lines.length * lineHeight) / 2,
					},
				),
			)
		}
		const number = ctx.numbers?.get(node.id)
		if (number && ctx.detail) {
			const nx = node.x - size.w / 2 + 4
			const ny = node.y - size.h / 2 + 4
			children.push(
				el("circle", { cx: nx, cy: ny, r: 11, fill: "#111827" }),
				el(
					"text",
					{
						x: nx,
						y: ny,
						"text-anchor": "middle",
						"dominant-baseline": "central",
						"font-size": 11,
						"font-weight": 600,
						"font-family": FONT,
						fill: "#ffffff",
					},
					[txt(String(number))],
				),
			)
		}
		shapes.push(el("g", { "data-flownode": node.id }, children))

		// "+" handles on the sides a step's arrows leave from, for the one selected step
		if (selected && ctx.interactive && ctx.selected.size === 1) {
			for (const [side, point] of handlePoints(layout, node, size)) {
				extras.push(
					el(
						"g",
						{
							"data-flowadd": node.id,
							"data-side": side,
							style: "cursor: pointer",
							"pointer-events": "all",
						},
						[
							el("circle", { cx: point.x, cy: point.y, r: 10, fill: ACCENT }),
							el("path", {
								d: `M${point.x - 5} ${point.y} L${point.x + 5} ${point.y} M${point.x} ${point.y - 5} L${point.x} ${point.y + 5}`,
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
	}

	// the arrow being dragged out of a handle, and the arrow a dropped step would split
	const feedback = []
	const drag = ctx.drag
	if (drag?.point && byId.has(drag.from)) {
		const from = byId.get(drag.from)
		feedback.push(
			el("path", {
				d: `M${from.x} ${from.y} L${drag.point.x} ${drag.point.y}`,
				stroke: ACCENT,
				"stroke-width": 2,
				"stroke-dasharray": "6 4",
				fill: "none",
				"pointer-events": "none",
			}),
		)
		const target = drag.target && byId.get(drag.target)
		if (target) {
			const s = sizes.get(target.id)
			feedback.push(
				el("rect", {
					x: target.x - s.w / 2 - 5,
					y: target.y - s.h / 2 - 5,
					width: s.w + 10,
					height: s.h + 10,
					rx: 10,
					fill: ACCENT,
					"fill-opacity": 0.1,
					stroke: ACCENT,
					"stroke-dasharray": "5 4",
					"pointer-events": "none",
				}),
			)
		}
	}
	if (ctx.spliceEdge && routes.get(ctx.spliceEdge)) {
		const r = routes.get(ctx.spliceEdge)
		feedback.push(
			el("path", {
				d: `M${r.points.map((p) => `${p.x} ${p.y}`).join(" L")}`,
				stroke: ACCENT,
				"stroke-width": 5,
				fill: "none",
				opacity: 0.5,
				"pointer-events": "none",
			}),
		)
	}
	return el("g", { "data-flowchart": chart.id }, [
		...wires,
		...shapes,
		...labels,
		...feedback,
		...extras,
	])
}

// Where the "+" handles of a step go: just beyond each side its arrows may leave from.
function handlePoints(layout, node, size) {
	const { chart, nodes, edges } = layout
	const sides = new Set()
	const used = outSides(chart, nodes, edges, node)
	for (const side of used.values()) sides.add(side)
	// A decision always offers its next free side too (another output), and any step its forward side.
	const forward = chart.direction === "LR" ? "right" : "bottom"
	sides.add(forward)
	if (node.type === "decision") {
		const spare =
			chart.direction === "LR" ? ["right", "bottom", "top"] : ["bottom", "right", "left"]
		for (const s of spare)
			if (!sides.has(s)) {
				sides.add(s)
				break
			}
	}
	const out = new Map()
	for (const side of sides) {
		const p = portPoint(node, size, side)
		const push = 24
		out.set(side, {
			x: p.x + (side === "right" ? push : side === "left" ? -push : 0),
			y: p.y + (side === "bottom" ? push : side === "top" ? -push : 0),
		})
	}
	return out
}
