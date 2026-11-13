// Flowchart records, as the store holds them. They are flat: a chart, its nodes (each with a
// centre position) and its edges (each naming two nodes). A node's size comes from its type and
// its text (see ``nodeSize``), so a document stores only where the centre is.

import { newId } from "../../model/ids"

export const NODE_TYPES = ["terminator", "process", "decision", "io", "junction"]
export const DIRECTIONS = ["TB", "LR"] // top to bottom, left to right
export const FLOW_TEXT_LIMIT = 200
export const FLOW_LABEL_LIMIT = 60
export const MAX_NODES = 500
export const MAX_EDGES = 800
export const MAX_CHARTS = 50

// What each node type is called, how big it starts, and what a new one says.
export const TYPE_INFO = {
	terminator: { label: "Start / end", w: 160, h: 56, text: "Start" },
	process: { label: "Process", w: 170, h: 64, text: "Step" },
	decision: { label: "Decision", w: 190, h: 120, text: "Decision?" },
	io: { label: "Input / output", w: 180, h: 64, text: "Input" },
	junction: { label: "Junction", w: 24, h: 24, text: "" },
}

// Gaps the layout leaves between neighbours, along the flow and across it.
export const GAPS = { along: 70, across: 60 }

export const createChart = ({ id, direction = "TB", numbered = false } = {}) => ({
	id: id ?? newId(),
	direction: DIRECTIONS.includes(direction) ? direction : "TB",
	numbered: Boolean(numbered),
})

// ``x`` and ``y`` are the CENTRE of the node. ``manual`` is true once the person has moved it by
// hand: Tidy up places it again and clears the flag.
export function createFlowNode({
	id,
	chartId,
	type = "process",
	text,
	x = 0,
	y = 0,
	manual = false,
	fontSize = null,
}) {
	const kind = NODE_TYPES.includes(type) ? type : "process"
	return {
		id: id ?? newId(),
		chartId,
		type: kind,
		text: String(text ?? TYPE_INFO[kind].text).slice(0, FLOW_TEXT_LIMIT),
		x,
		y,
		manual: Boolean(manual),
		...(fontSize ? { fontSize } : {}),
	}
}

// ``order`` ranks the outputs of one node (the first output of a decision is "Yes").
export const createFlowEdge = ({ id, chartId, from, to, label = "", order = 0 }) => ({
	id: id ?? newId(),
	chartId,
	from,
	to,
	label: String(label ?? "").slice(0, FLOW_LABEL_LIMIT),
	order,
})

export const FLOW_FONT_SIZE = 15 // the text size of a step that has no size of its own
export const FLOW_FONT_RANGE = { min: 8, max: 200 }
// The size a step's text is drawn at: its own, or the default.
export const fontSizeOf = (node) => node?.fontSize || FLOW_FONT_SIZE
const LINE_HEIGHT = 1.35
const PADDING = { x: 20, y: 12 }
const MAX_TEXT_WIDTH = 220
// The room text needs inside a node: a diamond wastes its corners, so it needs more.
const TEXT_ROOM = { decision: { w: 1.7, h: 1.9 }, io: { w: 1.25, h: 1 } }

// Splits a line at word breaks so each piece fits ``inner`` pixels (a long word is cut).
export function wrapFlowText(text, measure, inner = MAX_TEXT_WIDTH, size = FLOW_FONT_SIZE) {
	const lines = []
	for (const raw of String(text ?? "").split("\n")) {
		if (!raw || measure(raw, size) <= inner) {
			lines.push(raw)
			continue
		}
		let current = ""
		for (const word of raw.split(/\s+/).filter(Boolean)) {
			const next = current ? `${current} ${word}` : word
			if (measure(next, size) <= inner) current = next
			else {
				if (current) lines.push(current)
				current = word
				while (measure(current, size) > inner && current.length > 1) {
					let cut = current.length - 1
					while (cut > 1 && measure(current.slice(0, cut), size) > inner) cut--
					lines.push(current.slice(0, cut))
					current = current.slice(cut)
				}
			}
		}
		lines.push(current)
	}
	return lines.length ? lines : [""]
}

// {w, h} of a node: its type's size, grown when its text needs more room. ``measure(text, size)`` is
// the text measurer (see modes/mindmap/layouts.js ``sized``).
export function nodeSize(node, measure) {
	const info = TYPE_INFO[node.type] ?? TYPE_INFO.process
	if (node.type === "junction" || !node.text) return { w: info.w, h: info.h }
	const room = TEXT_ROOM[node.type] ?? { w: 1, h: 1 }
	const size = fontSizeOf(node)
	// a larger size gets a wider line before it wraps, so the shape grows in step with its text
	const lines = wrapFlowText(
		node.text,
		measure,
		Math.max(MAX_TEXT_WIDTH, MAX_TEXT_WIDTH * (size / FLOW_FONT_SIZE)),
		size,
	)
	const widest = Math.max(...lines.map((line) => measure(line, size)))
	const textH = lines.length * size * LINE_HEIGHT
	return {
		w: Math.max(info.w, Math.round((widest + PADDING.x * 2) * room.w)),
		h: Math.max(info.h, Math.round((textH + PADDING.y * 2) * room.h)),
	}
}
