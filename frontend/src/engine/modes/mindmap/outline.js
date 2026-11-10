// The outline panel's view of a map: the whole tree in reading order, whatever is collapsed.

import { childrenMap, demote, promote } from "./tree"

export function toOutline(nodes, rootId) {
	const kids = childrenMap(nodes)
	const byId = new Map(nodes.map((n) => [n.id, n]))
	if (!byId.has(rootId)) return []
	const result = []
	const stack = [[rootId, 0]]
	while (stack.length) {
		const [id, depth] = stack.pop()
		const node = byId.get(id)
		const children = kids.get(id) ?? []
		result.push({
			id,
			depth,
			text: node.text,
			hasChildren: children.length > 0,
			collapsed: Boolean(node.collapsed),
		})
		for (let i = children.length - 1; i >= 0; i--) stack.push([children[i].id, depth + 1])
	}
	return result
}

// "- text" lines, two spaces per level, the root at level 0. Line breaks inside a node's text
// become spaces so every node stays on one line.
export function outlineToText(nodes, rootId) {
	return toOutline(nodes, rootId)
		.map((item) => `${"  ".repeat(item.depth)}- ${item.text.replace(/\s*\n\s*/g, " ")}`)
		.join("\n")
}

export { demote as indentChange, promote as outdentChange }
