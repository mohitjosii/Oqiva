// How the engine behaves at the sizes the product promises (Phase 13, P13.02). Every test prints what
// it measured, and fails only when something is many times slower than it was when this was
// written (the limits are 5 to 20 times what was measured), so a real regression shows and a slow machine does not. Run with `yarn vitest run
// src/engine/performance.test.js` to see the numbers.
import * as Y from "yjs"
import { describe, expect, it } from "vitest"
import { createBridge } from "./collab/bridge"
import { seedUpdate, snapshotFromDoc } from "./collab/ydoc"
import { createObject } from "./model/factories"
import { createDocument, parseDocument } from "./model/schema"
import { tidyLayout } from "./modes/flowchart/layout"
import { routeAll } from "./modes/flowchart/routing"
import { randomGraph, chartOf, measure as flowMeasure } from "./modes/flowchart/layoutTestUtils"
import { layoutMap } from "./modes/mindmap/layout"
import { mapOf, measure as mapMeasure, randomTree } from "./modes/mindmap/testUtils"
import { createStore } from "./store/createStore"

const time = (label, work) => {
	const start = performance.now()
	const result = work()
	const took = performance.now() - start
	console.log(`  ${label}: ${took.toFixed(0)} ms`)
	return { result, took }
}

const shapes = (count) => {
	const columns = 60
	return Array.from({ length: count }, (_, i) => {
		const object = createObject(
			"rectangle",
			{ x: (i % columns) * 190, y: Math.floor(i / columns) * 120, w: 160, h: 90 },
			{ z: i + 1, text: null },
		)
		object.text = {
			align: "center",
			size: 16,
			color: "#1E293B",
			paragraphs: [{ runs: [{ t: `Shape number ${i}` }] }],
		}
		return object
	})
}

describe("mind maps", () => {
	for (const count of [500, 1000, 2000]) {
		it(`lays out ${count} nodes`, () => {
			const nodes = randomTree(count, 7)
			const { result, took } = time(`mind map layout, ${count} nodes`, () =>
				layoutMap(mapOf(nodes), nodes, mapMeasure),
			)
			expect(result.boxes.size).toBe(count)
			expect(took).toBeLessThan(count <= 1000 ? 400 : 800)
		})
	}
})

describe("flowcharts", () => {
	it("tidies the largest chart the product allows (500 steps, 800 arrows)", () => {
		const { nodes, edges } = randomGraph(500, 3, { extra: 0.6, back: 60 })
		const used = edges.slice(0, 800)
		const { result, took } = time("flowchart tidy, 500 steps", () =>
			tidyLayout(chartOf(), nodes, used, flowMeasure),
		)
		expect(result.size).toBe(500)
		expect(took).toBeLessThan(1500)
	})

	it("routes every arrow of a 300-step chart", () => {
		const { nodes, edges } = randomGraph(300, 5, { extra: 0.4, back: 30 })
		const positions = tidyLayout(chartOf(), nodes, edges, flowMeasure)
		const placed = nodes.map((n) => ({ ...n, ...positions.get(n.id) }))
		const { result, took } = time("flowchart routing, 300 steps", () =>
			routeAll(chartOf(), placed, edges, flowMeasure),
		)
		expect(result.size).toBeGreaterThan(0)
		expect(took).toBeLessThan(1500)
	})
})

describe("a board with 3,000 shapes (the default limit)", () => {
	const objects = shapes(3000)
	const document = { ...createDocument(), objects }

	it("is read and checked", () => {
		const raw = JSON.parse(JSON.stringify(document))
		const { result, took } = time("parseDocument, 3000 shapes", () => parseDocument(raw))
		expect(result.document.objects).toHaveLength(3000)
		console.log(`  document size: ${(JSON.stringify(document).length / 1024).toFixed(0)} KB`)
		expect(took).toBeLessThan(500)
	})

	it("is opened as a store, selected, moved and undone", () => {
		const { result: store, took: opened } = time("createStore, 3000 shapes", () =>
			createStore(document),
		)
		expect(opened).toBeLessThan(500)
		time("select all", () => store.select(objects.map((o) => o.id)))
		const { took: moved } = time("move 3000 shapes as one step", () =>
			store.updateObjects(
				objects.map((o) => ({ id: o.id, patch: { x: o.x + 10, y: o.y + 10 } })),
				{ label: "Move" },
			),
		)
		expect(moved).toBeLessThan(600)
		const { took: undone } = time("undo the move", () => store.undo())
		expect(undone).toBeLessThan(600)
		expect(store.objects.value[0].x).toBe(objects[0].x)
	})

	it("goes through the shared document and reaches a peer", async () => {
		const snapshot = document
		const a = new Y.Doc()
		const b = new Y.Doc()
		Y.applyUpdate(a, seedUpdate(snapshot))
		Y.applyUpdate(b, seedUpdate(snapshot))
		const sa = createStore(snapshotFromDoc(a, snapshot))
		const sb = createStore(snapshotFromDoc(b, snapshot))
		createBridge(sa, a)
		createBridge(sb, b)
		a.on("update", (u, origin) => origin !== "wire" && Y.applyUpdate(b, u, "wire"))
		const { took } = time("move 3000 shapes in A (write to the shared document)", () =>
			sa.updateObjects(
				objects.map((o) => ({ id: o.id, patch: { x: o.x + 25 } })),
				{ label: "Move" },
			),
		)
		expect(took).toBeLessThan(1500)
		const start = performance.now()
		for (let i = 0; i < 50 && sb.objects.value[0].x !== objects[0].x + 25; i++)
			await new Promise((resolve) => setTimeout(resolve, 20))
		console.log(`  peer sees the move after: ${(performance.now() - start).toFixed(0)} ms`)
		expect(sb.objects.value[2999].x).toBe(objects[2999].x + 25)
		const bytes = Y.encodeStateAsUpdate(a).length
		console.log(`  shared document state: ${(bytes / 1024).toFixed(0)} KB`)
	})
})
