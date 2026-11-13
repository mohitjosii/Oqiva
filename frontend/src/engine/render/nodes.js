// Describes how every kind of object is drawn, as plain data: {tag, attrs, children} for an
// SVG element and {text} for text. The editor turns these into Vue nodes (SvgTree.js) and
// export turns the very same description into a string, so what is saved as an image is what
// is on screen. Nothing here touches the DOM.

import { connectorPath } from "../geometry/connectors"
import { layoutFor } from "../text/fit"
import { layoutText } from "../text/layout"
import { iconData } from "../model/icons"
import { shapeArt, shapePath, textArea } from "../model/shapes"
import { strokePath } from "../model/strokes"
import { CELL_PADDING } from "../store/tableOps"
import { sketchNodes } from "./sketch"

export const FONT = "Inter, ui-sans-serif, system-ui, sans-serif"
const DASHES = { solid: null, dashed: "8 6", dotted: "2 5" }

export const el = (tag, attrs = {}, children = []) => ({ tag, attrs, children })
export const txt = (text) => ({ text: String(text) })

const place = (object) =>
	`translate(${object.x + object.w / 2} ${object.y + object.h / 2}) rotate(${object.rotation || 0}) translate(${-object.w / 2} ${-object.h / 2})`

const paintOf = (style, detail) => ({
	fill: style.fill || "none",
	stroke: style.stroke || "none",
	"stroke-width": style.strokeWidth,
	"stroke-dasharray": detail ? DASHES[style.dash] : null,
	"stroke-linejoin": "round",
})

// Text lines of a laid-out block, as SVG <text> elements. ``top`` is where the block starts.
export function textNodes(layout, text, { x, width, top }) {
	const align = text.align
	const lx = align === "left" ? x : align === "right" ? x + width : x + width / 2
	const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle"
	return layout.lines.map((line, index) =>
		el(
			"text",
			{
				x: lx,
				y: top + index * layout.lineHeight + layout.lineHeight / 2,
				"text-anchor": anchor,
				"font-size": text.size,
				"font-family": FONT,
				fill: text.color,
				"dominant-baseline": "central",
				style: "white-space: pre",
			},
			line.runs.map((run) =>
				el(
					"tspan",
					{
						"font-weight": run.b ? 600 : null,
						"font-style": run.i ? "italic" : null,
						"text-decoration": run.u ? "underline" : null,
						fill: run.c || null,
					},
					[txt(run.t)],
				),
			),
		),
	)
}

function shapeBody(object, ctx) {
	const paint = paintOf(object.style, ctx.detail)
	// hand-drawn style: the object's own choice, else the board's (never at a far zoom, where it cannot be seen)
	if (ctx.detail && (object.style.sketch ?? ctx.sketch)) {
		const flat = {
			fill: object.style.fill,
			stroke: object.style.stroke,
			width: object.style.strokeWidth,
			dash: DASHES[object.style.dash],
		}
		if (object.shape === "ellipse")
			return sketchNodes(object.id, { kind: "ellipse", w: object.w, h: object.h }, flat)
		const art = shapeArt(object)
		const path = art ? art.d : shapePath(object)
		if (path)
			return sketchNodes(object.id, { kind: "path", w: object.w, h: object.h, d: path }, flat)
		return sketchNodes(object.id, { kind: "rect", w: object.w, h: object.h }, flat)
	}
	if (object.shape === "ellipse") {
		return [
			el("ellipse", {
				cx: object.w / 2,
				cy: object.h / 2,
				rx: object.w / 2,
				ry: object.h / 2,
				...paint,
			}),
		]
	}
	const art = shapeArt(object)
	if (art) return artNodes(object, art, paint)
	const path = shapePath(object)
	if (path) return [el("path", { d: path, ...paint })]
	const radius = Math.min(object.style.radius, object.w / 2, object.h / 2)
	return [el("rect", { width: object.w, height: object.h, rx: radius, ...paint })]
}

// A silhouette with its extra strokes, mirrored with the shape when it is flipped.
function artNodes(object, art, paint) {
	const nodes = [el("path", { d: art.d, ...paint })]
	for (const detail of art.details) {
		nodes.push(
			el("path", {
				d: detail.d,
				fill: detail.fill === "stroke" ? paint.stroke : "none",
				stroke: detail.fill === "stroke" ? "none" : paint.stroke,
				"stroke-width": paint["stroke-width"],
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
			}),
		)
	}
	if (!object.flipX && !object.flipY) return nodes
	const flip = `translate(${object.flipX ? object.w : 0} ${object.flipY ? object.h : 0}) scale(${object.flipX ? -1 : 1} ${object.flipY ? -1 : 1})`
	return [el("g", { transform: flip }, nodes)]
}

// A freehand stroke: its outline filled with the pen colour.
function strokeBody(object) {
	const d = strokePath(object)
	return d ? [el("path", { d, fill: object.style.stroke || "#1E293B", stroke: "none" })] : []
}

// A sticky note: the paper, a slight shadow under it, and its writing from the top.
function noteBody(object, ctx) {
	const { w, h } = object
	const radius = Math.min(object.style.radius, w / 2, h / 2)
	return [
		el("rect", { x: 2, y: 4, width: w, height: h, rx: radius, fill: "#000000", opacity: 0.14 }),
		el("rect", { width: w, height: h, rx: radius, fill: object.style.fill || "#FEF08A" }),
		...shapeText(object, ctx),
	]
}

// One icon from the icon set, or an emoji, filling the object's box.
function iconBody(object) {
	if (object.emoji) {
		const size = Math.min(object.w, object.h)
		return [
			el(
				"text",
				{
					x: object.w / 2,
					y: object.h / 2,
					"text-anchor": "middle",
					"dominant-baseline": "central",
					"font-size": size * 0.8,
					"font-family":
						"'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif",
				},
				[txt(object.emoji)],
			),
		]
	}
	const data = iconData(object.icon)
	if (!data) {
		return [
			el("rect", {
				width: object.w,
				height: object.h,
				fill: "none",
				stroke: "#9CA3AF",
				"stroke-dasharray": "4 3",
			}),
		]
	}
	const stroke = object.style.stroke || "#475569"
	return [
		el(
			"g",
			{
				transform: `scale(${object.w / 24} ${object.h / 24})`,
				fill: "none",
				stroke,
				"stroke-width": 2,
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
			},
			data.shapes.map(([tag, attrs]) => el(tag, attrs)),
		),
	]
}

// A frame: a pale panel behind the work, with its name above the top-left corner.
function frameBody(object, ctx) {
	const radius = Math.min(object.style.radius, 16)
	const nodes = [
		el("rect", {
			width: object.w,
			height: object.h,
			rx: radius,
			...paintOf(object.style, ctx.detail),
		}),
	]
	if (ctx.detail && object.name) {
		nodes.push(
			el(
				"text",
				{
					x: 4,
					y: -10,
					"font-size": 14,
					"font-weight": 600,
					"font-family": FONT,
					fill: "#475569",
				},
				[txt(object.name)],
			),
		)
	}
	return nodes
}

function shapeText(object, ctx) {
	if (!ctx.detail || ctx.hideText || !object.text) return []
	const layout = layoutFor(object, ctx.measure)
	const area = textArea(object)
	const fromTop = object.kind === "text" || object.kind === "note"
	const top = fromTop ? area.y : area.y + Math.max(0, (area.h - layout.height) / 2)
	return textNodes(layout, object.text, { x: area.x, width: area.w, top })
}

function imageBody(object) {
	const flip = `translate(${object.flipX ? object.w : 0} ${object.flipY ? object.h : 0}) scale(${object.flipX ? -1 : 1} ${object.flipY ? -1 : 1})`
	const radius = Math.min(object.style.radius, object.w / 2, object.h / 2)
	const clip = `oq-clip-${object.id}`
	const nodes = [
		el("clipPath", { id: clip }, [
			el("rect", { width: object.w, height: object.h, rx: radius }),
		]),
		el("g", { transform: flip }, [
			el("image", {
				href: object.src,
				width: object.w,
				height: object.h,
				preserveAspectRatio: "none",
				"clip-path": `url(#${clip})`,
			}),
		]),
	]
	if (object.style.stroke && object.style.strokeWidth > 0) {
		nodes.push(
			el("rect", {
				width: object.w,
				height: object.h,
				rx: radius,
				fill: "none",
				...paintOf(object.style, true),
			}),
		)
	}
	return nodes
}

function tableBody(object, ctx) {
	const { colW, rowH, cells, fills } = object.table
	const style = object.style
	const nodes = [el("rect", { width: object.w, height: object.h, fill: style.fill || "none" })]
	let y = 0
	rowH.forEach((height, r) => {
		let x = 0
		colW.forEach((width, c) => {
			if (fills[r][c]) nodes.push(el("rect", { x, y, width, height, fill: fills[r][c] }))
			x += width
		})
		y += height
	})
	const lines = []
	let at = 0
	for (let c = 0; c <= colW.length; c++) {
		lines.push(`M${at} 0 L${at} ${object.h}`)
		at += colW[c] || 0
	}
	at = 0
	for (let r = 0; r <= rowH.length; r++) {
		lines.push(`M0 ${at} L${object.w} ${at}`)
		at += rowH[r] || 0
	}
	if (style.stroke)
		nodes.push(
			el("path", {
				d: lines.join(" "),
				fill: "none",
				stroke: style.stroke,
				"stroke-width": style.strokeWidth,
				"stroke-dasharray": ctx.detail ? DASHES[style.dash] : null,
			}),
		)
	if (ctx.detail) {
		y = 0
		rowH.forEach((height, r) => {
			let x = 0
			colW.forEach((width, c) => {
				const text = cells[r][c]
				const editing =
					ctx.hideText &&
					ctx.editingCell &&
					ctx.editingCell.row === r &&
					ctx.editingCell.col === c
				if (text && !editing) {
					const area = {
						x: x + CELL_PADDING.x,
						width: Math.max(10, width - CELL_PADDING.x * 2),
					}
					const layout = layoutText(text, { width: area.width, measure: ctx.measure })
					nodes.push(
						...textNodes(layout, text, {
							...area,
							top: y + Math.max(CELL_PADDING.y, (height - layout.height) / 2),
						}),
					)
				}
				x += width
			})
			y += height
		})
	}
	return nodes
}

// One object, positioned and rotated, ready to draw. ``ctx``: {measure, detail, hideText, editingCell}.
export function objectNode(object, ctx) {
	let body
	if (object.kind === "image") body = imageBody(object)
	else if (object.kind === "table") body = tableBody(object, ctx)
	else if (object.kind === "note") body = noteBody(object, ctx)
	else if (object.kind === "icon") body = iconBody(object)
	else if (object.kind === "frame") body = frameBody(object, ctx)
	else if (object.kind === "stroke") body = strokeBody(object)
	else body = [...shapeBody(object, ctx), ...shapeText(object, ctx)]
	return el(
		"g",
		{ transform: place(object), opacity: object.style.opacity, "pointer-events": "none" },
		body,
	)
}

const headSize = (width) => Math.max(9, width * 4)

// An arrowhead, dot or open arrow at ``point`` pointing along ``dir``.
export function headNode(kind, point, dir, stroke, width) {
	if (kind === "none") return null
	const size = headSize(width)
	const back = { x: point.x - dir.x * size, y: point.y - dir.y * size }
	const wing = { x: -dir.y * size * 0.5, y: dir.x * size * 0.5 }
	const a = `${back.x + wing.x} ${back.y + wing.y}`
	const b = `${back.x - wing.x} ${back.y - wing.y}`
	if (kind === "arrow")
		return el("path", {
			d: `M${point.x} ${point.y} L${a} L${b} Z`,
			fill: stroke,
			stroke,
			"stroke-width": 1,
			"stroke-linejoin": "round",
		})
	if (kind === "open")
		return el("path", {
			d: `M${a} L${point.x} ${point.y} L${b}`,
			fill: "none",
			stroke,
			"stroke-width": width,
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
		})
	return el("circle", {
		cx: point.x - dir.x * size * 0.3,
		cy: point.y - dir.y * size * 0.3,
		r: size * 0.32,
		fill: stroke,
	})
}

const LABEL_SIZE = 13

// A connector: the line, its two ends, and a label in a pill the colour of the canvas.
export function connectorNode(connector, path, ctx) {
	const style = connector.style
	// hand-drawn style: the line's own choice, else the board's (the heads and the label stay clean)
	const wobbly = ctx.detail && (style.sketch ?? ctx.sketch)
	const nodes = wobbly
		? sketchNodes(
				connector.id,
				{ kind: "path", w: 0, h: 0, d: path.d },
				{
					fill: null,
					stroke: style.stroke,
					width: style.strokeWidth,
					dash: DASHES[style.dash],
				},
			)
		: [
				el("path", {
					d: path.d,
					fill: "none",
					stroke: style.stroke,
					"stroke-width": style.strokeWidth,
					"stroke-dasharray": ctx.detail ? DASHES[style.dash] : null,
					"stroke-linecap": "round",
					"stroke-linejoin": "round",
				}),
			]
	const start = headNode(
		connector.heads.start,
		path.p0,
		path.startDir,
		style.stroke,
		style.strokeWidth,
	)
	const end = headNode(connector.heads.end, path.p1, path.endDir, style.stroke, style.strokeWidth)
	if (start) nodes.push(start)
	if (end) nodes.push(end)
	if (ctx.detail && connector.label?.text && !ctx.hideText) {
		const width = ctx.measure(connector.label.text, { size: LABEL_SIZE }) + 16
		nodes.push(
			el("rect", {
				x: path.mid.x - width / 2,
				y: path.mid.y - 11,
				width,
				height: 22,
				rx: 11,
				fill: ctx.background || "#ffffff",
			}),
			el(
				"text",
				{
					x: path.mid.x,
					y: path.mid.y,
					"text-anchor": "middle",
					"dominant-baseline": "central",
					"font-size": LABEL_SIZE,
					"font-family": FONT,
					fill: "#1f2937",
					style: "white-space: pre",
				},
				[txt(connector.label.text)],
			),
		)
	}
	return el("g", { opacity: style.opacity, "pointer-events": "none" }, nodes)
}

export { connectorPath }

// ----- turning a description into text, for export -----

const escapeText = (value) =>
	String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const escapeAttr = (value) => escapeText(value).replace(/"/g, "&quot;")

export function serializeNode(node) {
	if (node.text !== undefined) return escapeText(node.text)
	const attrs = Object.entries(node.attrs)
		.filter(([, value]) => value !== null && value !== undefined)
		.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
		.join("")
	return node.children.length
		? `<${node.tag}${attrs}>${node.children.map(serializeNode).join("")}</${node.tag}>`
		: `<${node.tag}${attrs}/>`
}
