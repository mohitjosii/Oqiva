// Project colour tokens (the server stores the name) and the value drawn for each.

export const PROJECT_COLORS = {
	gray: "#8a8f98",
	blue: "#2563eb",
	green: "#16a34a",
	orange: "#ea580c",
	red: "#dc2626",
	violet: "#7c3aed",
	teal: "#0d9488",
	pink: "#db2777",
}

export const colorValue = (name) => PROJECT_COLORS[name] || PROJECT_COLORS.gray
