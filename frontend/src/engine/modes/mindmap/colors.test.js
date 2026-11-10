import { describe, expect, it } from "vitest"
import {
	BRANCH_PALETTE,
	branchColor,
	branchColors,
	ROOT_COLOR,
	shade,
	textColorFor,
} from "./colors"
import { build } from "./testUtils"

const withColor = (nodes, id, color) => nodes.map((n) => (n.id === id ? { ...n, color } : n))

describe("branch colours", () => {
	const nodes = build(["R", ["A", ["A1", ["A1a"]]], ["B", ["B1"]], ["C"]])

	it("has the eight palette colours", () => {
		expect(BRANCH_PALETTE).toEqual([
			"#3B82F6",
			"#22C55E",
			"#F97316",
			"#8B5CF6",
			"#EC4899",
			"#14B8A6",
			"#EAB308",
			"#EF4444",
		])
	})
	it("gives the root a neutral colour", () => {
		expect(branchColor(nodes, "R")).toBe("#64748B")
		expect(ROOT_COLOR).toBe("#64748B")
	})
	it("gives each first-level branch a palette colour and its descendants the same", () => {
		expect(branchColor(nodes, "A")).toBe(BRANCH_PALETTE[0])
		expect(branchColor(nodes, "A1")).toBe(BRANCH_PALETTE[0])
		expect(branchColor(nodes, "A1a")).toBe(BRANCH_PALETTE[0])
		expect(branchColor(nodes, "B")).toBe(BRANCH_PALETTE[1])
		expect(branchColor(nodes, "B1")).toBe(BRANCH_PALETTE[1])
		expect(branchColor(nodes, "C")).toBe(BRANCH_PALETTE[2])
	})
	it("follows sibling order, not array order", () => {
		const swapped = nodes.map((n) =>
			n.id === "A" ? { ...n, order: 2 } : n.id === "C" ? { ...n, order: 0 } : n,
		)
		expect(branchColor(swapped, "C")).toBe(BRANCH_PALETTE[0])
		expect(branchColor(swapped, "A1")).toBe(BRANCH_PALETTE[2])
	})
	it("cycles through the palette", () => {
		const many = build(["R", ...Array.from({ length: 10 }, (_, i) => [`c${i}`, [`g${i}`]])])
		expect(branchColor(many, "c8")).toBe(BRANCH_PALETTE[0])
		expect(branchColor(many, "g9")).toBe(BRANCH_PALETTE[1])
	})
	it("uses a node's own colour, which its descendants inherit", () => {
		const set = withColor(nodes, "A1", "#123456")
		expect(branchColor(set, "A1")).toBe("#123456")
		expect(branchColor(set, "A1a")).toBe("#123456")
		expect(branchColor(set, "A")).toBe(BRANCH_PALETTE[0])
	})
	it("lets the nearest ancestor win", () => {
		const set = withColor(withColor(nodes, "A", "#111111"), "A1", "#222222")
		expect(branchColor(set, "A1a")).toBe("#222222")
		expect(branchColor(set, "A")).toBe("#111111")
		expect(branchColor(withColor(nodes, "A", "#111111"), "A1a")).toBe("#111111")
	})
	it("lets the root have its own colour without recolouring the branches", () => {
		const set = withColor(nodes, "R", "#ABCDEF")
		expect(branchColor(set, "R")).toBe("#ABCDEF")
		expect(branchColor(set, "A1")).toBe(BRANCH_PALETTE[0])
	})
	it("returns null for an unknown node", () => {
		expect(branchColor(nodes, "nope")).toBeNull()
	})
	it("branchColors agrees with branchColor for every node", () => {
		const set = withColor(nodes, "B", "#0F0F0F")
		const all = branchColors(set)
		expect(all.size).toBe(set.length)
		for (const n of set) expect(all.get(n.id)).toBe(branchColor(set, n.id))
	})
})

describe("shade", () => {
	it("returns the colour itself at depth 1 and below", () => {
		expect(shade("#3B82F6", 1)).toBe("#3B82F6")
		expect(shade("#3B82F6", 0)).toBe("#3B82F6")
	})
	it("gets lighter with depth and is capped", () => {
		const lum = (hex) => [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0)
		const levels = [1, 2, 3, 4, 5, 6].map((d) => shade("#3B82F6", d))
		for (let i = 1; i < levels.length; i++)
			expect(lum(levels[i])).toBeGreaterThan(lum(levels[i - 1]))
		expect(shade("#3B82F6", 20)).toBe(shade("#3B82F6", 7))
		expect(shade("#3B82F6", 20)).not.toBe("#FFFFFF")
	})
	it("mixes toward white by 12% per level", () => {
		expect(shade("#000000", 2)).toBe("#1F1F1F") // 255 * 0.12 = 30.6 -> 31
	})
	it("passes an invalid colour through", () => {
		expect(shade("blue", 3)).toBe("blue")
	})
})

describe("textColorFor", () => {
	it("is white on dark colours and near-black on light ones", () => {
		expect(textColorFor("#000000")).toBe("#FFFFFF")
		expect(textColorFor("#3B82F6")).toBe("#FFFFFF")
		expect(textColorFor("#64748B")).toBe("#FFFFFF")
		expect(textColorFor("#FFFFFF")).toBe("#111827")
		expect(textColorFor("#EAB308")).toBe("#111827")
		expect(textColorFor("#fde68a")).toBe("#111827")
	})
	it("falls back to dark text on junk", () => {
		expect(textColorFor("nope")).toBe("#111827")
		expect(textColorFor(null)).toBe("#111827")
	})
})
