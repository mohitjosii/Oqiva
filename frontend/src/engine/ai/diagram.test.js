import * as Y from "yjs"
import { describe, expect, it } from "vitest"
import { createBridge } from "../collab/bridge"
import { seedUpdate, snapshotFromDoc } from "../collab/ydoc"
import { buildSvg } from "../export/svg"
import { collectItems, exportArea, isEmpty } from "../export/scene"
import { createDocument } from "../model/schema"
import { createStore } from "../store/createStore"
import { backEdgeIds, tidyLayout } from "../modes/flowchart/layout"
import { buildArchitecture, buildFlowchart, buildMindMap, cleanSpec, depths } from "./diagram"
import { insertDiagram } from "./insert"

const measure = (text, size) => text.length * size * 0.5
const origin = { x: 500, y: 300 }

const LOGIN = {
	title: "Sign in",
	nodes: [
		{ id: "a", label: "Start", shape: "terminator" },
		{ id: "b", label: "Enter credentials", shape: "process" },
		{ id: "c", label: "Valid?", shape: "decision" },
		{ id: "d", label: "Show dashboard", shape: "process" },
		{ id: "e", label: "End", shape: "terminator" },
	],
	edges: [
		{ from: "a", to: "b" },
		{ from: "b", to: "c" },
		{ from: "c", to: "d" },
		{ from: "c", to: "b", label: "No" },
		{ from: "d", to: "e" },
	],
}

const STACK = {
	nodes: [
		{ id: "u", label: "Customer", shape: "user", lane: "Clients" },
		{ id: "w", label: "Web app", shape: "service", lane: "Clients" },
		{ id: "api", label: "API server", shape: "server", lane: "Services" },
		{ id: "q", label: "Job queue", shape: "queue", lane: "Services" },
		{ id: "db", label: "Orders database", shape: "database", lane: "Data" },
		{ id: "s3", label: "File storage", shape: "storage", lane: "Data" },
	],
	edges: [
		{ from: "u", to: "w" },
		{ from: "w", to: "api", label: "HTTPS" },
		{ from: "api", to: "q", style: "dashed" },
		{ from: "api", to: "db" },
		{ from: "q", to: "s3" },
	],
}

const storeWith = (extra = {}) => createStore(createDocument(extra))
const host = { origin, measure, reveal: () => {} }

describe("cleanSpec", () => {
	it("keeps sixty nodes and one hundred twenty edges, and drops what cannot be drawn", () => {
		const nodes = Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, label: `Step ${i}` }))
		const edges = Array.from({ length: 200 }, (_, i) => ({
			from: "n0",
			to: `n${(i % 79) + 1}`,
		}))
		const clean = cleanSpec({ nodes, edges })
		expect(clean.nodes).toHaveLength(60)
		expect(clean.edges.length).toBeLessThanOrEqual(120)
		for (const e of clean.edges) {
			expect(clean.nodes.some((n) => n.id === e.to)).toBe(true)
		}
	})

	it("drops loops, repeated edges, unknown ends and repeated ids", () => {
		const clean = cleanSpec({
			nodes: [
				{ id: "a", label: "A" },
				{ id: "a", label: "again" },
				{ id: "b", label: "B" },
			],
			edges: [
				{ from: "a", to: "a" },
				{ from: "a", to: "b" },
				{ from: "a", to: "b", label: "twice" },
				{ from: "a", to: "ghost" },
			],
		})
		expect(clean.nodes.map((n) => n.id)).toEqual(["a", "b"])
		expect(clean.edges).toHaveLength(1)
	})

	it("survives nonsense", () => {
		for (const raw of [null, {}, { nodes: "x" }, { nodes: [null, 3, {}] }])
			expect(cleanSpec(raw).nodes).toEqual([])
	})
})

describe("mind map", () => {
	it("grows a tree from the first node along the edges", () => {
		const built = buildMindMap(
			{
				nodes: [
					{ id: "r", label: "Launch" },
					{ id: "m", label: "Marketing" },
					{ id: "e", label: "Email" },
					{ id: "x", label: "Engineering" },
				],
				edges: [
					{ from: "r", to: "m" },
					{ from: "m", to: "e" },
					{ from: "r", to: "x" },
				],
			},
			{ origin },
		)
		const byText = Object.fromEntries(built.nodes.map((n) => [n.text, n]))
		expect(byText.Launch.parentId).toBeNull()
		expect(byText.Marketing.parentId).toBe(byText.Launch.id)
		expect(byText.Email.parentId).toBe(byText.Marketing.id)
		expect(byText.Engineering.parentId).toBe(byText.Launch.id)
		expect(built.map.rootId).toBe(byText.Launch.id)
		expect(built.map.origin).toEqual(origin)
		expect(built.links).toEqual([])
	})

	it("hangs nodes no edge reaches from the centre and turns extra edges into cross-links", () => {
		const built = buildMindMap(
			{
				nodes: [
					{ id: "r", label: "Root" },
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
					{ id: "lost", label: "Lost" },
				],
				edges: [
					{ from: "r", to: "a" },
					{ from: "r", to: "b" },
					{ from: "a", to: "b", label: "relates" },
				],
			},
			{ origin },
		)
		const lost = built.nodes.find((n) => n.text === "Lost")
		expect(lost.parentId).toBe(built.map.rootId)
		expect(built.links).toHaveLength(1)
		expect(built.links[0].label).toBe("relates")
		const ids = new Set(built.nodes.map((n) => n.id))
		expect(ids.has(built.links[0].from) && ids.has(built.links[0].to)).toBe(true)
	})

	it("is one undo step", () => {
		const store = storeWith()
		const ok = insertDiagram(store, STACK, "mindmap", host)
		expect(ok).toBe(true)
		expect(store.maps.value).toHaveLength(1)
		expect(store.nodesOfMap(store.maps.value[0].id)).toHaveLength(6)
		expect(store.history.undoStack).toHaveLength(1)
		store.undo()
		expect(store.maps.value).toHaveLength(0)
		store.redo()
		expect(store.maps.value).toHaveLength(1)
	})
})

describe("flowchart", () => {
	it("makes typed steps, ordered and labelled edges, and a tidy layout around the origin", () => {
		const built = buildFlowchart(LOGIN, { origin, measure })
		const types = Object.fromEntries(built.nodes.map((n) => [n.text, n.type]))
		expect(types).toMatchObject({
			Start: "terminator",
			"Valid?": "decision",
			"Show dashboard": "process",
		})
		const valid = built.nodes.find((n) => n.text === "Valid?")
		const outs = built.edges.filter((e) => e.from === valid.id)
		expect(outs.map((e) => e.order)).toEqual([0, 1])
		// the model named one branch; the other still reads as a branch
		expect(outs.map((e) => e.label).sort()).toEqual(["No", "Yes"])
		const mid = { x: built.box.x + built.box.w / 2, y: built.box.y + built.box.h / 2 }
		expect(Math.abs(mid.x - origin.x)).toBeLessThan(1)
		expect(Math.abs(mid.y - origin.y)).toBeLessThan(1)
		// top to bottom: Start above End
		const y = (t) => built.nodes.find((n) => n.text === t).y
		expect(y("Start")).toBeLessThan(y("End"))
	})

	it("matches what Tidy up would do", () => {
		const built = buildFlowchart(LOGIN, { origin, measure })
		const again = tidyLayout(
			{ ...built.chart },
			built.nodes.map((n) => ({ ...n, x: 0, y: 0 })),
			built.edges,
			measure,
		)
		const xs = built.nodes.map((n) => n.x)
		const ys = built.nodes.map((n) => n.y)
		const shiftX = xs[0] - again.get(built.nodes[0].id).x
		const shiftY = ys[0] - again.get(built.nodes[0].id).y
		for (const n of built.nodes) {
			expect(Math.abs(n.x - (again.get(n.id).x + shiftX))).toBeLessThanOrEqual(1)
			expect(Math.abs(n.y - (again.get(n.id).y + shiftY))).toBeLessThanOrEqual(1)
		}
		expect(backEdgeIds(built.chart, built.nodes, built.edges).size).toBe(1)
	})

	it("is added as one undoable step with its first step selected", () => {
		const store = storeWith()
		expect(insertDiagram(store, LOGIN, "flowchart", host)).toBe(true)
		expect(store.charts.value).toHaveLength(1)
		const chart = store.charts.value[0]
		expect(store.nodesOfChart(chart.id)).toHaveLength(5)
		expect(store.edgesOfChart(chart.id)).toHaveLength(5)
		expect(store.state.selection).toHaveLength(1)
		expect(store.history.undoStack).toHaveLength(1)
		store.undo()
		expect(store.charts.value).toHaveLength(0)
		expect(store.flownodes?.value ?? []).toHaveLength(0)
	})
})

describe("architecture", () => {
	it("measures depth from the edges and ignores an edge that closes a cycle", () => {
		const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }]
		const d = depths(nodes, [
			{ from: "a", to: "b" },
			{ from: "b", to: "c" },
			{ from: "c", to: "a" },
		])
		expect([d.get("a"), d.get("b"), d.get("c")]).toEqual([0, 1, 2])
	})

	it("puts each lane in its own framed column and each depth in its own row", () => {
		const built = buildArchitecture(STACK, { origin, measure, theme: "ocean", z: 1 })
		expect(built.frames.map((f) => f.name)).toEqual(["Clients", "Services", "Data"])
		const object = (label) =>
			built.objects.find((o) => o.text.paragraphs[0].runs[0].t === label)
		expect(object("Orders database").shape).toBe("cylinder")
		expect(object("Job queue").shape).toBe("hexagon")
		expect(object("Customer").shape).toBe("ellipse")
		const frame = (name) => built.frames.find((f) => f.name === name)
		// lanes run left to right, in the order they first appear
		expect(frame("Clients").x).toBeLessThan(frame("Services").x)
		expect(frame("Services").x).toBeLessThan(frame("Data").x)
		// a shape sits inside its lane's frame
		const inside = (o, f) =>
			o.x >= f.x && o.x + o.w <= f.x + f.w && o.y >= f.y && o.y + o.h <= f.y + f.h
		expect(inside(object("API server"), frame("Services"))).toBe(true)
		expect(inside(object("Orders database"), frame("Data"))).toBe(true)
		// the flow runs down: Customer above Web app above API server
		expect(object("Customer").y).toBeLessThan(object("Web app").y)
		expect(object("Web app").y).toBeLessThan(object("API server").y)
	})

	it("draws frames behind shapes and shapes behind arrows, and joins real shapes", () => {
		const built = buildArchitecture(STACK, { origin, measure, theme: "ocean", z: 10 })
		const zs = [...built.frames, ...built.objects, ...built.connectors].map((i) => i.z)
		expect(zs).toEqual([...zs].sort((a, b) => a - b))
		expect(new Set(zs).size).toBe(zs.length)
		const ids = new Set(built.objects.map((o) => o.id))
		for (const c of built.connectors) {
			expect(ids.has(c.from.objectId) && ids.has(c.to.objectId)).toBe(true)
		}
		const dashed = built.connectors.filter((c) => c.style.dash === "dashed")
		expect(dashed).toHaveLength(1)
		expect(built.connectors.find((c) => c.label)?.label).toEqual({ text: "HTTPS" })
	})

	it("draws no frames when there is one lane or none", () => {
		const one = buildArchitecture(
			{ ...LOGIN, nodes: LOGIN.nodes.map((n) => ({ ...n, lane: "Only" })) },
			{ origin, measure, theme: "ocean" },
		)
		expect(one.frames).toEqual([])
		const none = buildArchitecture(LOGIN, { origin, measure, theme: "ocean" })
		expect(none.frames).toEqual([])
		expect(none.objects).toHaveLength(5)
	})

	it("is centred on the origin and added as one undoable step", () => {
		const store = storeWith()
		const built = buildArchitecture(STACK, { origin, measure, theme: "ocean" })
		expect(Math.abs(built.box.x + built.box.w / 2 - origin.x)).toBeLessThan(2)
		expect(insertDiagram(store, STACK, "architecture", host)).toBe(true)
		expect(store.objects.value).toHaveLength(3 + 6)
		expect(store.connectors.value).toHaveLength(5)
		expect(store.state.selection).toHaveLength(6)
		expect(store.history.undoStack).toHaveLength(1)
		store.undo()
		expect(store.objects.value).toHaveLength(0)
		expect(store.connectors.value).toHaveLength(0)
	})
})

describe("inserting", () => {
	it("refuses on a read-only board and for an empty description", () => {
		const view = createStore(createDocument(), { readonly: true })
		expect(insertDiagram(view, LOGIN, "flowchart", host)).toBe(false)
		expect(insertDiagram(storeWith(), { nodes: [] }, "flowchart", host)).toBe(false)
	})

	it("goes in free space beside what is already there instead of on top of it", () => {
		const store = storeWith()
		const boxes = []
		const reveal = (rect) => boxes.push(rect)
		const union = () => {
			const x1 = Math.min(...boxes.map((b) => b.x))
			const y1 = Math.min(...boxes.map((b) => b.y))
			const x2 = Math.max(...boxes.map((b) => b.x + b.w))
			const y2 = Math.max(...boxes.map((b) => b.y + b.h))
			return boxes.length ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null
		}
		const place = (spec, kind) => {
			const before = boxes.length
			expect(
				insertDiagram(store, spec, kind, { origin, measure, content: union, reveal }),
			).toBe(true)
			expect(boxes.length).toBe(before + 1)
			return boxes.at(-1)
		}
		const first = place(STACK, "architecture")
		const second = place(LOGIN, "flowchart")
		const third = place(STACK, "mindmap")
		const apart = (a, b) =>
			a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h
		expect(apart(first, second)).toBe(true)
		expect(apart(first, third) && apart(second, third)).toBe(true)
		// the first one still sits at the middle of the view
		expect(Math.abs(first.x + first.w / 2 - origin.x)).toBeLessThan(2)
	})

	it("stays within the board's object limit instead of half-adding", () => {
		const store = storeWith()
		const many = {
			nodes: Array.from({ length: 60 }, (_, i) => ({
				id: `n${i}`,
				label: `N${i}`,
				lane: "L",
			})),
			edges: [],
		}
		expect(insertDiagram(store, many, "architecture", host)).toBe(true)
		expect(store.objects.value).toHaveLength(60)
	})

	it("converges for a peer: the same records arrive through the shared document", async () => {
		const snapshot = createDocument()
		const people = ["a", "b"].map(() => {
			const doc = new Y.Doc()
			Y.applyUpdate(doc, seedUpdate(snapshot))
			const s = createStore(snapshotFromDoc(doc, snapshot))
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
		insertDiagram(a.store, STACK, "architecture", host)
		insertDiagram(a.store, LOGIN, "flowchart", { ...host, origin: { x: 1500, y: 300 } })
		insertDiagram(a.store, STACK, "mindmap", { ...host, origin: { x: 3000, y: 300 } })
		await new Promise((resolve) => queueMicrotask(resolve))
		await new Promise((resolve) => queueMicrotask(resolve))
		expect(b.store.objects.value.map((o) => o.id)).toEqual(
			a.store.objects.value.map((o) => o.id),
		)
		expect(b.store.connectors.value).toHaveLength(5)
		expect(b.store.charts.value).toHaveLength(1)
		expect(b.store.nodesOfChart(b.store.charts.value[0].id)).toHaveLength(5)
		expect(b.store.maps.value).toHaveLength(1)
		// and one undo on the author's side removes the mind map from the peer too
		a.store.undo()
		await new Promise((resolve) => queueMicrotask(resolve))
		await new Promise((resolve) => queueMicrotask(resolve))
		expect(b.store.maps.value).toHaveLength(0)
	})

	it("exports like anything else", () => {
		const store = storeWith()
		insertDiagram(store, STACK, "architecture", host)
		insertDiagram(store, LOGIN, "flowchart", { ...host, origin: { x: 1500, y: 300 } })
		insertDiagram(store, STACK, "mindmap", { ...host, origin: { x: 3000, y: 300 } })
		const items = collectItems(store, "board")
		expect(isEmpty(items)).toBe(false)
		const area = exportArea(store, items, "board", (text, style) => measure(text, style.size))
		expect(area.w).toBeGreaterThan(400)
		const svg = buildSvg(items, area, { measure: (text, style) => measure(text, style.size) })
		expect(svg).toContain("Orders database")
		expect(svg).toContain("Valid?")
		expect(svg).toContain("Job queue")
	})
})
