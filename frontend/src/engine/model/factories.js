import { newId } from "./ids"
import { MIN_SIZE, SHAPE_TYPES, TEXT_BOX_SIZE, toolById } from "./shapes"
import { sanitizeText } from "./schema"
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
