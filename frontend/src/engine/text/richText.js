// Rich text in the document: paragraphs of runs. A run is a stretch of text that shares
// bold, italic, underline and colour: {t, b?, i?, u?, c?}. Size and alignment belong to
// the whole object. A line break inside a paragraph is a "\n" in a run.

export const plainText = (text) =>
	(text?.paragraphs || []).map((p) => p.runs.map((run) => run.t).join("")).join("\n")

export const isEmptyText = (text) => !plainText(text).trim()

const sameStyle = (a, b) => a.b === b.b && a.i === b.i && a.u === b.u && a.c === b.c

function mergeRuns(runs) {
	const merged = []
	for (const run of runs) {
		const last = merged[merged.length - 1]
		if (last && sameStyle(last, run)) last.t += run.t
		else merged.push({ ...run })
	}
	return merged
}

function runFromNode(node, base) {
	const run = { t: node.text }
	for (const mark of node.marks || []) {
		if (mark.type === "bold") run.b = 1
		else if (mark.type === "italic") run.i = 1
		else if (mark.type === "underline") run.u = 1
		else if (mark.type === "textStyle" && mark.attrs?.color && mark.attrs.color !== base.color)
			run.c = mark.attrs.color
	}
	return run
}

// Tiptap's document JSON to the stored form. ``base`` carries the object's size, colour and alignment.
export function fromProseMirror(json, base) {
	const paragraphs = (json?.content || []).map((paragraph) => {
		const runs = []
		for (const node of paragraph.content || []) {
			if (node.type === "text" && node.text) runs.push(runFromNode(node, base))
			else if (node.type === "hardBreak")
				runs.push(runFromNode({ text: "\n", marks: node.marks }, base))
		}
		return { runs: mergeRuns(runs) }
	})
	return {
		align: base.align,
		size: base.size,
		color: base.color,
		paragraphs: paragraphs.length ? paragraphs : [{ runs: [] }],
	}
}

// The stored form to Tiptap's document JSON.
export function toProseMirror(text) {
	const paragraphs = text?.paragraphs?.length ? text.paragraphs : [{ runs: [] }]
	return {
		type: "doc",
		content: paragraphs.map((paragraph) => {
			const content = []
			for (const run of paragraph.runs) {
				const marks = []
				if (run.b) marks.push({ type: "bold" })
				if (run.i) marks.push({ type: "italic" })
				if (run.u) marks.push({ type: "underline" })
				if (run.c) marks.push({ type: "textStyle", attrs: { color: run.c } })
				const withMarks = marks.length ? { marks } : {}
				// The break carries the run's marks so a styled run stays one run on the way back.
				run.t.split("\n").forEach((piece, index) => {
					if (index > 0) content.push({ type: "hardBreak", ...withMarks })
					if (piece) content.push({ type: "text", text: piece, ...withMarks })
				})
			}
			return { type: "paragraph", ...(content.length ? { content } : {}) }
		}),
	}
}
