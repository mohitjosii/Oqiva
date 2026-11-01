// Lays rich text out in lines of a given width. It wraps at spaces, breaks a word that is
// longer than a line, and honours "\n". Measuring is injected, so layout is the same in the
// browser (real fonts) and in tests (a fake ruler).

export const LINE_HEIGHT = 1.3

function tokenize(paragraph) {
	const tokens = []
	for (const run of paragraph.runs) {
		for (const piece of run.t.split(/(\n|[ \t]+)/)) {
			if (!piece) continue
			const style = { b: run.b, i: run.i, u: run.u, c: run.c }
			tokens.push({
				t: piece,
				kind: piece === "\n" ? "break" : /^[ \t]+$/.test(piece) ? "space" : "word",
				...style,
			})
		}
	}
	return tokens
}

function pushRun(line, token, width) {
	const last = line.runs[line.runs.length - 1]
	if (
		last &&
		last.b === token.b &&
		last.i === token.i &&
		last.u === token.u &&
		last.c === token.c
	) {
		last.t += token.t
		last.width += width
	} else {
		line.runs.push({ t: token.t, b: token.b, i: token.i, u: token.u, c: token.c, width })
	}
	line.width += width
}

function trimTrailingSpace(line) {
	while (line.runs.length) {
		const last = line.runs[line.runs.length - 1]
		const trimmed = last.t.replace(/[ \t]+$/, "")
		if (trimmed === last.t) break
		if (trimmed) {
			last.t = trimmed
			break
		}
		line.runs.pop()
	}
	return line
}

// ``text`` is a stored rich text value. Returns {lines, height, lineHeight} where each
// line is {runs: [{t, b, i, u, c, width}], width}, in a block ``width`` wide.
export function layoutText(text, { width, measure }) {
	const size = text.size
	const lineHeight = size * LINE_HEIGHT
	const lines = []
	const ruler = (token) => measure(token.t, { size, b: token.b, i: token.i })
	for (const paragraph of text.paragraphs) {
		let line = { runs: [], width: 0 }
		const finish = () => {
			const done = trimTrailingSpace(line)
			done.width = done.runs.reduce((sum, run) => sum + run.width, 0)
			lines.push(done)
			line = { runs: [], width: 0 }
		}
		for (const token of tokenize(paragraph)) {
			if (token.kind === "break") {
				finish()
				continue
			}
			const tokenWidth = ruler(token)
			if (token.kind === "word" && line.width + tokenWidth > width && line.runs.length)
				finish()
			if (token.kind === "word" && tokenWidth > width) {
				// A word wider than the line is broken wherever it no longer fits.
				for (const char of token.t) {
					const charWidth = ruler({ ...token, t: char })
					if (line.width + charWidth > width && line.runs.length) finish()
					pushRun(line, { ...token, t: char }, charWidth)
				}
				continue
			}
			pushRun(line, token, tokenWidth)
		}
		finish()
	}
	return { lines, lineHeight, height: lines.length * lineHeight }
}
