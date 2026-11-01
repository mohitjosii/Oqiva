import { describe, expect, it } from "vitest"
import { autoHeight } from "./fit"
import { layoutText } from "./layout"
import { fromProseMirror, isEmptyText, plainText, toProseMirror } from "./richText"

// A fake ruler: every character is half the font size wide, bold ones a little wider.
const measure = (text, style) => text.length * style.size * (style.b ? 0.6 : 0.5)
const text = (paragraphs, over = {}) => ({
	align: "center",
	size: 10,
	color: "#111111",
	paragraphs,
	...over,
})
const para = (...runs) => ({ runs })
const lineTexts = (layout) => layout.lines.map((line) => line.runs.map((run) => run.t).join(""))

describe("layoutText", () => {
	it("wraps at spaces and drops the trailing space of a wrapped line", () => {
		// 5px per char, width 50 -> 10 chars per line
		const layout = layoutText(text([para({ t: "hello brave new world" })]), {
			width: 50,
			measure,
		})
		expect(lineTexts(layout)).toEqual(["hello", "brave new", "world"])
		expect(layout.height).toBeCloseTo(3 * 13)
		for (const line of layout.lines) expect(line.width).toBeLessThanOrEqual(50)
	})

	it("breaks a word that is wider than the line", () => {
		const layout = layoutText(text([para({ t: "abcdefghijklmnopqrstuvwxyz" })]), {
			width: 50,
			measure,
		})
		expect(lineTexts(layout)).toEqual(["abcdefghij", "klmnopqrst", "uvwxyz"])
	})

	it("honours line breaks and keeps empty paragraphs as blank lines", () => {
		const layout = layoutText(text([para({ t: "one\ntwo" }), para(), para({ t: "three" })]), {
			width: 500,
			measure,
		})
		expect(lineTexts(layout)).toEqual(["one", "two", "", "three"])
	})

	it("keeps styles on the runs they belong to, and measures bold wider", () => {
		const layout = layoutText(text([para({ t: "plain " }, { t: "bold", b: 1 })]), {
			width: 500,
			measure,
		})
		const [line] = layout.lines
		expect(line.runs.map((r) => [r.t, r.b])).toEqual([
			["plain ", undefined],
			["bold", 1],
		])
		expect(line.width).toBeCloseTo(6 * 5 + 4 * 6)
	})

	it("gives an empty text one line of height", () => {
		const layout = layoutText(text([para()]), { width: 100, measure })
		expect(layout.lines).toHaveLength(1)
		expect(layout.height).toBeCloseTo(13)
	})
})

describe("rich text conversion", () => {
	const base = { align: "left", size: 16, color: "#222222" }

	it("round-trips marks, colour and line breaks through Tiptap's JSON", () => {
		const stored = text(
			[
				para({ t: "Hello " }, { t: "world", b: 1, u: 1 }, { t: "!", c: "#ff0000" }),
				para({ t: "a\nb", i: 1 }),
			],
			base,
		)
		const back = fromProseMirror(toProseMirror(stored), base)
		expect(back.paragraphs).toEqual(stored.paragraphs)
		expect(plainText(back)).toBe("Hello world!\na\nb")
	})

	it("drops the default colour from runs and merges neighbours with the same style", () => {
		const json = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "a",
							marks: [{ type: "textStyle", attrs: { color: "#222222" } }],
						},
						{ type: "text", text: "b" },
					],
				},
			],
		}
		expect(fromProseMirror(json, base).paragraphs).toEqual([{ runs: [{ t: "ab" }] }])
	})

	it("treats an empty editor as empty text", () => {
		const empty = fromProseMirror({ type: "doc", content: [{ type: "paragraph" }] }, base)
		expect(isEmptyText(empty)).toBe(true)
		expect(isEmptyText(null)).toBe(true)
		expect(isEmptyText(text([para({ t: "  " })]))).toBe(true)
		expect(isEmptyText(text([para({ t: "x" })]))).toBe(false)
	})
})

describe("autoHeight", () => {
	const shape = (over = {}) => ({
		kind: "shape",
		shape: "rectangle",
		x: 0,
		y: 0,
		w: 74,
		h: 30,
		rotation: 0,
		...over,
	})

	it("grows a shape that is too short for its text, and never shrinks it", () => {
		// text area width = 74 - 24 = 50px -> 3 lines of 13px = 39px, plus 12px padding
		const tall = autoHeight(
			shape({ text: text([para({ t: "hello brave new world" })]) }),
			measure,
		)
		expect(tall).toBe(51)
		const roomy = autoHeight(shape({ h: 200, text: text([para({ t: "hi" })]) }), measure)
		expect(roomy).toBeNull()
	})

	it("makes a text box follow its text in both directions", () => {
		const box = shape({ kind: "text", h: 200, text: text([para({ t: "hi" })]) })
		expect(autoHeight(box, measure)).toBe(25) // one line (13) + padding (12)
		const exact = shape({ kind: "text", h: 25, text: text([para({ t: "hi" })]) })
		expect(autoHeight(exact, measure)).toBeNull()
	})

	it("needs more height for the smaller text area of a diamond", () => {
		const text1 = text([para({ t: "hello" })])
		const rectHeight = autoHeight(shape({ h: 1, text: text1 }), measure)
		const diamondHeight = autoHeight(
			shape({ shape: "diamond", w: 148, h: 1, text: text1 }),
			measure,
		)
		expect(diamondHeight).toBeGreaterThan(rectHeight)
	})

	it("has nothing to fit when there is no text", () => {
		expect(autoHeight(shape(), measure)).toBeNull()
	})
})
