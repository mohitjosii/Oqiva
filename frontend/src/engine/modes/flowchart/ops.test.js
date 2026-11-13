import { describe, expect, it } from "vitest"
import { placeChild, tidyLayout } from "./layout"
import { GAPS, FLOW_LABEL_LIMIT, FLOW_TEXT_LIMIT, nodeSize, TYPE_INFO } from "./model"
import {
	addDecisionBranch,
	addNodeAt,
	addNodeFrom,
	applyChartPatch,
	applyFlowChange,
	branchLabel,
	connect,
	deleteChartChange,
	emptyChange,
	inEdges,
	insertOnEdge,
	isEmptyChange,
	moveNodes,
	newChartChange,
	outEdges,
	predecessors,
	removeBranch,
	removeEdge,
	removeNode,
	reorderBranches,
	setDirection,
	setEdgeLabel,
	setNodePosition,
	setNodeText,
	setNumbered,
	sourcesOf,
	spliceNodeOnEdge,
	successors,
	swapType,
	tidyChange,
} from "./ops"
import { flow, frozen, measure } from "./testUtils"

const sizeOf = (node) => nodeSize(node, measure)
const nodeById = (nodes, id) => nodes.find((n) => n.id === id)
const edgeById = (edges, id) => edges.find((e) => e.id === id)
const updatedIds = (change) => change.update.nodes.map((u) => u.id).sort()

// start -> decide -(Yes)-> yes, decide -(No)-> no
const branching = () =>
	flow({
		nodes: [
			["start", "terminator", 0, 0],
			["decide", "decision", 0, 150],
			["yes", "process", -150, 330],
			["no", "process", 150, 330],
		],
		edges: [
			["start", "decide"],
			["decide", "yes", "Yes", 0],
			["decide", "no", "No", 1],
		],
	})

describe("graph helpers", () => {
	const g = branching()
	it("sorts outputs by order then id", () => {
		const { edges } = flow({
			nodes: [["a"], ["b"], ["c"], ["d"]],
			edges: [
				["a", "d", "", 2],
				["a", "b", "", 1],
				["a", "c", "", 1],
			],
		})
		expect(outEdges(edges, "a").map((e) => e.id)).toEqual(["a>b", "a>c", "a>d"])
	})
	it("reads neighbours and sources", () => {
		expect(inEdges(g.edges, "decide").map((e) => e.from)).toEqual(["start"])
		expect(successors(g.edges, "decide")).toEqual(["yes", "no"])
		expect(predecessors(g.edges, "yes")).toEqual(["decide"])
		expect(sourcesOf(g.nodes, g.edges).map((n) => n.id)).toEqual(["start"])
		expect(outEdges(g.edges, "yes")).toEqual([])
	})
	it("labels branches", () => {
		expect([0, 1, 2, 3, 9].map(branchLabel)).toEqual([
			"Yes",
			"No",
			"Option 3",
			"Option 4",
			"Option 10",
		])
	})
})

describe("change sets", () => {
	it("an empty change is empty", () => {
		expect(isEmptyChange(emptyChange())).toBe(true)
		expect(isEmptyChange(null)).toBe(true)
		expect(isEmptyChange({ ...emptyChange(), chart: { numbered: true } })).toBe(false)
		const withRemove = emptyChange()
		withRemove.remove.edges.push("x")
		expect(isEmptyChange(withRemove)).toBe(false)
	})
	it("applies removals, patches and additions", () => {
		const { nodes, edges } = flow({
			nodes: [["a"], ["b"]],
			edges: [["a", "b"]],
		})
		const change = emptyChange()
		change.remove.nodes.push("b")
		change.remove.edges.push("a>b")
		change.update.nodes.push({ id: "a", patch: { x: 9 } }, { id: "ghost", patch: { x: 1 } })
		change.add.nodes.push({ id: "c", chartId: "c" })
		change.add.edges.push({ id: "e", from: "a", to: "c" })
		const out = applyFlowChange(nodes, edges, change)
		expect(out.nodes.map((n) => [n.id, n.x])).toEqual([
			["a", 9],
			["c", undefined],
		])
		expect(out.edges.map((e) => e.id)).toEqual(["e"])
		expect(nodes).toHaveLength(2)
	})
	it("applies a chart patch and tolerates null", () => {
		const { chart, nodes, edges } = flow({ nodes: [["a"]] })
		expect(applyChartPatch(chart, { chart: { direction: "LR" } }).direction).toBe("LR")
		expect(applyChartPatch(chart, emptyChange())).toBe(chart)
		expect(applyChartPatch(chart, null)).toBe(chart)
		expect(applyFlowChange(nodes, edges, null)).toEqual({ nodes, edges })
	})
})

describe("addNodeFrom", () => {
	it("adds a node placed by the layout and joined to the source", () => {
		const { chart, nodes, edges } = flow({
			nodes: [["start", "terminator", 0, 0]],
		})
		const before = frozen(chart, nodes, edges)
		const change = addNodeFrom(chart, nodes, edges, "start", "process", { measure })
		const node = change.add.nodes[0]
		const at = placeChild(chart, nodes, edges, "start", "process", measure, { branch: 0 })
		expect(node).toMatchObject({
			chartId: "c",
			type: "process",
			text: "Step",
			manual: false,
			x: at.x,
			y: at.y,
		})
		expect(change.add.edges).toEqual([
			{
				id: expect.any(String),
				chartId: "c",
				from: "start",
				to: node.id,
				label: "",
				order: 0,
			},
		])
		expect(change.update).toEqual({ nodes: [], edges: [] })
		expect(change.remove).toEqual({ nodes: [], edges: [] })
		expect(change.chart).toBeUndefined()
		expect(frozen(chart, nodes, edges)).toBe(before)
	})
	it("uses the given text and every node type", () => {
		const { chart, nodes, edges } = flow({ nodes: [["a", "process"]] })
		const change = addNodeFrom(chart, nodes, edges, "a", "io", { text: "Read", measure })
		expect(change.add.nodes[0]).toMatchObject({ type: "io", text: "Read" })
		for (const type of Object.keys(TYPE_INFO)) {
			const c = addNodeFrom(chart, nodes, edges, "a", type, { measure })
			expect(c.add.nodes[0].text).toBe(TYPE_INFO[type].text)
		}
	})
	it("labels the outputs of a decision Yes, No, Option 3 and orders them", () => {
		let { chart, nodes, edges } = flow({ nodes: [["d", "decision", 0, 0]] })
		const seen = []
		for (let i = 0; i < 4; i++) {
			const change = addNodeFrom(chart, nodes, edges, "d", "process", { measure })
			seen.push([change.add.edges[0].label, change.add.edges[0].order])
			;({ nodes, edges } = applyFlowChange(nodes, edges, change))
		}
		expect(seen).toEqual([
			["Yes", 0],
			["No", 1],
			["Option 3", 2],
			["Option 4", 3],
		])
	})
	it("gives a plain node's outputs the next order and no label", () => {
		const { chart, nodes, edges } = flow({
			nodes: [["a"], ["b"], ["c"]],
			edges: [["a", "b"]],
		})
		const change = addNodeFrom(chart, nodes, edges, "a", "process", { measure })
		expect(change.add.edges[0]).toMatchObject({ label: "", order: 1 })
	})
	it("never reuses an order after a branch was removed", () => {
		const { chart, nodes, edges } = flow({
			nodes: [["d", "decision"], ["x"], ["y"]],
			edges: [
				["d", "x", "Yes", 0],
				["d", "y", "Option 3", 2],
			],
		})
		const change = addNodeFrom(chart, nodes, edges, "d", "process", { measure })
		expect(change.add.edges[0].order).toBe(3)
	})
	it("lets a terminator have one output only", () => {
		const { chart, nodes, edges } = flow({
			nodes: [
				["t", "terminator"],
				["a", "process"],
			],
			edges: [],
		})
		const first = addNodeFrom(chart, nodes, edges, "t", "process", { measure })
		expect(first).not.toBeNull()
		const joined = applyFlowChange(nodes, edges, first)
		expect(
			addNodeFrom(chart, joined.nodes, joined.edges, "t", "process", { measure }),
		).toBeNull()
		expect(
			addNodeAt(
				chart,
				joined.nodes,
				joined.edges,
				"t",
				"process",
				{ x: 5, y: 5 },
				{ measure },
			),
		).toBeNull()
	})
	it("refuses an unknown source or type", () => {
		const { chart, nodes, edges } = flow({ nodes: [["a"]] })
		expect(addNodeFrom(chart, nodes, edges, "zz", "process", { measure })).toBeNull()
		expect(addNodeFrom(chart, nodes, edges, "a", "oval", { measure })).toBeNull()
	})
	it("passes the branch through to the layout", () => {
		const { chart, nodes, edges } = flow({ nodes: [["d", "decision", 0, 0]] })
		const change = addNodeFrom(chart, nodes, edges, "d", "process", { measure, branch: 1 })
		const at = placeChild(chart, nodes, edges, "d", "process", measure, { branch: 1 })
		expect([change.add.nodes[0].x, change.add.nodes[0].y]).toEqual([at.x, at.y])
	})
})

describe("addNodeAt", () => {
	it("places a manual node where it was dropped", () => {
		const { chart, nodes, edges } = flow({ nodes: [["a", "process", 0, 0]] })
		const change = addNodeAt(
			chart,
			nodes,
			edges,
			"a",
			"decision",
			{ x: 400, y: 400 },
			{ measure },
		)
		const node = change.add.nodes[0]
		expect(node).toMatchObject({ type: "decision", manual: true, text: "Decision?" })
		expect(Math.abs(node.x - 400)).toBeLessThan(60)
		expect(Math.abs(node.y - 400)).toBeLessThan(60)
		expect(change.add.edges[0]).toMatchObject({ from: "a", to: node.id, label: "", order: 0 })
	})
	it("labels a branch of a decision", () => {
		const { chart, nodes, edges } = branching()
		const change = addNodeAt(
			chart,
			nodes,
			edges,
			"decide",
			"process",
			{ x: 900, y: 900 },
			{ measure },
		)
		expect(change.add.edges[0]).toMatchObject({ label: "Option 3", order: 2 })
	})
	it("refuses a missing source and an unknown type", () => {
		const { chart, nodes, edges } = flow({ nodes: [["a"]] })
		expect(
			addNodeAt(chart, nodes, edges, "x", "process", { x: 0, y: 0 }, { measure }),
		).toBeNull()
		expect(addNodeAt(chart, nodes, edges, "a", "blob", { x: 0, y: 0 }, { measure })).toBeNull()
	})
})

describe("decision branches", () => {
	it("adds a process output labelled for its index", () => {
		const { chart, nodes, edges } = branching()
		const before = frozen(nodes, edges)
		const change = addDecisionBranch(chart, nodes, edges, "decide", { measure })
		expect(change.add.nodes[0]).toMatchObject({ type: "process", text: "Step", manual: false })
		expect(change.add.edges[0]).toMatchObject({
			from: "decide",
			to: change.add.nodes[0].id,
			label: "Option 3",
			order: 2,
		})
		expect(frozen(nodes, edges)).toBe(before)
		const next = applyFlowChange(nodes, edges, change)
		const again = addDecisionBranch(chart, next.nodes, next.edges, "decide", { measure })
		expect(again.add.edges[0]).toMatchObject({ label: "Option 4", order: 3 })
	})
	it("starts a fresh decision with Yes", () => {
		const { chart, nodes, edges } = flow({ nodes: [["d", "decision"]] })
		expect(addDecisionBranch(chart, nodes, edges, "d", { measure }).add.edges[0].label).toBe(
			"Yes",
		)
	})
	it("refuses a node that is not a decision, and a missing one", () => {
		const { chart, nodes, edges } = flow({ nodes: [["p", "process"]] })
		expect(addDecisionBranch(chart, nodes, edges, "p", { measure })).toBeNull()
		expect(addDecisionBranch(chart, nodes, edges, "zz", { measure })).toBeNull()
	})
	it("removes an output only while two remain", () => {
		const { chart, nodes, edges } = branching()
		expect(removeBranch(nodes, edges, "decide>yes")).toBeNull()
		const added = applyFlowChange(
			nodes,
			edges,
			addDecisionBranch(chart, nodes, edges, "decide", { measure }),
		)
		const target = outEdges(added.edges, "decide")[2]
		const change = removeBranch(added.nodes, added.edges, target.id)
		expect(change.remove).toEqual({ nodes: [], edges: [target.id] })
		expect(change.add).toEqual({ nodes: [], edges: [] })
		// the branch's node stays; only the edge goes
		expect(applyFlowChange(added.nodes, added.edges, change).nodes).toHaveLength(5)
	})
	it("refuses removeBranch for a non-decision or an unknown edge", () => {
		const { nodes, edges } = flow({
			nodes: [["a"], ["b"], ["c"], ["d"]],
			edges: [
				["a", "b"],
				["a", "c"],
				["a", "d"],
			],
		})
		expect(removeBranch(nodes, edges, "a>b")).toBeNull()
		expect(removeBranch(nodes, edges, "nope")).toBeNull()
	})
})

describe("swapType", () => {
	it("changes the type and the default text, keeping every edge", () => {
		const { nodes, edges } = flow({
			nodes: [["a"], ["b"], ["c"]],
			edges: [
				["a", "b"],
				["b", "c"],
			],
		})
		const change = swapType(nodes, edges, "b", "io")
		expect(change.update.nodes).toEqual([{ id: "b", patch: { type: "io", text: "Input" } }])
		expect(change.update.edges).toEqual([])
		expect(change.add).toEqual({ nodes: [], edges: [] })
		expect(change.remove).toEqual({ nodes: [], edges: [] })
	})
	it("keeps a custom text", () => {
		const { nodes, edges } = flow({ nodes: [["a", "process", 0, 0, "Check stock"]] })
		expect(swapType(nodes, edges, "a", "io").update.nodes[0].patch).toEqual({ type: "io" })
	})
	it("takes a junction's empty text for its default", () => {
		const { nodes, edges } = flow({ nodes: [["j", "junction"]] })
		expect(swapType(nodes, edges, "j", "process").update.nodes[0].patch).toEqual({
			type: "process",
			text: "Step",
		})
		const flowed = flow({ nodes: [["p", "process", 0, 0, "Step"]] })
		expect(swapType(flowed.nodes, flowed.edges, "p", "junction").update.nodes[0].patch).toEqual(
			{
				type: "junction",
				text: "",
			},
		)
	})
	it("labels the unlabelled outputs when becoming a decision, in order", () => {
		const { nodes, edges } = flow({
			nodes: [["a"], ["x"], ["y"], ["z"]],
			edges: [
				["a", "z", "", 2],
				["a", "x", "", 0],
				["a", "y", "Keep", 1],
			],
		})
		const change = swapType(nodes, edges, "a", "decision")
		expect(change.update.nodes[0].patch).toEqual({ type: "decision", text: "Decision?" })
		expect(change.update.edges).toEqual([
			{ id: "a>x", patch: { label: "Yes" } },
			{ id: "a>z", patch: { label: "Option 3" } },
		])
	})
	it("keeps labels when a decision becomes something else", () => {
		const { nodes, edges } = branching()
		const change = swapType(nodes, edges, "decide", "process")
		expect(change.update.edges).toEqual([])
		expect(change.update.nodes[0].patch).toEqual({ type: "process", text: "Step" })
	})
	it("is null for the same type, an unknown node or an unknown type", () => {
		const { nodes, edges } = flow({ nodes: [["a", "process"]] })
		expect(swapType(nodes, edges, "a", "process")).toBeNull()
		expect(swapType(nodes, edges, "zz", "io")).toBeNull()
		expect(swapType(nodes, edges, "a", "hexagon")).toBeNull()
	})
	it("does not mutate", () => {
		const { nodes, edges } = branching()
		const before = frozen(nodes, edges)
		swapType(nodes, edges, "start", "decision")
		expect(frozen(nodes, edges)).toBe(before)
	})
})

describe("text and labels", () => {
	it("sets and cuts node text, and does nothing for the same text", () => {
		const { nodes } = flow({ nodes: [["a", "process", 0, 0, "Old"]] })
		expect(setNodeText(nodes, "a", "New").update.nodes).toEqual([
			{ id: "a", patch: { text: "New" } },
		])
		expect(setNodeText(nodes, "a", "x".repeat(900)).update.nodes[0].patch.text).toHaveLength(
			FLOW_TEXT_LIMIT,
		)
		expect(setNodeText(nodes, "a", "Old")).toBeNull()
		expect(setNodeText(nodes, "zz", "New")).toBeNull()
		expect(setNodeText(nodes, "a", undefined).update.nodes[0].patch.text).toBe("")
	})
	it("sets and cuts an edge label", () => {
		const { edges } = branching()
		expect(setEdgeLabel(edges, "decide>yes", "Approved").update.edges).toEqual([
			{ id: "decide>yes", patch: { label: "Approved" } },
		])
		expect(
			setEdgeLabel(edges, "decide>yes", "l".repeat(300)).update.edges[0].patch.label,
		).toHaveLength(FLOW_LABEL_LIMIT)
		expect(setEdgeLabel(edges, "decide>yes", "Yes")).toBeNull()
		expect(setEdgeLabel(edges, "nope", "x")).toBeNull()
	})
})

describe("insertOnEdge", () => {
	// a (process, 64 high) at y 0 and b at y; a's far border is 32 and b's near border y - 32.
	const chartAt = (y, direction = "TB") =>
		flow({
			direction,
			nodes: [
				["a", "process", 0, direction === "TB" ? 0 : 0],
				["b", "process", direction === "TB" ? 0 : y, direction === "TB" ? y : 0],
				[
					"c",
					"process",
					direction === "TB" ? 0 : y + 200,
					direction === "TB" ? y + 200 : 0,
				],
			],
			edges: [
				["a", "b", "Label", 4],
				["b", "c"],
			],
		})

	it("centres the new node midway when there is room", () => {
		const { chart, nodes, edges } = chartAt(400)
		const before = frozen(nodes, edges)
		const change = insertOnEdge(chart, nodes, edges, "a>b", "process", { measure })
		const node = change.add.nodes[0]
		expect(node).toMatchObject({ type: "process", x: 0, y: 200, manual: false })
		expect(change.update.nodes).toEqual([])
		expect(change.update.edges).toEqual([{ id: "a>b", patch: { to: node.id } }])
		expect(change.add.edges).toEqual([
			{ id: expect.any(String), chartId: "c", from: node.id, to: "b", label: "", order: 0 },
		])
		expect(frozen(nodes, edges)).toBe(before)
		const after = applyFlowChange(nodes, edges, change)
		expect(edgeById(after.edges, "a>b")).toMatchObject({
			from: "a",
			to: node.id,
			label: "Label",
			order: 4,
		})
	})
	it("moves everything downstream by exactly the shortfall when there is no room", () => {
		const { chart, nodes, edges } = chartAt(150)
		// gap = (150 - 32) - 32 = 86; need = 64 + 140 = 204; shortfall 118
		const change = insertOnEdge(chart, nodes, edges, "a>b", "process", { measure })
		const moved = Object.fromEntries(change.update.nodes.map((u) => [u.id, u.patch]))
		expect(Object.keys(moved).sort()).toEqual(["b", "c"])
		expect(moved.b.y).toBe(150 + 118)
		expect(moved.c.y).toBe(350 + 118)
		expect(moved.b.x).toBe(0)
		const node = change.add.nodes[0]
		expect(node.y).toBe(32 + 102)
		expect(node.x).toBe(0)
		// the gaps on both sides of the new node are exactly GAPS.along
		expect(node.y - 32 - 32).toBe(GAPS.along)
		expect(moved.b.y - 32 - (node.y + 32)).toBe(GAPS.along)
	})
	it("uses the size of the inserted type and the column of the source", () => {
		const base = chartAt(150)
		const nodes = base.nodes.map((n) => (n.id === "a" ? { ...n, x: 55 } : n))
		const change = insertOnEdge(base.chart, nodes, base.edges, "a>b", "decision", { measure })
		const node = change.add.nodes[0]
		expect(node.x).toBe(55)
		const need = sizeOf(node).h + 2 * GAPS.along
		const shortfall = need - 86
		expect(change.update.nodes.find((u) => u.id === "b").patch.y).toBe(150 + shortfall)
		expect(node.y).toBe(32 + need / 2)
	})
	it("works left to right along x", () => {
		const { chart, nodes, edges } = chartAt(100, "LR")
		// widths 170: a's far border is 85, b's near border is 100 - 85 = 15 -> no gap at all
		const change = insertOnEdge(chart, nodes, edges, "a>b", "process", { measure })
		const need = 170 + 2 * GAPS.along
		const gap = 100 - 85 - 85
		const moved = Object.fromEntries(change.update.nodes.map((u) => [u.id, u.patch]))
		expect(moved.b.x).toBe(100 + (need - gap))
		expect(moved.c.x).toBe(300 + (need - gap))
		expect(moved.b.y).toBe(0)
		const node = change.add.nodes[0]
		expect(node.y).toBe(0)
		expect(node.x).toBe(85 + need / 2)
	})
	it("round trips through applyFlowChange to a connected chain", () => {
		const { chart, nodes, edges } = chartAt(150)
		const change = insertOnEdge(chart, nodes, edges, "a>b", "io", { measure })
		const after = applyFlowChange(nodes, edges, change)
		const middle = change.add.nodes[0]
		expect(successors(after.edges, "a")).toEqual([middle.id])
		expect(successors(after.edges, middle.id)).toEqual(["b"])
		expect(successors(after.edges, "b")).toEqual(["c"])
		expect(after.nodes).toHaveLength(4)
		expect(after.edges).toHaveLength(3)
	})
	it("keeps the labels of a decision's output", () => {
		const { chart, nodes, edges } = branching()
		const change = insertOnEdge(chart, nodes, edges, "decide>no", "process", { measure })
		const after = applyFlowChange(nodes, edges, change)
		expect(edgeById(after.edges, "decide>no")).toMatchObject({ label: "No", order: 1 })
		expect(outEdges(after.edges, "decide").map((e) => e.label)).toEqual(["Yes", "No"])
		expect(after.edges.find((e) => e.to === "no" && e.id !== "decide>no").label).toBe("")
	})
	it("inserting on a loop-back edge never drags the start of the loop", () => {
		const { chart, nodes, edges } = flow({
			nodes: [
				["a", "process", 0, 0],
				["b", "process", 0, 200],
				["d", "decision", 0, 400],
			],
			edges: [
				["a", "b"],
				["b", "d"],
				["d", "a", "No", 1],
			],
		})
		const change = insertOnEdge(chart, nodes, edges, "d>a", "process", { measure })
		expect(change.update.nodes.map((u) => u.id)).not.toContain("a")
		const after = applyFlowChange(nodes, edges, change)
		expect(successors(after.edges, "d")).toEqual([change.add.nodes[0].id])
		expect(successors(after.edges, change.add.nodes[0].id)).toEqual(["a"])
	})
	it("refuses an unknown edge or type", () => {
		const { chart, nodes, edges } = chartAt(400)
		expect(insertOnEdge(chart, nodes, edges, "zz", "process", { measure })).toBeNull()
		expect(insertOnEdge(chart, nodes, edges, "a>b", "triangle", { measure })).toBeNull()
	})
})

describe("spliceNodeOnEdge", () => {
	const scene = () =>
		flow({
			nodes: [
				["a", "process", 0, 0],
				["b", "process", 0, 150],
				["c", "process", 0, 350],
				["loose", "io", 300, 90, "Input", true],
			],
			edges: [
				["a", "b", "Yes", 3],
				["b", "c"],
			],
		})
	it("splices a free node in and re-flows downstream", () => {
		const { chart, nodes, edges } = scene()
		const before = frozen(nodes, edges)
		const change = spliceNodeOnEdge(chart, nodes, edges, "loose", "a>b", { measure })
		expect(change.add.nodes).toEqual([])
		const patches = Object.fromEntries(change.update.nodes.map((u) => [u.id, u.patch]))
		const need = sizeOf(nodes[3]).h + 2 * GAPS.along
		expect(patches.b.y).toBe(150 + (need - 86))
		expect(patches.loose).toEqual({ x: 0, y: 32 + need / 2, manual: false })
		expect(change.update.edges).toEqual([{ id: "a>b", patch: { to: "loose" } }])
		expect(change.add.edges[0]).toMatchObject({ from: "loose", to: "b", label: "", order: 0 })
		const after = applyFlowChange(nodes, edges, change)
		expect(edgeById(after.edges, "a>b")).toMatchObject({ to: "loose", label: "Yes", order: 3 })
		expect(frozen(nodes, edges)).toBe(before)
	})
	it("centres it midway when there is room", () => {
		const { chart, nodes, edges } = scene()
		const spacious = nodes.map((n) => (n.id === "b" ? { ...n, y: 500 } : n))
		const change = spliceNodeOnEdge(chart, spacious, edges, "loose", "a>b", { measure })
		expect(change.update.nodes).toEqual([
			{ id: "loose", patch: { x: 0, y: 250, manual: false } },
		])
	})
	it("refuses a node with edges, an endpoint, or an unknown id", () => {
		const { chart, nodes, edges } = scene()
		expect(spliceNodeOnEdge(chart, nodes, edges, "c", "a>b", { measure })).toBeNull()
		expect(spliceNodeOnEdge(chart, nodes, edges, "a", "a>b", { measure })).toBeNull()
		expect(spliceNodeOnEdge(chart, nodes, edges, "b", "a>b", { measure })).toBeNull()
		expect(spliceNodeOnEdge(chart, nodes, edges, "ghost", "a>b", { measure })).toBeNull()
		expect(spliceNodeOnEdge(chart, nodes, edges, "loose", "nope", { measure })).toBeNull()
	})
})

describe("removeNode", () => {
	const chain = () =>
		flow({
			nodes: [["a"], ["x"], ["b"]],
			edges: [
				["a", "x", "", 0],
				["x", "b", "Then", 2],
			],
		})
	it("bridges the neighbours, keeping the outgoing label and order", () => {
		const { nodes, edges } = chain()
		const before = frozen(nodes, edges)
		const change = removeNode(nodes, edges, "x")
		expect(change.remove).toEqual({ nodes: ["x"], edges: ["a>x", "x>b"] })
		expect(change.add.edges).toEqual([
			{ id: expect.any(String), chartId: "c", from: "a", to: "b", label: "Then", order: 2 },
		])
		const after = applyFlowChange(nodes, edges, change)
		expect(after.nodes.map((n) => n.id)).toEqual(["a", "b"])
		expect(frozen(nodes, edges)).toBe(before)
	})
	it("does not reconnect when asked not to", () => {
		const { nodes, edges } = chain()
		const change = removeNode(nodes, edges, "x", { reconnect: false })
		expect(change.add.edges).toEqual([])
		expect(change.remove.edges).toEqual(["a>x", "x>b"])
	})
	it("keeps a decision's branch label and place when its target is removed", () => {
		const { nodes, edges } = branching()
		const withTail = flow({
			nodes: [...nodes.map((n) => [n.id, n.type, n.x, n.y]), ["end", "terminator", 150, 500]],
			edges: [...edges.map((e) => [e.from, e.to, e.label, e.order]), ["no", "end"]],
		})
		const change = removeNode(withTail.nodes, withTail.edges, "no")
		expect(change.add.edges[0]).toMatchObject({
			from: "decide",
			to: "end",
			label: "No",
			order: 1,
		})
	})
	it("does not reconnect with other than one way in and one way out", () => {
		const { nodes, edges } = branching()
		expect(removeNode(nodes, edges, "decide").add.edges).toEqual([])
		expect(removeNode(nodes, edges, "start").add.edges).toEqual([])
		expect(removeNode(nodes, edges, "yes").add.edges).toEqual([])
		expect(removeNode(nodes, edges, "yes").remove).toEqual({
			nodes: ["yes"],
			edges: ["decide>yes"],
		})
	})
	it("does not join a node to itself or repeat an existing edge", () => {
		const loop = flow({
			nodes: [["a"], ["x"]],
			edges: [
				["a", "x"],
				["x", "a"],
			],
		})
		expect(removeNode(loop.nodes, loop.edges, "x").add.edges).toEqual([])
		const dup = flow({
			nodes: [["a"], ["x"], ["b"]],
			edges: [
				["a", "x"],
				["x", "b"],
				["a", "b"],
			],
		})
		expect(removeNode(dup.nodes, dup.edges, "x").add.edges).toEqual([])
	})
	it("is null for an unknown node", () => {
		const { nodes, edges } = chain()
		expect(removeNode(nodes, edges, "ghost")).toBeNull()
	})
})

describe("removeEdge", () => {
	it("removes just the edge", () => {
		const { edges } = branching()
		expect(removeEdge(edges, "start>decide").remove).toEqual({
			nodes: [],
			edges: ["start>decide"],
		})
		expect(removeEdge(edges, "nope")).toBeNull()
	})
})

describe("connect", () => {
	const scene = () =>
		flow({
			nodes: [["a"], ["b"], ["c"], ["t", "terminator"], ["d", "decision"]],
			edges: [["a", "b"]],
		})
	it("adds an edge with the next order", () => {
		const { chart, nodes, edges } = scene()
		const change = connect(chart, nodes, edges, "a", "c")
		expect(change.add.edges).toEqual([
			{ id: expect.any(String), chartId: "c", from: "a", to: "c", label: "", order: 1 },
		])
		expect(change.add.nodes).toEqual([])
	})
	it("gives a decision's new edge a branch label unless one is given", () => {
		const { chart, nodes, edges } = scene()
		expect(connect(chart, nodes, edges, "d", "a").add.edges[0]).toMatchObject({
			label: "Yes",
			order: 0,
		})
		expect(connect(chart, nodes, edges, "d", "a", { label: "Maybe" }).add.edges[0].label).toBe(
			"Maybe",
		)
		expect(connect(chart, nodes, edges, "d", "a", { label: "" }).add.edges[0].label).toBe("")
		expect(
			connect(chart, nodes, edges, "a", "c", { label: "z".repeat(100) }).add.edges[0].label,
		).toHaveLength(FLOW_LABEL_LIMIT)
	})
	it("refuses a missing node, a self loop and a duplicate", () => {
		const { chart, nodes, edges } = scene()
		expect(connect(chart, nodes, edges, "a", "ghost")).toBeNull()
		expect(connect(chart, nodes, edges, "ghost", "a")).toBeNull()
		expect(connect(chart, nodes, edges, "a", "a")).toBeNull()
		expect(connect(chart, nodes, edges, "a", "b")).toBeNull()
	})
	it("allows the reverse edge, a loop back and an edge into a terminator", () => {
		const { chart, nodes, edges } = scene()
		expect(connect(chart, nodes, edges, "b", "a")).not.toBeNull()
		expect(connect(chart, nodes, edges, "a", "t")).not.toBeNull()
	})
	it("lets a terminator have one output only", () => {
		const { chart, nodes, edges } = scene()
		const first = connect(chart, nodes, edges, "t", "a")
		expect(first).not.toBeNull()
		const next = applyFlowChange(nodes, edges, first)
		expect(connect(chart, next.nodes, next.edges, "t", "c")).toBeNull()
	})
})

describe("reorderBranches", () => {
	const scene = () =>
		flow({
			nodes: [["d", "decision"], ["x"], ["y"], ["z"]],
			edges: [
				["d", "x", "Yes", 0],
				["d", "y", "No", 1],
				["d", "z", "Option 3", 2],
			],
		})
	it("swaps the order values of neighbours", () => {
		const { edges } = scene()
		const change = reorderBranches(edges, "d", "d>x", 1)
		expect(change.update.edges).toEqual(
			expect.arrayContaining([
				{ id: "d>x", patch: { order: 1 } },
				{ id: "d>y", patch: { order: 0 } },
			]),
		)
		expect(change.update.edges).toHaveLength(2)
		const after = applyFlowChange([], edges, change)
		expect(outEdges(after.edges, "d").map((e) => e.id)).toEqual(["d>y", "d>x", "d>z"])
		// labels stay with their edges
		expect(edgeById(after.edges, "d>x").label).toBe("Yes")
	})
	it("moves up too and works with gaps in the orders", () => {
		const { edges } = scene()
		const gappy = edges.map((e) => (e.id === "d>z" ? { ...e, order: 7 } : e))
		const change = reorderBranches(gappy, "d", "d>z", -1)
		const after = applyFlowChange([], gappy, change)
		expect(outEdges(after.edges, "d").map((e) => e.id)).toEqual(["d>x", "d>z", "d>y"])
		expect(outEdges(after.edges, "d").map((e) => e.order)).toEqual([0, 1, 7])
	})
	it("is null at the ends and for unknown or foreign edges", () => {
		const { edges } = scene()
		expect(reorderBranches(edges, "d", "d>x", -1)).toBeNull()
		expect(reorderBranches(edges, "d", "d>z", 1)).toBeNull()
		expect(reorderBranches(edges, "d", "ghost", 1)).toBeNull()
		expect(reorderBranches(edges, "x", "d>x", 1)).toBeNull()
		expect(reorderBranches(edges, "d", "d>x", 0)).toBeNull()
	})
	it("renumbers when orders collide", () => {
		const { edges } = flow({
			nodes: [["d"], ["x"], ["y"]],
			edges: [
				["d", "x", "", 0],
				["d", "y", "", 0],
			],
		})
		const after = applyFlowChange([], edges, reorderBranches(edges, "d", "d>x", 1))
		expect(outEdges(after.edges, "d").map((e) => e.id)).toEqual(["d>y", "d>x"])
	})
})

describe("positions", () => {
	const scene = () =>
		flow({
			nodes: [
				["a", "process", 10, 20],
				["b", "process", 30, 40, "Step", true],
				["c", "process", 50, 60],
			],
		})
	it("moveNodes shifts the nodes and marks them manual", () => {
		const { nodes } = scene()
		const before = frozen(nodes)
		const change = moveNodes(nodes, ["a", "b", "ghost"], 5, -5)
		expect(change.update.nodes).toEqual([
			{ id: "a", patch: { x: 15, y: 15, manual: true } },
			{ id: "b", patch: { x: 35, y: 35, manual: true } },
		])
		expect(frozen(nodes)).toBe(before)
	})
	it("moveNodes by nothing only marks the nodes that were not manual", () => {
		const { nodes } = scene()
		expect(updatedIds(moveNodes(nodes, ["a", "b"], 0, 0))).toEqual(["a"])
		expect(moveNodes(nodes, ["b"], 0, 0)).toBeNull()
		expect(moveNodes(nodes, [], 4, 4)).toBeNull()
		expect(moveNodes(nodes, ["ghost"], 4, 4)).toBeNull()
	})
	it("setNodePosition sets the position and manual", () => {
		const { nodes } = scene()
		expect(setNodePosition(nodes, "a", 1, 2).update.nodes).toEqual([
			{ id: "a", patch: { x: 1, y: 2, manual: true } },
		])
		expect(setNodePosition(nodes, "b", 30, 40)).toBeNull()
		expect(setNodePosition(nodes, "ghost", 1, 2)).toBeNull()
		expect(setNodePosition(nodes, "a", NaN, 2)).toBeNull()
	})
})

describe("tidyChange", () => {
	const messy = (direction = "TB") =>
		flow({
			direction,
			nodes: [
				["start", "terminator", 400, 900, "Start", true],
				["decide", "decision", -300, 20, "Decision?", true],
				["yes", "process", 70, 10],
				["no", "process", 9, 800, "Step", true],
				["end", "terminator", 5, 5],
			],
			edges: [
				["start", "decide"],
				["decide", "yes", "Yes", 0],
				["decide", "no", "No", 1],
				["yes", "end"],
				["no", "end"],
			],
		})
	it("is one change updating positions and clearing manual", () => {
		const { chart, nodes, edges } = messy()
		const before = frozen(chart, nodes, edges)
		const change = tidyChange(chart, nodes, edges, measure)
		const positions = tidyLayout(chart, nodes, edges, measure)
		expect(change.add).toEqual({ nodes: [], edges: [] })
		expect(change.remove).toEqual({ nodes: [], edges: [] })
		expect(change.update.edges).toEqual([])
		const after = applyFlowChange(nodes, edges, change)
		for (const n of after.nodes) {
			expect(n.manual).toBe(false)
			expect([n.x, n.y]).toEqual([positions.get(n.id).x, positions.get(n.id).y])
		}
		// every node whose manual flag was set is listed even if it would not move
		for (const n of nodes.filter((n) => n.manual)) expect(updatedIds(change)).toContain(n.id)
		expect(frozen(chart, nodes, edges)).toBe(before)
	})
	it("only lists nodes that differ", () => {
		const { chart, nodes, edges } = messy()
		const tidy = applyFlowChange(nodes, edges, tidyChange(chart, nodes, edges, measure))
		const moved = tidy.nodes.map((n) => (n.id === "yes" ? { ...n, x: n.x + 40 } : n))
		const change = tidyChange(chart, moved, tidy.edges, measure)
		expect(updatedIds(change)).toEqual(["yes"])
	})
	it("is null when nothing changes (idempotent)", () => {
		const { chart, nodes, edges } = messy()
		const tidy = applyFlowChange(nodes, edges, tidyChange(chart, nodes, edges, measure))
		expect(tidyChange(chart, tidy.nodes, tidy.edges, measure)).toBeNull()
	})
	it("a chart with no nodes has nothing to tidy", () => {
		const { chart } = flow({})
		expect(tidyChange(chart, [], [], measure)).toBeNull()
	})
})

describe("setDirection and setNumbered", () => {
	it("patches the chart and re-flows with the new direction", () => {
		const { chart, nodes, edges } = flow({
			nodes: [
				["a", "terminator", 0, 0],
				["b", "process", 0, 200],
				["c", "process", 0, 400],
			],
			edges: [
				["a", "b"],
				["b", "c"],
			],
		})
		const before = frozen(chart, nodes, edges)
		const change = setDirection(chart, nodes, edges, "LR", measure)
		expect(change.chart).toEqual({ direction: "LR" })
		const positions = tidyLayout({ ...chart, direction: "LR" }, nodes, edges, measure)
		const after = applyFlowChange(nodes, edges, change)
		for (const n of after.nodes)
			expect([n.x, n.y]).toEqual([positions.get(n.id).x, positions.get(n.id).y])
		expect(after.nodes[0].x).toBeLessThan(after.nodes[1].x)
		expect(after.nodes[1].x).toBeLessThan(after.nodes[2].x)
		expect(applyChartPatch(chart, change).direction).toBe("LR")
		expect(frozen(chart, nodes, edges)).toBe(before)
	})
	it("clears manual flags on the way", () => {
		const { chart, nodes, edges } = flow({
			nodes: [
				["a", "process", 0, 0, "Step", true],
				["b", "process", 0, 200],
			],
			edges: [["a", "b"]],
		})
		const after = applyFlowChange(
			nodes,
			edges,
			setDirection(chart, nodes, edges, "LR", measure),
		)
		expect(after.nodes.every((n) => !n.manual)).toBe(true)
	})
	it("is null for the same or an unknown direction", () => {
		const { chart, nodes, edges } = flow({ nodes: [["a"]] })
		expect(setDirection(chart, nodes, edges, "TB", measure)).toBeNull()
		expect(setDirection(chart, nodes, edges, "RL", measure)).toBeNull()
	})
	it("toggles back and forth", () => {
		const { chart, nodes, edges } = flow({
			nodes: [["a"], ["b"]],
			edges: [["a", "b"]],
		})
		const lr = applyFlowChange(nodes, edges, setDirection(chart, nodes, edges, "LR", measure))
		const back = applyFlowChange(
			lr.nodes,
			lr.edges,
			setDirection({ ...chart, direction: "LR" }, lr.nodes, lr.edges, "TB", measure),
		)
		expect(back.nodes[0].y).toBeLessThan(back.nodes[1].y)
	})
	it("setNumbered reports a chart patch only when it changes", () => {
		const { chart } = flow({})
		const change = setNumbered(chart, true)
		expect(change.chart).toEqual({ numbered: true })
		expect(isEmptyChange(change)).toBe(false)
		expect(setNumbered(chart, false)).toBeNull()
		expect(setNumbered({ ...chart, numbered: true }, 0).chart).toEqual({ numbered: false })
	})
})

describe("newChartChange", () => {
	const top = (n) => n.y - sizeOf(n).h / 2
	const bounds = { x: -100, y: -50, w: 700, h: 400 }
	it("makes Start and Step joined by an edge, Start centred on the origin", () => {
		const { chart, change } = newChartChange({ origin: { x: 120, y: 80 }, measure })
		expect(chart).toMatchObject({ direction: "TB", numbered: false })
		const [start, step] = change.add.nodes
		expect(start).toMatchObject({
			type: "terminator",
			text: "Start",
			x: 120,
			y: 80,
			chartId: chart.id,
		})
		expect(step).toMatchObject({ type: "process", text: "Step", x: 120, chartId: chart.id })
		expect(step.y).toBe(80 + 28 + GAPS.along + 32)
		expect(change.add.edges).toEqual([
			{
				id: expect.any(String),
				chartId: chart.id,
				from: start.id,
				to: step.id,
				label: "",
				order: 0,
			},
		])
		expect(change.update).toEqual({ nodes: [], edges: [] })
		expect(start.manual).toBe(false)
	})
	it("flows along x for left to right", () => {
		const { chart, change } = newChartChange({
			origin: { x: 0, y: 0 },
			direction: "LR",
			measure,
		})
		const [start, step] = change.add.nodes
		expect(chart.direction).toBe("LR")
		expect(step.y).toBe(0)
		expect(step.x).toBe(80 + GAPS.along + 85)
		expect(start.x).toBe(0)
	})
	it("puts a chart below the existing content without overlap", () => {
		for (const direction of ["TB", "LR"]) {
			const { change } = newChartChange({ bounds, direction, measure })
			const tops = change.add.nodes.map(top)
			expect(Math.min(...tops)).toBeGreaterThan(bounds.y + bounds.h)
		}
	})
	it("places a chart without bounds or origin", () => {
		const { change } = newChartChange({ measure })
		expect(change.add.nodes).toHaveLength(2)
		for (const n of change.add.nodes) expect(Number.isFinite(n.x + n.y)).toBe(true)
	})
	it("two charts in a row do not overlap", () => {
		const first = newChartChange({ bounds, measure })
		const nodes = first.change.add.nodes
		const lows = Math.max(...nodes.map((n) => n.y + sizeOf(n).h / 2))
		const edge = { x: -100, y: -50, w: 700, h: lows + 50 }
		const second = newChartChange({ bounds: edge, measure })
		expect(Math.min(...second.change.add.nodes.map(top))).toBeGreaterThan(lows)
	})
	it("gives every chart and record its own id", () => {
		const a = newChartChange({ origin: { x: 0, y: 0 }, measure })
		const b = newChartChange({ origin: { x: 0, y: 0 }, measure })
		expect(a.chart.id).not.toBe(b.chart.id)
		const ids = [...a.change.add.nodes, ...b.change.add.nodes, ...a.change.add.edges].map(
			(r) => r.id,
		)
		expect(new Set(ids).size).toBe(ids.length)
	})
})

describe("deleteChartChange", () => {
	it("removes every node and edge", () => {
		const { chart, nodes, edges } = branching()
		const change = deleteChartChange(chart, nodes, edges)
		expect(change.remove.nodes).toEqual(["start", "decide", "yes", "no"])
		expect(change.remove.edges).toHaveLength(3)
		expect(applyFlowChange(nodes, edges, change)).toEqual({ nodes: [], edges: [] })
	})
})

describe("round trips and immutability", () => {
	it("builds a chart step by step with applyFlowChange", () => {
		const created = newChartChange({ origin: { x: 0, y: 0 }, measure })
		let { chart } = created
		let { nodes, edges } = applyFlowChange([], [], created.change)
		const step = nodes[1]
		const decision = addNodeFrom(chart, nodes, edges, step.id, "decision", { measure })
		;({ nodes, edges } = applyFlowChange(nodes, edges, decision))
		const d = decision.add.nodes[0]
		for (let i = 0; i < 3; i++) {
			const branch = addDecisionBranch(chart, nodes, edges, d.id, { measure })
			;({ nodes, edges } = applyFlowChange(nodes, edges, branch))
		}
		expect(outEdges(edges, d.id).map((e) => e.label)).toEqual(["Yes", "No", "Option 3"])
		const turned = setDirection(chart, nodes, edges, "LR", measure)
		chart = applyChartPatch(chart, turned)
		;({ nodes, edges } = applyFlowChange(nodes, edges, turned))
		expect(chart.direction).toBe("LR")
		expect(tidyChange(chart, nodes, edges, measure)).toBeNull()
		expect(nodes).toHaveLength(6)
		expect(edges).toHaveLength(5)
		expect(new Set(edges.flatMap((e) => [e.from, e.to])).size).toBe(6)
	})
	it("lists in a change only what really changes", () => {
		const { chart, nodes, edges } = branching()
		for (const change of [
			addNodeFrom(chart, nodes, edges, "yes", "process", { measure }),
			swapType(nodes, edges, "yes", "io"),
			setNodeText(nodes, "yes", "Hello"),
			removeEdge(edges, "decide>no"),
			connect(chart, nodes, edges, "yes", "no"),
		]) {
			const parts = [
				change.add.nodes,
				change.add.edges,
				change.update.nodes,
				change.update.edges,
				change.remove.nodes,
				change.remove.edges,
			].filter((list) => list.length)
			expect(parts).toHaveLength(change.add.edges.length && change.add.nodes.length ? 2 : 1)
		}
	})
})
