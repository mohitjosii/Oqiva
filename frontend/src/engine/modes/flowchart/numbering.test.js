import { describe, expect, it } from "vitest"
import { stepNumbers } from "./numbering"
import { flow } from "./testUtils"

const numbers = (spec) => {
	const { chart, nodes, edges } = flow(spec)
	return Object.fromEntries(stepNumbers(chart, nodes, edges))
}

describe("stepNumbers", () => {
	it("numbers a straight flow from 1 and skips terminators and junctions", () => {
		expect(
			numbers({
				nodes: [
					["s", "terminator"],
					["a", "process"],
					["j", "junction"],
					["b", "io"],
					["e", "terminator"],
				],
				edges: [
					["s", "a"],
					["a", "j"],
					["j", "b"],
					["b", "e"],
				],
			}),
		).toEqual({ a: 1, b: 2 })
	})

	it("counts breadth first, outputs by their order", () => {
		// d -> (No: y, Yes: x); the order values, not the array order, decide
		const result = numbers({
			nodes: [
				["s", "terminator"],
				["d", "decision"],
				["y", "process"],
				["x", "process"],
				["x2", "process"],
				["y2", "process"],
			],
			edges: [
				["s", "d"],
				["d", "y", "Yes", 1],
				["d", "x", "No", 0],
				["x", "x2"],
				["y", "y2"],
			],
		})
		expect(result).toEqual({ d: 1, x: 2, y: 3, x2: 4, y2: 5 })
	})

	it("visits a merge node once", () => {
		const result = numbers({
			nodes: [
				["d", "decision"],
				["a", "process"],
				["b", "process"],
				["m", "process"],
			],
			edges: [
				["d", "a", "", 0],
				["d", "b", "", 1],
				["a", "m"],
				["b", "m"],
			],
		})
		expect(result).toEqual({ d: 1, a: 2, b: 3, m: 4 })
	})

	it("passes through a loop back to an earlier node without renumbering", () => {
		const result = numbers({
			nodes: [
				["s", "terminator"],
				["a", "process"],
				["d", "decision"],
				["e", "terminator"],
			],
			edges: [
				["s", "a"],
				["a", "d"],
				["d", "a", "No", 1],
				["d", "e", "Yes", 0],
			],
		})
		expect(result).toEqual({ a: 1, d: 2 })
	})

	it("numbers several sources in node order", () => {
		expect(
			numbers({
				nodes: [
					["b", "process"],
					["a", "process"],
					["c", "process"],
				],
				edges: [["a", "c"]],
			}),
		).toEqual({ b: 1, a: 2, c: 3 })
	})

	it("numbers an unreached cycle after the rest, in id order", () => {
		const result = numbers({
			nodes: [
				["s", "process"],
				["z", "process"],
				["m", "process"],
				["k", "terminator"],
				["a", "process"],
			],
			edges: [
				["z", "m"],
				["m", "a"],
				["a", "z"],
			],
		})
		// "s" has no way in: it is a source; the cycle a -> z -> m has none.
		expect(result).toEqual({ s: 1, a: 2, m: 3, z: 4 })
	})

	it("numbers nothing for an empty chart and ignores edges to missing nodes", () => {
		expect(numbers({})).toEqual({})
		const { chart, nodes } = flow({ nodes: [["a", "process"]] })
		const edges = [{ id: "e", chartId: "c", from: "a", to: "ghost", label: "", order: 0 }]
		expect(Object.fromEntries(stepNumbers(chart, nodes, edges))).toEqual({ a: 1 })
	})

	it("is deterministic and does not mutate its input", () => {
		const { chart, nodes, edges } = flow({
			nodes: [
				["a", "process"],
				["b", "process"],
				["c", "process"],
			],
			edges: [
				["a", "b"],
				["b", "c"],
				["c", "a"],
			],
		})
		const before = JSON.stringify([nodes, edges])
		const first = [...stepNumbers(chart, nodes, edges)]
		const second = [...stepNumbers(chart, [...nodes].reverse(), [...edges].reverse())]
		expect(first).toEqual([...stepNumbers(chart, nodes, edges)])
		expect(Object.fromEntries(second)).toEqual({ a: 1, b: 2, c: 3 })
		expect(JSON.stringify([nodes, edges])).toBe(before)
	})
})
