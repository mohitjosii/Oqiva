import { describe, expect, it } from "vitest"
import {
	FLOW_LIMITS,
	flattenFlowcharts,
	nestFlowcharts,
	repairChart,
	sanitizeChart,
	sanitizeFlowcharts,
	sanitizeFlowEdge,
	sanitizeFlowNode,
} from "./document"

const node = (id, extra = {}) => ({
	id,
	chartId: "c",
	type: "process",
	text: "Step",
	x: 0,
	y: 0,
	manual: false,
	...extra,
})
const edge = (id, from, to, extra = {}) => ({
	id,
	chartId: "c",
	from,
	to,
	label: "",
	order: 0,
	...extra,
})
const nested = () => [
	{
		id: "c1",
		direction: "LR",
		numbered: true,
		nodes: [
			{ id: "a", type: "terminator", text: "Start", x: 1, y: 2, manual: false },
			{ id: "b", type: "decision", text: "Ok?", x: 3, y: 4, manual: true },
		],
		edges: [{ id: "e1", from: "a", to: "b", label: "Yes", order: 2 }],
	},
	{ id: "c2", direction: "TB", numbered: false, nodes: [], edges: [] },
]

describe("sanitizeChart", () => {
	it("keeps a valid chart", () => {
		expect(sanitizeChart({ id: "c", direction: "LR", numbered: true, junk: 1 })).toEqual({
			id: "c",
			direction: "LR",
			numbered: true,
		})
	})
	it("defaults direction and numbered", () => {
		expect(sanitizeChart({ id: "c", direction: "diagonal", numbered: "yes" })).toEqual({
			id: "c",
			direction: "TB",
			numbered: false,
		})
	})
	it("refuses a bad id or garbage", () => {
		for (const raw of [null, undefined, 5, "x", [], {}, { id: "" }, { id: "a b" }, { id: 7 }])
			expect(sanitizeChart(raw)).toBeNull()
		expect(sanitizeChart({ id: "x".repeat(65) })).toBeNull()
	})
})

describe("sanitizeFlowNode", () => {
	it("keeps a valid node", () => {
		expect(sanitizeFlowNode(node("a", { x: 5.5, y: -3, manual: true }))).toEqual(
			node("a", { x: 5.5, y: -3, manual: true }),
		)
	})
	it("needs ids and a known type", () => {
		expect(sanitizeFlowNode(node("a b"))).toBeNull()
		expect(sanitizeFlowNode(node("a", { chartId: "" }))).toBeNull()
		expect(sanitizeFlowNode(node("a", { type: "oval" }))).toBeNull()
		expect(sanitizeFlowNode(node("a", { type: undefined }))).toBeNull()
		for (const raw of [null, 3, "n", []]) expect(sanitizeFlowNode(raw)).toBeNull()
	})
	it("cuts the text and tolerates a missing one", () => {
		expect(sanitizeFlowNode(node("a", { text: "x".repeat(900) })).text).toHaveLength(
			FLOW_LIMITS.text,
		)
		expect(sanitizeFlowNode(node("a", { text: 12 })).text).toBe("")
		expect(sanitizeFlowNode(node("a", { text: undefined })).text).toBe("")
	})
	it("clamps coordinates and replaces non-finite ones", () => {
		const n = sanitizeFlowNode(node("a", { x: 9e12, y: -9e12 }))
		expect([n.x, n.y]).toEqual([1_000_000, -1_000_000])
		for (const bad of [NaN, Infinity, "5", null, undefined]) {
			const m = sanitizeFlowNode(node("a", { x: bad, y: bad }))
			expect([m.x, m.y]).toEqual([0, 0])
		}
	})
	it("manual is true only for true", () => {
		expect(sanitizeFlowNode(node("a", { manual: "true" })).manual).toBe(false)
		expect(sanitizeFlowNode(node("a", { manual: 1 })).manual).toBe(false)
		expect(sanitizeFlowNode(node("a", { manual: true })).manual).toBe(true)
	})
})

describe("sanitizeFlowEdge", () => {
	it("keeps a valid edge", () => {
		expect(sanitizeFlowEdge(edge("e", "a", "b", { label: "Yes", order: 3 }))).toEqual(
			edge("e", "a", "b", { label: "Yes", order: 3 }),
		)
	})
	it("refuses bad ids, a loop and garbage", () => {
		expect(sanitizeFlowEdge(edge("e", "a", "a"))).toBeNull()
		expect(sanitizeFlowEdge(edge("e", "a", "b c"))).toBeNull()
		expect(sanitizeFlowEdge(edge("e", "", "b"))).toBeNull()
		expect(sanitizeFlowEdge(edge("", "a", "b"))).toBeNull()
		expect(sanitizeFlowEdge(edge("e", "a", "b", { chartId: 1 }))).toBeNull()
		for (const raw of [null, undefined, 1, "e", []]) expect(sanitizeFlowEdge(raw)).toBeNull()
	})
	it("cuts the label and normalises the order", () => {
		expect(
			sanitizeFlowEdge(edge("e", "a", "b", { label: "l".repeat(200) })).label,
		).toHaveLength(FLOW_LIMITS.label)
		expect(sanitizeFlowEdge(edge("e", "a", "b", { label: 5 })).label).toBe("")
		const order = (value) => sanitizeFlowEdge(edge("e", "a", "b", { order: value })).order
		expect(order(2.6)).toBe(3)
		expect(order(-4)).toBe(0)
		expect(order(5000)).toBe(FLOW_LIMITS.order)
		for (const bad of [NaN, Infinity, "2", null, undefined]) expect(order(bad)).toBe(0)
	})
})

describe("nest and flatten", () => {
	it("flattens into three lists and stamps the chart id", () => {
		const { charts, nodes, edges } = flattenFlowcharts(nested())
		expect(charts).toEqual([
			{ id: "c1", direction: "LR", numbered: true },
			{ id: "c2", direction: "TB", numbered: false },
		])
		expect(nodes.map((n) => [n.id, n.chartId])).toEqual([
			["a", "c1"],
			["b", "c1"],
		])
		expect(edges).toEqual([
			{ id: "e1", chartId: "c1", from: "a", to: "b", label: "Yes", order: 2 },
		])
	})
	it("round trips nested -> flat -> nested", () => {
		const { charts, nodes, edges } = flattenFlowcharts(nested())
		expect(nestFlowcharts(charts, nodes, edges)).toEqual(nested())
	})
	it("nest drops the chart id and ignores records of unknown charts", () => {
		const out = nestFlowcharts(
			[{ id: "c", direction: "TB", numbered: false }],
			[node("a"), node("z", { chartId: "other" })],
			[edge("e", "a", "b"), edge("f", "a", "b", { chartId: "other" })],
		)
		expect(out[0].nodes).toEqual([
			{ id: "a", type: "process", text: "Step", x: 0, y: 0, manual: false },
		])
		expect(out[0].edges).toHaveLength(1)
		expect(out[0].edges[0]).not.toHaveProperty("chartId")
	})
	it("tolerates garbage", () => {
		for (const raw of [undefined, null, 5, "x", {}, [null, 3, "x"]])
			expect(flattenFlowcharts(raw)).toEqual({ charts: [], nodes: [], edges: [] })
		const out = flattenFlowcharts([{ id: "c", nodes: "no", edges: 4 }])
		expect(out).toEqual({
			charts: [{ id: "c", direction: undefined, numbered: undefined }],
			nodes: [],
			edges: [],
		})
	})
})

describe("repairChart", () => {
	const chart = { id: "c", direction: "TB", numbered: false }

	it("keeps a clean chart as it is", () => {
		const nodes = [node("a"), node("b")]
		const edges = [edge("e", "a", "b")]
		const out = repairChart(chart, nodes, edges)
		expect(out).toEqual({ chart, nodes, edges })
	})
	it("returns null when no node is left", () => {
		expect(repairChart(chart, [], [])).toBeNull()
		expect(repairChart(chart, [node("a", { chartId: "z" })], [])).toBeNull()
		expect(repairChart(chart, [node("a")], [], new Set(["a"]))).toBeNull()
	})
	it("drops duplicate and taken node ids and nodes of other charts", () => {
		const out = repairChart(
			chart,
			[node("a"), node("a", { text: "dup" }), node("t"), node("o", { chartId: "x" })],
			[],
			new Set(["t"]),
		)
		expect(out.nodes.map((n) => [n.id, n.text])).toEqual([["a", "Step"]])
	})
	it("drops edges with a missing end, loops, repeats and duplicate ids", () => {
		const out = repairChart(
			chart,
			[node("a"), node("b"), node("c")],
			[
				edge("e1", "a", "b"),
				edge("e2", "a", "ghost"),
				edge("e3", "ghost", "b"),
				edge("e4", "b", "b"),
				edge("e5", "a", "b", { label: "again" }),
				edge("e1", "b", "c"),
				edge("e6", "b", "c"),
				edge("e7", "c", "a", { chartId: "x" }),
				edge("a", "c", "b"),
				edge("tk", "c", "a"),
			],
			new Set(["tk"]),
		)
		expect(out.edges.map((e) => e.id)).toEqual(["e1", "e6"])
	})
	it("keeps both directions between two nodes", () => {
		const out = repairChart(
			chart,
			[node("a"), node("b")],
			[edge("e1", "a", "b"), edge("e2", "b", "a")],
		)
		expect(out.edges).toHaveLength(2)
	})
	it("enforces the limits", () => {
		const nodes = Array.from({ length: FLOW_LIMITS.nodesPerChart + 20 }, (_, i) =>
			node(`n${i}`),
		)
		const edges = Array.from({ length: FLOW_LIMITS.edgesPerChart + 50 }, (_, i) =>
			edge(`e${i}`, `n${i % 400}`, `n${(i % 400) + 1 + Math.floor(i / 400)}`),
		)
		const out = repairChart(chart, nodes, edges)
		expect(out.nodes).toHaveLength(FLOW_LIMITS.nodesPerChart)
		expect(out.edges.length).toBeLessThanOrEqual(FLOW_LIMITS.edgesPerChart)
		const many = []
		for (let i = 0; i < 300; i++)
			for (let j = 1; j <= 4; j++) many.push(edge(`m${i}_${j}`, `n${i}`, `n${i + j}`))
		expect(repairChart(chart, nodes, many).edges).toHaveLength(FLOW_LIMITS.edgesPerChart)
	})
})

describe("sanitizeFlowcharts", () => {
	it("keeps a clean document unchanged", () => {
		const doc = nested().slice(0, 1)
		expect(sanitizeFlowcharts(doc)).toEqual({ flowcharts: doc, issues: [] })
	})
	it("drops a chart without nodes", () => {
		const { flowcharts, issues } = sanitizeFlowcharts(nested())
		expect(flowcharts.map((c) => c.id)).toEqual(["c1"])
		expect(issues).toEqual(["dropped flowchart c2: no nodes"])
	})
	it("is tolerant of anything", () => {
		for (const raw of [undefined, null, 4, "x", {}, true])
			expect(sanitizeFlowcharts(raw)).toEqual({ flowcharts: [], issues: [] })
		const out = sanitizeFlowcharts([
			null,
			7,
			"x",
			{ id: "bad id", nodes: [] },
			{ id: "c", nodes: "x", edges: null },
			{
				id: "d",
				nodes: [null, 4, { id: "n", type: "process" }],
				edges: [5, null, { id: "e" }],
			},
		])
		expect(out.flowcharts).toEqual([
			{
				id: "d",
				direction: "TB",
				numbered: false,
				nodes: [{ id: "n", type: "process", text: "", x: 0, y: 0, manual: false }],
				edges: [],
			},
		])
		expect(out.issues.length).toBeGreaterThan(0)
	})
	it("cleans nodes and edges and reports a repair", () => {
		const { flowcharts, issues } = sanitizeFlowcharts([
			{
				id: "c",
				direction: "up",
				nodes: [
					{ id: "a", type: "terminator", text: "S", x: NaN, y: 4 },
					{ id: "b", type: "weird" },
					{ id: "a", type: "process" },
					{ id: "d", type: "io", text: "t".repeat(1000), x: 1e9 },
				],
				edges: [
					{ id: "e1", from: "a", to: "d", order: 1.4 },
					{ id: "e2", from: "a", to: "b" },
					{ id: "e3", from: "a", to: "a" },
				],
			},
		])
		const chart = flowcharts[0]
		expect(chart.direction).toBe("TB")
		expect(chart.nodes.map((n) => n.id)).toEqual(["a", "d"])
		expect(chart.nodes[0]).toMatchObject({ x: 0, y: 4, text: "S" })
		expect(chart.nodes[1].text).toHaveLength(FLOW_LIMITS.text)
		expect(chart.nodes[1].x).toBe(1_000_000)
		expect(chart.edges).toEqual([{ id: "e1", from: "a", to: "d", label: "", order: 1 }])
		expect(issues).toEqual(["repaired flowchart c"])
	})
	it("does not let charts or objects reuse ids", () => {
		const one = (id, nodeId) => ({
			id,
			nodes: [{ id: nodeId, type: "process" }],
			edges: [],
		})
		const { flowcharts, issues } = sanitizeFlowcharts(
			[
				one("c1", "n1"),
				one("c1", "n2"),
				one("c3", "n1"),
				one("c4", "taken"),
				one("taken", "n9"),
			],
			new Set(["taken"]),
		)
		// c3's only node reuses n1, so c3 is dropped; c4's node is taken; "taken" is a reused id
		expect(flowcharts.map((c) => c.id)).toEqual(["c1"])
		expect(issues).toHaveLength(4)
	})
	it("limits the number of charts", () => {
		const raw = Array.from({ length: FLOW_LIMITS.charts + 5 }, (_, i) => ({
			id: `c${i}`,
			nodes: [{ id: `n${i}`, type: "process" }],
		}))
		const { flowcharts, issues } = sanitizeFlowcharts(raw)
		expect(flowcharts).toHaveLength(FLOW_LIMITS.charts)
		expect(issues).toContain("dropped a flowchart over the limit")
	})
	it("limits nodes and edges within a chart", () => {
		const nodes = Array.from({ length: FLOW_LIMITS.nodesPerChart + 10 }, (_, i) => ({
			id: `n${i}`,
			type: "process",
		}))
		const { flowcharts } = sanitizeFlowcharts([{ id: "c", nodes, edges: [] }])
		expect(flowcharts[0].nodes).toHaveLength(FLOW_LIMITS.nodesPerChart)
	})
	it("never lets an edge id equal a node id of the same chart", () => {
		const { flowcharts } = sanitizeFlowcharts([
			{
				id: "c",
				nodes: [
					{ id: "a", type: "process" },
					{ id: "b", type: "process" },
				],
				edges: [{ id: "a", from: "a", to: "b" }],
			},
		])
		expect(flowcharts[0].edges).toEqual([])
	})
	it("does not mutate its input", () => {
		const raw = nested()
		const before = JSON.stringify(raw)
		sanitizeFlowcharts(raw)
		expect(JSON.stringify(raw)).toBe(before)
	})
})
