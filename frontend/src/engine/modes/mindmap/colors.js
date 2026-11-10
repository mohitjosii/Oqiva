// Branch colours: each first-level branch gets a palette colour, and its descendants inherit it
// unless a node sets its own.

export const BRANCH_PALETTE = [
	"#3B82F6", // blue
	"#22C55E", // green
	"#F97316", // orange
	"#8B5CF6", // violet
	"#EC4899", // pink
	"#14B8A6", // teal
	"#EAB308", // amber
	"#EF4444", // red
]
export const ROOT_COLOR = "#64748B"
const DARK_TEXT = "#111827"
const LIGHT_TEXT = "#FFFFFF"
const MAX_TINT = 0.6
const TINT_STEP = 0.12

const HEX = /^#[0-9a-fA-F]{6}$/

// Every node's colour in one pass: own colour, else the nearest coloured ancestor (the root's
// colour is not inherited), else the palette entry of its first-level branch.
export function branchColors(nodes) {
	const kids = new Map()
	for (const node of nodes) {
		const k = node.parentId ?? null
		if (!kids.has(k)) kids.set(k, [])
		kids.get(k).push(node)
	}
	for (const list of kids.values()) list.sort((a, b) => a.order - b.order)
	const colors = new Map()
	for (const root of kids.get(null) ?? []) {
		colors.set(root.id, root.color ?? ROOT_COLOR)
		;(kids.get(root.id) ?? []).forEach((branch, i) => {
			const stack = [[branch, BRANCH_PALETTE[i % BRANCH_PALETTE.length]]]
			while (stack.length) {
				const [node, inherited] = stack.pop()
				const color = node.color ?? inherited
				colors.set(node.id, color)
				for (const child of kids.get(node.id) ?? []) stack.push([child, color])
			}
		})
	}
	return colors
}

// One node's colour. Use branchColors when colouring many nodes.
export function branchColor(nodes, id) {
	const byId = new Map(nodes.map((n) => [n.id, n]))
	let node = byId.get(id)
	if (!node) return null
	if (node.parentId == null) return node.color ?? ROOT_COLOR
	let steps = 0
	let branch = node
	while (node && node.parentId != null && steps++ <= nodes.length) {
		if (node.color) return node.color
		branch = node
		node = byId.get(node.parentId)
	}
	// `branch` is the first-level ancestor (or the node itself); find its place among its siblings.
	const index = nodes
		.filter((n) => n.parentId === branch.parentId)
		.sort((a, b) => a.order - b.order)
		.findIndex((n) => n.id === branch.id)
	return BRANCH_PALETTE[Math.max(0, index) % BRANCH_PALETTE.length]
}

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

// A lighter tint for deeper levels: depth 1 is the colour itself, then 12% lighter per level, up
// to 60%.
export function shade(hex, depth) {
	if (!HEX.test(hex ?? "") || !(depth > 1)) return hex
	const t = Math.min(MAX_TINT, (Math.floor(depth) - 1) * TINT_STEP)
	const mixed = channels(hex).map((c) => Math.round(c + (255 - c) * t))
	return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase()
}

// White text on dark colours, near-black text on light ones.
export function textColorFor(hex) {
	if (!HEX.test(hex ?? "")) return DARK_TEXT
	const [r, g, b] = channels(hex)
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? DARK_TEXT : LIGHT_TEXT
}
