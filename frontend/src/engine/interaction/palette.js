// Which tiles the right palette shows for a selection. The rule is the intersection: a tile
// appears only if every selected thing supports it, so the palette never offers something
// that would silently skip part of the selection.
//
// The one deliberate exception is arrangement (align, distribute, size, swap, rotate, flip).
// A marquee that catches shapes also catches the lines between them, and those lines follow
// their shapes anyway, so for arrangement the lines are set aside rather than hiding it all.

export const STYLE_SECTIONS = [
	"shapeType",
	"noteColor",
	"frameName",
	"fill",
	"border",
	"text",
	"opacity",
	"radius",
	"line",
	"sketch",
]

const OBJECT_ONLY = new Set(["fill", "text", "radius"])

// What one thing supports.
export function capabilitiesOf(item) {
	if (item.geometry) return new Set(["border", "opacity", "line"]) // a connector
	switch (item.kind) {
		case "shape":
			return new Set([
				"shapeType",
				"fill",
				"border",
				"text",
				"opacity",
				"sketch",
				...(item.shape === "rectangle" ? ["radius"] : []),
			])
		case "text":
			return new Set(["fill", "border", "text", "opacity"])
		case "image":
			return new Set(["border", "opacity", "radius"])
		case "table":
			return new Set(["border", "opacity"])
		case "note":
			return new Set(["fill", "text", "opacity", "noteColor"])
		case "icon":
			return new Set(["border", "opacity"])
		case "frame":
			return new Set(["fill", "border", "opacity", "frameName"])
		case "stroke":
			return new Set(["border", "opacity"])
		default:
			return new Set() // a kind from a newer version: leave it alone
	}
}

export function availableSections(objects, connectors = []) {
	const all = [...objects, ...connectors]
	const sections = new Set()
	if (!all.length) return sections
	sections.add("arrange")
	if (objects.length >= 2) sections.add("group")
	if (objects.some((object) => object.groupId)) sections.add("ungroup")
	if (objects.length >= 1) {
		sections.add("align")
		sections.add("transform")
		if (objects.every((object) => object.kind !== "table")) sections.add("flip") // mirrored cells would read backwards
	}
	if (objects.length === 1 && objects[0].kind === "table") sections.add("table")
	if (objects.length === 1 && !connectors.length) sections.add("link")
	if (objects.length >= 2) sections.add("removeGaps")
	if (objects.length >= 3) sections.add("distribute")
	if (objects.filter((object) => object.kind !== "table").length >= 2) sections.add("size")
	if (objects.length === 2) sections.add("swap")
	let common = null
	for (const item of all) {
		const caps = capabilitiesOf(item)
		common = common ? new Set([...common].filter((name) => caps.has(name))) : caps
	}
	for (const name of common || []) sections.add(name)
	return sections
}

// The value every item shares, or undefined when they differ (shown as "mixed").
export function commonValue(items, read) {
	if (!items.length) return undefined
	const first = read(items[0])
	return items.every((item) => read(item) === first) ? first : undefined
}

export const isObjectOnly = (section) => OBJECT_ONLY.has(section)

// The curated colours: a handful of hues, each in a light tint, a mid tone and a deep tone.
export const SWATCHES = [
	["Gray", ["#F3F4F6", "#9CA3AF", "#1F2937"]],
	["Red", ["#FEE2E2", "#EF4444", "#991B1B"]],
	["Orange", ["#FFEDD5", "#F97316", "#9A3412"]],
	["Yellow", ["#FEF9C3", "#EAB308", "#854D0E"]],
	["Green", ["#DCFCE7", "#22C55E", "#166534"]],
	["Teal", ["#CCFBF1", "#14B8A6", "#115E59"]],
	["Blue", ["#DBEAFE", "#3B82F6", "#1E3A8A"]],
	["Violet", ["#EDE9FE", "#8B5CF6", "#5B21B6"]],
	["Pink", ["#FCE7F3", "#EC4899", "#9D174D"]],
]
export const BASICS = [
	["White", "#FFFFFF"],
	["Black", "#111827"],
]
export const RECENT_LIMIT = 8

// Puts ``color`` first in the recent list, once, keeping the list short.
export function pushRecent(recent, color) {
	return [color, ...recent.filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(
		0,
		RECENT_LIMIT,
	)
}
