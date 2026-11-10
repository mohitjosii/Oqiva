import { newId } from "./ids"
import { MIN_SIZE, SHAPE_TYPES, TEXT_BOX_SIZE, toolById } from "./shapes"
import { NOTE_COLORS, sanitizeText, TABLE_LIMITS } from "./schema"
import { themedStyle, themeOf } from "./themes"

export function emptyText(themeName, overrides = {}) {
	return {
		align: "center",
		size: 16,
		color: themeOf(themeName).text,
		paragraphs: [{ runs: [] }],
		...overrides,
	}
}

// A new object for a tool, filling ``rect`` ({x, y, w, h} in board coordinates).
export function createObject(toolId, rect, { theme, z, text = null, sides = 5 } = {}) {
	const tool = toolById(toolId)
	if (!tool) throw new Error(`Unknown tool: ${toolId}`)
	const isText = tool.id === "text"
	const object = {
		id: newId(),
		kind: isText ? "text" : "shape",
		shape: isText ? "rectangle" : tool.shape,
		x: rect.x,
		y: rect.y,
		w: Math.max(MIN_SIZE, rect.w),
		h: Math.max(MIN_SIZE, rect.h),
		rotation: 0,
		z,
		style: isText
			? { ...themedStyle(theme), fill: null, stroke: null, strokeWidth: 0 }
			: themedStyle(theme),
		text: text ? sanitizeText(text, theme) : null,
	}
	if (object.shape === "polygon") object.sides = sides
	if (isText) object.text = object.text || emptyText(theme, { align: "left" })
	return object
}

// The size a tool gives a shape when it is placed with a click instead of a drag.
export function defaultRect(toolId, center) {
	const tool = toolById(toolId)
	const size =
		tool?.id === "text" ? TEXT_BOX_SIZE : SHAPE_TYPES[tool?.shape]?.size || { w: 160, h: 100 }
	const side = Math.min(size.w, size.h)
	const w = tool?.ratio ? side : size.w
	const h = tool?.ratio ? side : size.h
	return { x: center.x - w / 2, y: center.y - h / 2, w, h }
}

// A connector between two ends: {objectId, anchor} for an attached end, {x, y} for a free one.
export function createConnector({ from, to, geometry = "straight", arrow = true, theme, z }) {
	return {
		id: newId(),
		from,
		to,
		geometry,
		heads: { start: "none", end: arrow ? "arrow" : "none" },
		bend: 0,
		style: { stroke: themeOf(theme).stroke, strokeWidth: 2, dash: "solid", opacity: 1 },
		label: null,
		z,
	}
}

// A picture already uploaded to the board. ``size`` is its natural size; it is scaled down to fit.
export function createImage({ src, alt = "", size, center, maxSide = 480, z }) {
	const factor = Math.min(1, maxSide / Math.max(size.w, size.h))
	const w = Math.max(MIN_SIZE, Math.round(size.w * factor))
	const h = Math.max(MIN_SIZE, Math.round(size.h * factor))
	return {
		id: newId(),
		kind: "image",
		shape: "rectangle",
		x: center.x - w / 2,
		y: center.y - h / 2,
		w,
		h,
		rotation: 0,
		z,
		style: { fill: null, stroke: null, strokeWidth: 0, dash: "solid", opacity: 1, radius: 0 },
		text: null,
		src,
		alt,
	}
}

// An empty table of ``rows`` by ``cols`` cells, ``cell`` board units each.
export function createTable({ rows, cols, center, rect, theme, z, cell = { w: 120, h: 44 } }) {
	// Dragged out over ``rect``, the cells share it equally (none under the minimum size).
	const size = rect
		? {
				w: Math.max(TABLE_LIMITS.minSize, Math.round(rect.w / cols)),
				h: Math.max(TABLE_LIMITS.minSize, Math.round(rect.h / rows)),
			}
		: cell
	const w = cols * size.w
	const h = rows * size.h
	const origin = rect ? { x: rect.x, y: rect.y } : { x: center.x - w / 2, y: center.y - h / 2 }
	return {
		id: newId(),
		kind: "table",
		shape: "rectangle",
		x: origin.x,
		y: origin.y,
		w,
		h,
		rotation: 0,
		z,
		style: {
			fill: "#FFFFFF",
			stroke: themeOf(theme).stroke,
			strokeWidth: 1,
			dash: "solid",
			opacity: 1,
			radius: 0,
		},
		text: null,
		table: {
			colW: Array(cols).fill(size.w),
			rowH: Array(rows).fill(size.h),
			cells: Array.from({ length: rows }, () => Array(cols).fill(null)),
			fills: Array.from({ length: rows }, () => Array(cols).fill(null)),
		},
	}
}

// A sticky note: a coloured square with writing that follows the colour.
export function createNote(rect, { color = NOTE_COLORS[0], z } = {}) {
	return {
		id: newId(),
		kind: "note",
		shape: "rectangle",
		x: rect.x,
		y: rect.y,
		w: Math.max(MIN_SIZE, rect.w),
		h: Math.max(MIN_SIZE, rect.h),
		rotation: 0,
		z,
		style: {
			fill: color.fill,
			stroke: null,
			strokeWidth: 0,
			dash: "solid",
			opacity: 1,
			radius: 2,
		},
		text: {
			align: "left",
			size: 18,
			color: color.ink,
			paragraphs: [{ runs: [] }],
		},
	}
}

export const NOTE_SIZE = { w: 200, h: 200 }

// The writing colour that reads best on a note filled with ``fill``: its own deep tone when it is
// one of the note colours, otherwise black or white by brightness.
export function inkFor(fill) {
	const known = NOTE_COLORS.find((c) => c.fill.toLowerCase() === String(fill).toLowerCase())
	if (known) return known.ink
	const hex = String(fill).replace("#", "")
	const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6)
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
	const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
	const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
	return luminance > 0.4 ? "#111827" : "#FFFFFF"
}

// An icon from the icon set, or one emoji, as an object.
export function createIcon({ icon = null, emoji = null, center, size = 64, theme, z }) {
	return {
		id: newId(),
		kind: "icon",
		shape: "rectangle",
		x: center.x - size / 2,
		y: center.y - size / 2,
		w: size,
		h: size,
		rotation: 0,
		z,
		style: {
			fill: null,
			stroke: themeOf(theme).stroke,
			strokeWidth: 2,
			dash: "solid",
			opacity: 1,
			radius: 0,
		},
		text: null,
		...(icon ? { icon } : { emoji }),
	}
}

// A named region of the board, drawn behind everything else.
export function createFrame(rect, { name = "Section", z } = {}) {
	return {
		id: newId(),
		kind: "frame",
		shape: "rectangle",
		x: rect.x,
		y: rect.y,
		w: Math.max(MIN_SIZE * 4, rect.w),
		h: Math.max(MIN_SIZE * 4, rect.h),
		rotation: 0,
		z,
		name,
		style: {
			fill: "#F8FAFC",
			stroke: "#94A3B8",
			strokeWidth: 1.5,
			dash: "solid",
			opacity: 1,
			radius: 10,
		},
		text: null,
	}
}
