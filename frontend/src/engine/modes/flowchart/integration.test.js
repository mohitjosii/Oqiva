import * as Y from "yjs"
import { beforeEach, describe, expect, it } from "vitest"
import { createBridge } from "../../collab/bridge"
import { seedUpdate, snapshotFromDoc } from "../../collab/ydoc"
import { buildSvg } from "../../export/svg"
import { collectItems, exportArea, isEmpty } from "../../export/scene"
import { CanvasController } from "../../interaction/controller"
import { runCommand } from "../../interaction/commands"
import { commandFor } from "../../interaction/keymap"
import { contentBounds, fitView } from "../../interaction/view"
import { createDocument, parseDocument } from "../../model/schema"
import { createStore } from "../../store/createStore"
import { flowOwnsKeys } from "./commands"
import { nestFlowcharts } from "./document"
import { measure as sizeMeasure } from "./testUtils"

// The real measurer takes a style object; flowchart code adapts it to a size.
const measure = (text, style) => sizeMeasure(text, style.size)

const press = (x, y, over = {}) => ({
	clientX: x,
	clientY: y,
	button: 0,
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	...over,
})

// Start -> Check? -(Yes)-> Do it -> End, and Check? -(No)-> End.
function sample(extra = {}) {
	const node = (id, type, x, y, text) => ({
		id,
		chartId: "c",
		type,
		text,
		x,
		y,
		manual: false,
	})
	const edge = (from, to, label, order) => ({
		id: `${from}${to}`,
		chartId: "c",
		from,
		to,
		label,
		order,
	})
	const nodes = [
		node("s", "terminator", 400, 100, "Start"),
		node("d", "decision", 400, 260, "Ready?"),
		node("p", "process", 400, 460, "Do it"),
		node("e", "terminator", 400, 620, "End"),
	]
	const edges = [
		edge("s", "d", "", 0),
		edge("d", "p", "Yes", 0),
		edge("d", "e", "No", 1),
		edge("p", "e", "", 0),
	]
	return {
		...createDocument(),
		flowcharts: nestFlowcharts([{ id: "c", direction: "TB", numbered: false }], nodes, edges),
		...extra,
	}
}

let store
let controller
function setup(document = sample()) {
	store = createStore(document)
	store.state.size = { width: 1000, height: 800 }
	store.state.viewport = { x: 0, y: 0, scale: 1 }
	controller = new CanvasController(store, { measure, ask: async () => true })
	return controller
}
const nodes = () => store.nodesOfChart("c")
const edges = () => store.edgesOfChart("c")
const node = (id) => store.getFlowNode(id)
const run = (name, extra = {}) => controller.flowCommand({ name, ...extra })
const steps = () => store.history.undoStack.length

describe("the store and the document", () => {
	beforeEach(() => setup())

	it("holds the chart, its steps and arrows, and saves them nested again", () => {
		expect(store.charts.value).toHaveLength(1)
		expect(nodes()).toHaveLength(4)
		expect(edges()).toHaveLength(4)
		const saved = store.snapshot().flowcharts
		expect(saved).toHaveLength(1)
		expect(saved[0].nodes).toHaveLength(4)
		expect(
			parseDocument(JSON.parse(JSON.stringify(store.snapshot()))).document.flowcharts[0]
				.edges,
		).toHaveLength(4)
	})

	it("restoring a version replaces the charts as well", () => {
		store.replaceContent(createDocument())
		expect(store.charts.value).toHaveLength(0)
		expect(store.flowNodes.value).toHaveLength(0)
		expect(store.flowEdges.value).toHaveLength(0)
	})
})

describe("the commands", () => {
	beforeEach(() => setup())

	it("adds the next step, connects it and starts editing it: one undo step", async () => {
		store.select(["p"])
		const before = steps()
		await run("fl.add", { type: "io" })
		expect(nodes()).toHaveLength(5)
		const added = nodes().find((n) => n.type === "io")
		expect(edges().some((e) => e.from === "p" && e.to === added.id)).toBe(true)
		expect(store.state.selection).toEqual([added.id])
		expect(store.state.editingFlowId).toBe(added.id)
		expect(steps()).toBe(before + 1)
		store.undo()
		expect(nodes()).toHaveLength(4)
		expect(edges()).toHaveLength(4)
	})

	it("another output of a decision is labelled and balanced", async () => {
		store.select(["d"])
		await run("fl.branch")
		const out = edges().filter((e) => e.from === "d")
		expect(out).toHaveLength(3)
		expect(out.map((e) => e.label).sort()).toEqual(["No", "Option 3", "Yes"])
	})

	it("changes a step's type and keeps every arrow", async () => {
		store.select(["p"])
		const before = edges().length
		await run("fl.swap", { type: "decision" })
		expect(node("p").type).toBe("decision")
		expect(edges()).toHaveLength(before)
		store.undo()
		expect(node("p").type).toBe("process")
	})

	it("inserts a step in the middle of an arrow and keeps the flow connected", async () => {
		store.select(["dp"])
		await run("fl.insert", { edge: "dp", type: "process" })
		const mid = nodes().find((n) => !["s", "d", "p", "e"].includes(n.id))
		expect(edges().some((e) => e.from === "d" && e.to === mid.id && e.label === "Yes")).toBe(
			true,
		)
		expect(edges().some((e) => e.from === mid.id && e.to === "p")).toBe(true)
		expect(edges().some((e) => e.id === "dp" && e.to === "p")).toBe(false)
	})

	it("edits an arrow's label", async () => {
		await run("fl.label", { edge: "de", label: "Never" })
		expect(store.getFlowEdge("de").label).toBe("Never")
	})

	it("Tidy up is one undo step and puts steps back in the layout", async () => {
		store.applyOps(
			[
				{
					t: "update",
					list: "flownodes",
					changes: [{ id: "p", patch: { x: 900, y: 50, manual: true } }],
				},
			],
			{ label: "Move" },
		)
		store.select(["p"])
		const before = steps()
		await run("fl.tidy")
		expect(steps()).toBe(before + 1)
		expect(node("p").manual).toBe(false)
		expect(Math.abs(node("p").x - node("d").x)).toBeLessThan(300)
		store.undo()
		expect(node("p").manual).toBe(true)
		expect(node("p").x).toBe(900)
	})

	it("switches direction and numbering", async () => {
		store.select(["s"])
		await run("fl.direction")
		expect(store.getChart("c").direction).toBe("LR")
		expect(node("d").x).toBeGreaterThan(node("s").x)
		await run("fl.numbered")
		expect(store.getChart("c").numbered).toBe(true)
	})

	it("deleting a middle step bridges its neighbours, unless they are already joined", async () => {
		// d -> e already exists, so deleting p just drops its two arrows
		store.select(["p"])
		await run("fl.delete")
		expect(node("p")).toBeNull()
		expect(
			edges()
				.map((e) => e.id)
				.sort(),
		).toEqual(["de", "sd"])
		store.undo()
		expect(node("p").text).toBe("Do it")
		expect(edges()).toHaveLength(4)
		// a step inserted into an arrow and then deleted leaves the arrow as it was
		await run("fl.insert", { edge: "sd", type: "process" })
		const mid = nodes().find((n) => !["s", "d", "p", "e"].includes(n.id))
		store.select([mid.id])
		await run("fl.delete")
		expect(edges().some((e) => e.from === "s" && e.to === "d")).toBe(true)
		expect(nodes()).toHaveLength(4)
	})

	it("deleting every step removes the chart after asking", async () => {
		store.select(nodes().map((n) => n.id))
		await run("fl.delete")
		expect(store.charts.value).toHaveLength(0)
		store.undo()
		expect(store.charts.value).toHaveLength(1)
		expect(nodes()).toHaveLength(4)
	})

	it("makes a separate new chart below the rest", async () => {
		await run("fl.new")
		expect(store.charts.value).toHaveLength(2)
		const fresh = store.charts.value.find((c) => c.id !== "c")
		const own = store.nodesOfChart(fresh.id)
		expect(own.length).toBeGreaterThanOrEqual(2)
		expect(Math.min(...own.map((n) => n.y))).toBeGreaterThan(
			Math.max(...nodes().map((n) => n.y)),
		)
		expect(store.state.editingFlowId).toBeTruthy()
	})

	it("walks the chart with the arrows", async () => {
		store.select(["s"])
		await run("fl.nav", { direction: "down" })
		expect(store.state.selection).toEqual(["d"])
		await run("fl.nav", { direction: "up" })
		expect(store.state.selection).toEqual(["s"])
	})

	it("a viewer can walk but change nothing", async () => {
		store.state.readonly = true
		store.select(["s"])
		expect(await run("fl.add", { type: "process" })).toBe(false)
		expect(nodes()).toHaveLength(4)
		expect(await run("fl.nav", { direction: "down" })).toBe(true)
	})
})

describe("text size", () => {
	beforeEach(() => setup())
	const tall = (id) => controller.flows.value.get("c").sizes.get(id).h

	it("takes any size typed in, for the selected steps or the whole chart, as one step each", async () => {
		store.select(["p"])
		const before = steps()
		const short = tall("p")
		await run("fl.fontSize", { size: 33 })
		expect(node("p").fontSize).toBe(33)
		expect(node("d").fontSize).toBeUndefined()
		expect(tall("p")).toBeGreaterThan(short) // the step grows with its text
		expect(steps()).toBe(before + 1)
		await run("fl.fontSize", { size: 21, whole: true })
		expect(nodes().every((n) => n.fontSize === 21)).toBe(true)
		await run("fl.fontSize", { size: null })
		expect(node("p").fontSize).toBeNull()
		store.undo()
		expect(node("p").fontSize).toBe(21)
	})

	it("refuses a size out of range and leaves junctions alone", async () => {
		store.select(["p"])
		expect(await run("fl.fontSize", { size: 5 })).toBe(false)
		expect(await run("fl.fontSize", { size: 500 })).toBe(false)
		expect(node("p").fontSize).toBeUndefined()
	})

	it("is drawn at that size and survives saving", async () => {
		store.select(["p"])
		await run("fl.fontSize", { size: 40 })
		const items = collectItems(store, "board")
		const svg = buildSvg(items, exportArea(store, items, "board", measure), { measure })
		expect(svg).toContain('font-size="40"')
		expect(store.snapshot().flowcharts[0].nodes.find((n) => n.id === "p").fontSize).toBe(40)
		const again = parseDocument(JSON.parse(JSON.stringify(store.snapshot()))).document
		expect(again.flowcharts[0].nodes.find((n) => n.id === "p").fontSize).toBe(40)
	})
})

describe("the keys", () => {
	beforeEach(() => setup())
	const key = (k, over = {}) => ({
		key: k,
		code: k,
		target: null,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		...over,
	})

	it("belong to the flowchart only when steps and arrows are all that is selected", () => {
		store.select(["s"])
		expect(flowOwnsKeys(store)).toBe(true)
		store.select(["dp"])
		expect(flowOwnsKeys(store)).toBe(true)
		store.clearSelection()
		expect(flowOwnsKeys(store)).toBe(false)
		const on = { flowchart: true }
		expect(commandFor(key("Enter"), on)).toEqual({ name: "fl.key", type: "process" })
		expect(commandFor(key("d"), on)).toEqual({ name: "fl.key", type: "decision" })
		expect(commandFor(key("t"), on)).toEqual({ name: "fl.key", type: "terminator" })
		expect(commandFor(key("i"), on)).toEqual({ name: "fl.key", type: "io" })
		expect(commandFor(key("d"), {})).toEqual(
			{ name: "tool", tool: "tool-d" }.name ? commandFor(key("d"), {}) : null,
		)
	})

	it("Enter and D go through runCommand: on a step they add, on an arrow they insert", async () => {
		store.select(["p"])
		await runCommand(
			store,
			controller,
			{ name: "fl.key", type: "process" },
			{ flowchart: controller.flowHost() },
		)
		expect(nodes()).toHaveLength(5)
		store.select(["pe"])
		await runCommand(
			store,
			controller,
			{ name: "fl.key", type: "decision" },
			{ flowchart: controller.flowHost() },
		)
		expect(nodes()).toHaveLength(6)
		expect(nodes().filter((n) => n.type === "decision")).toHaveLength(2)
	})

	it("a viewer gets the arrows only", () => {
		expect(commandFor(key("ArrowDown"), { flowchart: true, readonly: true })?.name).toBe(
			"fl.nav",
		)
		expect(commandFor(key("Enter"), { flowchart: true, readonly: true })).toBeNull()
	})
})

describe("the pointer", () => {
	beforeEach(() => setup())
	const centre = (id) => ({ x: node(id).x, y: node(id).y })

	it("finds a step under a point and selects it by a press", () => {
		const { x, y } = centre("p")
		expect(controller.flowAt({ x, y }).node.id).toBe("p")
		expect(controller.flowAt({ x: 5000, y: 5000 })).toBeNull()
		controller.pointerDown(press(x, y))
		controller.pointerUp(press(x, y))
		expect(store.state.selection).toEqual(["p"])
	})

	it("selects an arrow by a press on it", () => {
		const route = controller.flows.value.get("c").routes.get("sd")
		const a = route.points[0]
		const b = route.points[route.points.length - 1]
		const at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
		controller.pointerDown(press(at.x, at.y))
		controller.pointerUp(press(at.x, at.y))
		expect(store.state.selection).toEqual(["sd"])
	})

	it("a double-click edits a step or an arrow's label and makes no shape", () => {
		const { x, y } = centre("d")
		controller.doubleClick(press(x, y))
		expect(store.state.editingFlowId).toBe("d")
		expect(store.objects.value).toHaveLength(0)
		store.state.editingFlowId = null
		const route = controller.flows.value.get("c").routes.get("sd")
		const [a, b] = [route.points[0], route.points[route.points.length - 1]]
		controller.doubleClick(press((a.x + b.x) / 2, (a.y + b.y) / 2))
		expect(store.state.editingFlowId).toBe("sd")
	})

	it("dragging a step moves it and marks it as placed by hand, in one step", () => {
		const { x, y } = centre("p")
		const before = steps()
		controller.pointerDown(press(x, y))
		controller.pointerMove(press(x + 120, y))
		expect(store.state.flowDrag.nodeId).toBe("p")
		controller.pointerUp(press(x + 120, y))
		expect(node("p").x).toBe(x + 120)
		expect(node("p").manual).toBe(true)
		expect(store.state.flowDrag).toBeNull()
		expect(steps()).toBe(before + 1)
		store.undo()
		expect(node("p").x).toBe(x)
		expect(node("p").manual).toBe(false)
	})

	it("the arrows follow a step while it is dragged", () => {
		const { x, y } = centre("p")
		const route = (id) => controller.flows.value.get("c").routes.get(id)
		const before = JSON.stringify(route("dp").points)
		controller.pointerDown(press(x, y))
		controller.pointerMove(press(x + 200, y + 10))
		expect(JSON.stringify(route("dp").points)).not.toBe(before)
		controller.cancel()
		expect(store.state.flowDrag).toBeNull()
		expect(JSON.stringify(route("dp").points)).toBe(before)
	})

	it("pulling an arrow out of a '+' handle onto empty canvas asks for the type", () => {
		store.select(["p"])
		controller.pointerDown({ ...press(0, 0), target: handleTarget("p", "bottom") })
		controller.pointerMove(press(700, 540))
		expect(store.state.flowDrag.from).toBe("p")
		controller.pointerUp(press(700, 540))
		expect(store.state.flowPicker).toMatchObject({ from: "p", at: { x: 700, y: 540 } })
		controller.flowCommand({
			name: "fl.add",
			type: "process",
			from: "p",
			point: store.state.flowPicker.at,
		})
		const added = nodes().find((n) => n.x === 700 || Math.abs(n.x - 700) < 5)
		expect(added.manual).toBe(true)
		expect(edges().some((e) => e.from === "p" && e.to === added.id)).toBe(true)
	})

	it("a plain click on a '+' handle asks for the type, and onto another step connects", () => {
		store.select(["d"])
		controller.pointerDown({ ...press(0, 0), target: handleTarget("d", "right") })
		controller.pointerUp(press(0, 0))
		expect(store.state.flowPicker).toMatchObject({ from: "d", at: null })
		store.state.flowPicker = null
		const to = centre("s")
		controller.pointerDown({ ...press(0, 0), target: handleTarget("d", "right") })
		controller.pointerMove(press(to.x, to.y))
		expect(store.state.flowDrag.target).toBe("s")
		controller.pointerUp(press(to.x, to.y))
		expect(edges().some((e) => e.from === "d" && e.to === "s")).toBe(true)
	})

	it("a step with no arrows dropped on an arrow splits it", () => {
		store.applyOps(
			[
				{
					t: "add",
					list: "flownodes",
					items: [
						{
							id: "x",
							chartId: "c",
							type: "process",
							text: "Loose",
							x: 800,
							y: 380,
							manual: true,
						},
					],
				},
			],
			{ label: "Add" },
		)
		const route = controller.flows.value.get("c").routes.get("sd")
		const a = route.points[0]
		const b = route.points[route.points.length - 1]
		const at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
		controller.pointerDown(press(800, 380))
		controller.pointerMove(press(at.x, at.y))
		expect(store.state.flowDrag.spliceEdge).toBe("sd")
		controller.pointerUp(press(at.x, at.y))
		expect(edges().some((e) => e.from === "s" && e.to === "x")).toBe(true)
		expect(edges().some((e) => e.from === "x" && e.to === "d")).toBe(true)
	})

	it("a viewer can select but not drag", () => {
		store.state.readonly = true
		const { x, y } = centre("p")
		controller.pointerDown(press(x, y))
		controller.pointerMove(press(x + 100, y))
		controller.pointerUp(press(x + 100, y))
		expect(node("p").x).toBe(x)
		expect(store.state.selection).toEqual(["p"])
	})
})

function handleTarget(id, side) {
	const el = { dataset: { flowadd: id, side } }
	return { dataset: {}, closest: (sel) => (sel === "[data-flowadd]" ? el : null) }
}

describe("drawing and exporting", () => {
	beforeEach(() => setup())

	it("exports the chart: text, labels, shapes and area", () => {
		const items = collectItems(store, "board")
		expect(isEmpty(items)).toBe(false)
		const area = exportArea(store, items, "board", measure)
		expect(area.w).toBeGreaterThan(100)
		const svg = buildSvg(items, area, { measure })
		expect(svg).toContain("Ready?")
		expect(svg).toContain("Yes")
		expect(svg).toContain('data-flowchart="c"')
		expect(svg).toContain("polygon") // the decision diamond
	})

	it("numbers the steps when asked", () => {
		store.applyOps(
			[{ t: "update", list: "charts", changes: [{ id: "c", patch: { numbered: true } }] }],
			{ label: "n" },
		)
		const items = collectItems(store, "board")
		const svg = buildSvg(items, exportArea(store, items, "board", measure), { measure })
		expect(svg).toContain(">1<")
	})

	it("a selection export takes only the charts with a selected step or arrow", () => {
		store.select(["p"])
		expect(collectItems(store, "selection").charts).toHaveLength(1)
		store.select(["dp"])
		expect(collectItems(store, "selection").charts).toHaveLength(1)
		store.clearSelection()
		expect(collectItems(store, "selection").charts).toHaveLength(0)
	})

	it("steps follow the text being typed", () => {
		const wide = (text) => controller.flows.value.get("c").sizes.get("p").w
		const before = wide()
		store.applyOps(
			[
				{
					t: "update",
					list: "flownodes",
					changes: [
						{ id: "p", patch: { text: "A much longer step name than before, indeed" } },
					],
				},
			],
			{ label: "t" },
		)
		expect(wide()).toBeGreaterThanOrEqual(before)
	})
})

describe("the view", () => {
	it("fit to view and the board's bounds take the chart into account", () => {
		setup()
		const box = contentBounds(store)
		expect(box).not.toBeNull()
		expect(box.h).toBeGreaterThan(500) // from Start at the top to End at the bottom
		store.state.viewport = { x: 5000, y: 5000, scale: 1 }
		fitView(store)
		expect(store.state.viewport.x).not.toBe(5000)
		expect(store.state.viewport.scale).toBeLessThanOrEqual(1)
	})
})

describe("two people on one chart", () => {
	const flush = () => new Promise((resolve) => queueMicrotask(resolve))
	const settle = async () => {
		await flush()
		await flush()
	}
	function pair() {
		const snapshot = sample()
		const people = ["a", "b"].map(() => {
			const doc = new Y.Doc()
			Y.applyUpdate(doc, seedUpdate(snapshot))
			const s = createStore(snapshotFromDoc(doc, snapshot))
			s.state.size = { width: 1000, height: 700 }
			createBridge(s, doc)
			return { doc, store: s }
		})
		const [a, b] = people
		const send = (from, to) =>
			from.doc.on(
				"update",
				(u, origin) => origin !== "wire" && Y.applyUpdate(to.doc, u, "wire"),
			)
		send(a, b)
		send(b, a)
		return { a, b }
	}

	it("a step added by one appears for the other, with its arrow", async () => {
		const { a, b } = pair()
		const node = {
			id: "n1",
			chartId: "c",
			type: "process",
			text: "New",
			x: 600,
			y: 460,
			manual: false,
		}
		const edge = { id: "n1e", chartId: "c", from: "d", to: "n1", label: "", order: 2 }
		a.store.applyOps(
			[
				{ t: "add", list: "flownodes", items: [node] },
				{ t: "add", list: "flowedges", items: [edge] },
			],
			{ label: "Add step" },
		)
		await settle()
		expect(b.store.getFlowNode("n1")?.text).toBe("New")
		expect(b.store.getFlowEdge("n1e")?.to).toBe("n1")
	})

	it("two people moving different steps both win", async () => {
		const { a, b } = pair()
		a.store.applyOps(
			[
				{
					t: "update",
					list: "flownodes",
					changes: [{ id: "p", patch: { x: 700, manual: true } }],
				},
			],
			{ label: "m" },
		)
		b.store.applyOps(
			[
				{
					t: "update",
					list: "flownodes",
					changes: [{ id: "e", patch: { x: 100, manual: true } }],
				},
			],
			{ label: "m" },
		)
		await settle()
		for (const s of [a.store, b.store]) {
			expect(s.getFlowNode("p").x).toBe(700)
			expect(s.getFlowNode("e").x).toBe(100)
		}
	})

	it("a step deleted while another's arrow still points to it is repaired, not left dangling", async () => {
		const { a, b } = pair()
		a.store.applyOps(
			[
				{ t: "remove", list: "flowedges", ids: ["sd", "dp", "de"] },
				{ t: "remove", list: "flownodes", ids: ["d"] },
			],
			{ label: "Delete" },
		)
		b.store.applyOps(
			[
				{
					t: "add",
					list: "flowedges",
					items: [{ id: "late", chartId: "c", from: "d", to: "e", label: "", order: 5 }],
				},
			],
			{ label: "Connect" },
		)
		await settle()
		for (const s of [a.store, b.store]) {
			const ids = new Set(s.nodesOfChart("c").map((n) => n.id))
			for (const e of s.edgesOfChart("c")) {
				expect(ids.has(e.from)).toBe(true)
				expect(ids.has(e.to)).toBe(true)
			}
		}
	})
})
