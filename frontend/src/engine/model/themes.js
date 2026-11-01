// Colour themes for new shapes. A theme is a triad: a tint for fills, a stronger colour
// for outlines, and a dark readable colour for text. The canvas always stays light, so
// these are literal values and never read the app's chrome tokens.

export const THEMES = {
	ocean: { label: "Ocean", fill: "#E7F0FE", stroke: "#2563EB", text: "#1E3A8A" },
	slate: { label: "Slate", fill: "#EEF0F3", stroke: "#475569", text: "#1F2937" },
	violet: { label: "Violet", fill: "#EFEAFD", stroke: "#6D4AE0", text: "#3B2A8C" },
	sunset: { label: "Sunset", fill: "#FEEEDC", stroke: "#EA580C", text: "#7C2D12" },
}

export const DEFAULT_THEME = "ocean"

export function themeOf(name) {
	return THEMES[name] || THEMES[DEFAULT_THEME]
}

export function themedStyle(name) {
	const theme = themeOf(name)
	return {
		fill: theme.fill,
		stroke: theme.stroke,
		strokeWidth: 2,
		dash: "solid",
		opacity: 1,
		radius: 8,
	}
}

const COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

// Colours come from other people's documents, so only plain hex values are drawn. That
// rules out url(...) values, which would make the browser fetch an address of someone
// else's choosing.
export function isColor(value) {
	return typeof value === "string" && COLOR.test(value)
}
