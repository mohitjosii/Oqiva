// Test helpers: build nodes from nested arrays. ["R", ["A", ["A1"], ["A2"]], ["B"]] makes a root R
// with children A (itself with A1 and A2) and B. Ids are the texts.

export function build(spec, mapId = "m") {
	const nodes = []
	const walk = (entry, parentId, order) => {
		const [text, ...children] = entry
		nodes.push({
			id: text,
			mapId,
			parentId,
			order,
			text,
			collapsed: false,
			color: null,
			marker: null,
			note: "",
		})
		children.forEach((child, i) => walk(child, text, i))
	}
	walk(spec, null, 0)
	return nodes
}

export const mapOf = (nodes, layout = "both", origin = { x: 0, y: 0 }) => ({
	id: "m",
	origin,
	rootId: nodes.find((n) => n.parentId == null).id,
	layout,
})

export const measure = (text, size) => text.length * size * 0.5

// A small seeded generator, so random trees are the same on every run.
export function seeded(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

export function randomTree(count, seed = 1, { maxText = 40, collapsedShare = 0 } = {}) {
	const rand = seeded(seed)
	const nodes = [{ ...build(["root"])[0], text: "Central idea" }]
	const orders = new Map([["root", 0]])
	for (let i = 1; i < count; i++) {
		const parent = nodes[Math.floor(rand() * nodes.length)]
		const order = orders.get(parent.id) ?? 0
		orders.set(parent.id, order + 1)
		orders.set(`n${i}`, 0)
		const length = 1 + Math.floor(rand() * maxText)
		nodes.push({
			...build([`n${i}`])[0],
			parentId: parent.id,
			order,
			text:
				`${"word ".repeat(Math.ceil(length / 5))}`.slice(0, length) +
				(rand() < 0.1 ? "\nline two" : ""),
		})
	}
	if (collapsedShare)
		for (const n of nodes) if (n.parentId && rand() < collapsedShare) n.collapsed = true
	return nodes
}
