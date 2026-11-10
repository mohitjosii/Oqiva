// Pasting indented or bulleted text as a tree.

import { newId } from "../../model/ids"
import { createNode, NODE_TEXT_LIMIT } from "./model"

export const MAX_PASTE_LINES = 500
const TAB_WIDTH = 4
const BULLET = /^(?:[-*+•–]|\d+[.)])(?:\s+|$)/
const HEADING = /^(#{1,6})(?:\s+|$)/

const indentWidth = (whitespace) =>
	[...whitespace].reduce((sum, ch) => sum + (ch === "\t" ? TAB_WIDTH : 1), 0)

export function looksLikeOutline(text) {
	let lines = 0
	for (const line of String(text ?? "").split(/\r\n|\r|\n/))
		if (line.trim() && ++lines >= 2) return true
	return false
}

// Text -> [{ text, children }]. Indentation (tabs, any consistent number of spaces, or a mix)
// sets the level through a stack of the indents seen, so a jump of several levels only goes one
// level deeper. A heading's level is its depth and what follows it nests below it.
export function parseOutline(text) {
	const roots = []
	const path = [] // path[d] = the entry most recently added at depth d
	const indents = []
	let base = 0
	let previous = -1
	let count = 0

	for (const raw of String(text ?? "").split(/\r\n|\r|\n/)) {
		const line = raw.trimEnd()
		if (!line.trim()) continue
		const lead = /^[ \t]*/.exec(line)[0]
		let body = line.slice(lead.length)
		const heading = HEADING.exec(body)
		body = body.slice(heading ? heading[0].length : (BULLET.exec(body)?.[0].length ?? 0)).trim()
		if (!body) continue // empty bullets and headings change nothing
		let depth
		if (heading) {
			depth = heading[1].length - 1
			base = heading[1].length
			indents.length = 0
		} else {
			const width = indentWidth(lead)
			while (indents.length && indents[indents.length - 1] > width) indents.pop()
			if (!indents.length || indents[indents.length - 1] < width) indents.push(width)
			depth = base + indents.length - 1
		}
		if (count >= MAX_PASTE_LINES) break
		count++

		depth = Math.min(depth, previous + 1)
		const entry = { text: body.slice(0, NODE_TEXT_LIMIT), children: [] }
		;(depth === 0 ? roots : path[depth - 1].children).push(entry)
		path[depth] = entry
		previous = depth
	}
	return roots
}

export function countNodes(tree) {
	let total = 0
	const stack = [...(tree ?? [])]
	while (stack.length) {
		const entry = stack.pop()
		total++
		stack.push(...(entry.children ?? []))
	}
	return total
}

// A change set that adds the parsed entries under parentId, the first at order startOrder.
export function treeToChange({ mapId, parentId, startOrder = 0, tree }) {
	const add = []
	const stack = (tree ?? []).map((entry, i) => ({ entry, parentId, order: startOrder + i }))
	stack.reverse()
	while (stack.length) {
		const { entry, parentId: parent, order } = stack.pop()
		const node = createNode({ mapId, parentId: parent, order, text: entry.text, id: newId() })
		add.push(node)
		const children = entry.children ?? []
		for (let i = children.length - 1; i >= 0; i--)
			stack.push({ entry: children[i], parentId: node.id, order: i })
	}
	return { add, update: [], remove: [] }
}
