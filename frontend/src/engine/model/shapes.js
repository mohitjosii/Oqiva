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
}

// The tools in the shapes menu. Square and circle are the rectangle and ellipse locked to
// a 1:1 ratio, so a document only ever stores the five geometries above plus text.
export const SHAPE_TOOLS = [
	{ id: "rectangle", shape: "rectangle", label: "Rectangle", icon: "square" },
	{ id: "square", shape: "rectangle", label: "Square", icon: "square", ratio: 1 },
	{ id: "ellipse", shape: "ellipse", label: "Ellipse", icon: "circle" },
	{ id: "circle", shape: "ellipse", label: "Circle", icon: "circle", ratio: 1 },
	{ id: "triangle", shape: "triangle", label: "Triangle", icon: "triangle" },
	{ id: "diamond", shape: "diamond", label: "Diamond", icon: "diamond" },
	{ id: "polygon", shape: "polygon", label: "Polygon", icon: "hexagon" },
	{ id: "arrow", shape: "arrow", label: "Block arrow", icon: "arrow-right" },
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

// The part of a shape that text may use, in the shape's own coordinates, padded.
export function textArea(object) {
	const type =
		object.kind === "text"
			? SHAPE_TYPES.rectangle
			: SHAPE_TYPES[object.shape] || SHAPE_TYPES.rectangle
	const box = type.textBox
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
	const type =
		object.kind === "text"
			? SHAPE_TYPES.rectangle
			: SHAPE_TYPES[object.shape] || SHAPE_TYPES.rectangle
	return (textHeight + TEXT_PADDING_Y * 2) / type.textBox.h
}
