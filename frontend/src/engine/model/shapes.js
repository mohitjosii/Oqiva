// What each kind of shape looks like, how big it starts, and where its text goes.

export const TEXT_PADDING_X = 12
export const TEXT_PADDING_Y = 6

export const SHAPE_TYPES = {
	rectangle: {
		label: "Rectangle",
		size: { w: 160, h: 100 },
		textBox: { x: 0, y: 0, w: 1, h: 1 },
	},
	ellipse: {
		label: "Ellipse",
		size: { w: 160, h: 100 },
		textBox: { x: 0.1465, y: 0.1465, w: 0.707, h: 0.707 },
	},
	triangle: {
		label: "Triangle",
		size: { w: 140, h: 120 },
		textBox: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 },
	},
	diamond: {
		label: "Diamond",
		size: { w: 150, h: 110 },
		textBox: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
	},
	polygon: {
		label: "Polygon",
		size: { w: 130, h: 130 },
		textBox: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 },
	},
	arrow: {
		label: "Block arrow",
		size: { w: 170, h: 100 },
		textBox: { x: 0, y: 0.25, w: 0.6, h: 0.5 },
	},
	// Real silhouettes
	cylinder: {
		label: "Cylinder",
		size: { w: 140, h: 120 },
		textBox: { x: 0, y: 0.22, w: 1, h: 0.7 },
	},
	document: {
		label: "Document",
		size: { w: 160, h: 110 },
		textBox: { x: 0, y: 0, w: 1, h: 0.8 },
	},
	cloud: {
		label: "Cloud",
		size: { w: 180, h: 110 },
		textBox: { x: 0.15, y: 0.25, w: 0.7, h: 0.55 },
	},
	hexagon: {
		label: "Hexagon",
		size: { w: 160, h: 100 },
		textBox: { x: 0.16, y: 0, w: 0.68, h: 1 },
	},
	trapezoid: {
		label: "Trapezoid",
		size: { w: 170, h: 90 },
		textBox: { x: 0.18, y: 0, w: 0.64, h: 1 },
	},
	// Wireframe controls: a small mark on one side and room for a label on the other
	checkbox: {
		label: "Checkbox",
		size: { w: 160, h: 28 },
		textBox: (o) => beside(o, controlSize(o) + 8, 0),
		textAlign: "left",
	},
	radio: {
		label: "Radio button",
		size: { w: 160, h: 28 },
		textBox: (o) => beside(o, controlSize(o) + 8, 0),
		textAlign: "left",
	},
	dropdown: {
		label: "Dropdown",
		size: { w: 200, h: 40 },
		textBox: (o) => beside(o, 0, 30),
		textAlign: "left",
	},
	mobile: {
		label: "Mobile frame",
		size: { w: 240, h: 480 },
		textBox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
	},
	desktop: {
		label: "Desktop frame",
		size: { w: 480, h: 320 },
		textBox: { x: 0.05, y: 0.12, w: 0.9, h: 0.8 },
	},
}

// The size of a checkbox or radio mark.
const controlSize = (object) => Math.min(object.h, 22)
// The text box of a control with ``left`` and ``right`` taken by its mark, as fractions.
const beside = (object, left, right) => ({
	x: Math.min(0.9, left / object.w),
	y: 0,
	w: Math.max(0.1, 1 - (left + right) / object.w),
	h: 1,
})
const textBoxOf = (object) => {
	const type =
		object.kind === "text" || object.kind === "note" || object.kind === "frame"
			? SHAPE_TYPES.rectangle
			: SHAPE_TYPES[object.shape] || SHAPE_TYPES.rectangle
	return typeof type.textBox === "function" ? type.textBox(object) : type.textBox
}
// Which way a shape's text lines up when it is first typed.
export const defaultAlign = (shape) => SHAPE_TYPES[shape]?.textAlign || "center"

// The tools in the shapes menu. Square and circle are the rectangle and ellipse locked to
// a 1:1 ratio, so a document only ever stores the five geometries above plus text.
export const SHAPE_TOOLS = [
	{ id: "rectangle", shape: "rectangle", label: "Rectangle", icon: "square" },
	{ id: "square", shape: "rectangle", label: "Square", icon: "square", ratio: 1 },
	{ id: "ellipse", shape: "ellipse", label: "Ellipse", icon: "circle" },
	{ id: "circle", shape: "ellipse", label: "Circle", icon: "circle", ratio: 1 },
	{ id: "triangle", shape: "triangle", label: "Triangle", icon: "triangle" },
	{ id: "diamond", shape: "diamond", label: "Diamond", icon: "diamond" },
	{ id: "polygon", shape: "polygon", label: "Polygon", icon: "octagon" },
	{ id: "arrow", shape: "arrow", label: "Block arrow", icon: "arrow-right" },
	{ id: "hexagon", shape: "hexagon", label: "Hexagon", icon: "hexagon" },
	{ id: "trapezoid", shape: "trapezoid", label: "Trapezoid", icon: "box" },
	{ id: "cylinder", shape: "cylinder", label: "Cylinder", icon: "database" },
	{ id: "document", shape: "document", label: "Document", icon: "file-text" },
	{ id: "cloud", shape: "cloud", label: "Cloud", icon: "cloud" },
]

export const TEXT_TOOL = { id: "text", label: "Text box", icon: "type" }

export function toolById(id) {
	return id === TEXT_TOOL.id ? TEXT_TOOL : SHAPE_TOOLS.find((tool) => tool.id === id) || null
}

export const TEXT_BOX_SIZE = { w: 200, h: 36 }
export const MIN_SIZE = 8

// The outline of a polygon-like shape in its own coordinates, mirrored if the object is flipped.
export function polygonPoints(object) {
	const points = basePoints(object)
	if (!points || (!object.flipX && !object.flipY)) return points
	return points.map(([x, y]) => [
		object.flipX ? object.w - x : x,
		object.flipY ? object.h - y : y,
	])
}

function basePoints(object) {
	const { w, h } = object
	switch (object.shape) {
		case "triangle":
			return [
				[w / 2, 0],
				[w, h],
				[0, h],
			]
		case "diamond":
			return [
				[w / 2, 0],
				[w, h / 2],
				[w / 2, h],
				[0, h / 2],
			]
		case "polygon": {
			const sides = object.sides || 5
			return Array.from({ length: sides }, (_, i) => {
				const angle = (-90 + (360 * i) / sides) * (Math.PI / 180)
				return [w / 2 + (w / 2) * Math.cos(angle), h / 2 + (h / 2) * Math.sin(angle)]
			})
		}
		case "hexagon":
			return [
				[w * 0.25, 0],
				[w * 0.75, 0],
				[w, h / 2],
				[w * 0.75, h],
				[w * 0.25, h],
				[0, h / 2],
			]
		case "trapezoid":
			return [
				[w * 0.18, 0],
				[w * 0.82, 0],
				[w, h],
				[0, h],
			]
		case "arrow":
			return [
				[0, h * 0.25],
				[w * 0.6, h * 0.25],
				[w * 0.6, 0],
				[w, h / 2],
				[w * 0.6, h],
				[w * 0.6, h * 0.75],
				[0, h * 0.75],
			]
		default:
			return null
	}
}

export function shapePath(object) {
	const points = polygonPoints(object)
	if (!points) return null
	return `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join(" L")} Z`
}

const round = (value) => Math.round(value * 100) / 100

// The shapes drawn from curves or in several parts. ``art`` gives the outline (``d``) and the
// extra strokes or dots drawn over it (``details``; ``fill: "stroke"`` fills with the outline colour).
const ART = {
	cylinder: ({ w, h }) => {
		const ry = Math.min(h * 0.16, 26)
		const rx = w / 2
		return {
			d: `M0 ${ry} A${rx} ${ry} 0 0 1 ${w} ${ry} L${w} ${h - ry} A${rx} ${ry} 0 0 1 0 ${h - ry} Z`,
			details: [{ d: `M0 ${ry} A${rx} ${ry} 0 0 0 ${w} ${ry}` }],
		}
	},
	document: ({ w, h }) => {
		const a = h * 0.12
		return {
			d: `M0 0 L${w} 0 L${w} ${h - a} Q${w * 0.75} ${h - a * 2.4} ${w / 2} ${h - a} T0 ${h - a} Z`,
			details: [],
		}
	},
	cloud: ({ w, h }) => {
		const x = (n) => round((n / 100) * w)
		const y = (n) => round((n / 56) * h)
		return {
			d: `M${x(25)} ${y(55)} C${x(10)} ${y(55)} ${x(2)} ${y(42)} ${x(10)} ${y(33)} C${x(4)} ${y(22)} ${x(18)} ${y(10)} ${x(30)} ${y(15)} C${x(35)} ${y(3)} ${x(55)} ${y(0)} ${x(62)} ${y(12)} C${x(75)} ${y(5)} ${x(92)} ${y(15)} ${x(88)} ${y(30)} C${x(100)} ${y(35)} ${x(98)} ${y(55)} ${x(80)} ${y(55)} Z`,
			details: [],
		}
	},
	checkbox: (o) => {
		const b = controlSize(o)
		const top = (o.h - b) / 2
		const cy = o.h / 2
		return {
			d: roundedRect(0, top, b, b, 3),
			details: [
				{
					d: `M${round(b * 0.22)} ${round(cy)} L${round(b * 0.42)} ${round(cy + b * 0.2)} L${round(b * 0.8)} ${round(cy - b * 0.22)}`,
				},
			],
		}
	},
	radio: (o) => {
		const b = controlSize(o)
		const r = b / 2
		const cy = o.h / 2
		return {
			d: circle(r, cy, r),
			details: [{ d: circle(r, cy, r * 0.45), fill: "stroke" }],
		}
	},
	dropdown: ({ w, h }) => ({
		d: roundedRect(0, 0, w, h, Math.min(6, h / 2)),
		details: [
			{
				d: `M${w - 22} ${h / 2 - 3} L${w - 16} ${h / 2 + 3} L${w - 10} ${h / 2 - 3}`,
			},
		],
	}),
	mobile: ({ w, h }) => ({
		d: roundedRect(0, 0, w, h, Math.min(28, w * 0.12)),
		details: [
			{ d: `M${w * 0.4} 14 L${w * 0.6} 14` },
			{ d: `M${w * 0.38} ${h - 12} L${w * 0.62} ${h - 12}` },
		],
	}),
	desktop: ({ w, h }) => ({
		d: roundedRect(0, 0, w, h, 8),
		details: [
			{ d: `M0 28 L${w} 28` },
			{ d: circle(16, 14, 3.5), fill: "stroke" },
			{ d: circle(30, 14, 3.5), fill: "stroke" },
			{ d: circle(44, 14, 3.5), fill: "stroke" },
		],
	}),
}

function roundedRect(x, y, w, h, r) {
	const k = Math.min(r, w / 2, h / 2)
	return `M${x + k} ${y} L${x + w - k} ${y} A${k} ${k} 0 0 1 ${x + w} ${y + k} L${x + w} ${y + h - k} A${k} ${k} 0 0 1 ${x + w - k} ${y + h} L${x + k} ${y + h} A${k} ${k} 0 0 1 ${x} ${y + h - k} L${x} ${y + k} A${k} ${k} 0 0 1 ${x + k} ${y} Z`
}

function circle(cx, cy, r) {
	return `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
}

export const hasArt = (object) => object.kind === "shape" && object.shape in ART
export const shapeArt = (object) => (hasArt(object) ? ART[object.shape](object) : null)

// The part of a shape that text may use, in the shape's own coordinates, padded.
export function textArea(object) {
	const box = textBoxOf(object)
	const width = Math.max(20, object.w * box.w - TEXT_PADDING_X * 2)
	const boxX = object.flipX ? 1 - box.x - box.w : box.x
	const boxY = object.flipY ? 1 - box.y - box.h : box.y
	return {
		x: object.w * boxX + (object.w * box.w - width) / 2,
		y: object.h * boxY + TEXT_PADDING_Y,
		w: width,
		h: Math.max(10, object.h * box.h - TEXT_PADDING_Y * 2),
	}
}

// The height a shape needs so that text of the given height fits inside it.
export function heightForText(object, textHeight) {
	return (textHeight + TEXT_PADDING_Y * 2) / textBoxOf(object).h
}
