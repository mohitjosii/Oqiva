// Measures text with the browser's own font engine, so layout matches what is drawn.

let context = null
const cache = new Map()

export function fontFor({ size, b, i }) {
	return `${i ? "italic " : ""}${b ? "600" : "400"} ${size}px Inter, ui-sans-serif, system-ui, sans-serif`
}

export function measureText(text, style) {
	if (!context) context = document.createElement("canvas").getContext("2d")
	const font = fontFor(style)
	const key = `${font}|${text}`
	let width = cache.get(key)
	if (width === undefined) {
		context.font = font
		width = context.measureText(text).width
		if (cache.size > 20000) cache.clear()
		cache.set(key, width)
	}
	return width
}

// Call when web fonts finish loading: widths measured before then used a fallback font.
export function resetMeasureCache() {
	cache.clear()
}
