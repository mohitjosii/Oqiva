import * as Y from "yjs"
import { beforeEach, describe, expect, it } from "vitest"
import { createBridge } from "../../collab/bridge"
import { seedUpdate, snapshotFromDoc } from "../../collab/ydoc"
import { buildSvg } from "../../export/svg"
import { collectItems, exportArea, isEmpty } from "../../export/scene"
import { CanvasController } from "../../interaction/controller"
import { runCommand } from "../../interaction/commands"
import { commandFor } from "../../interaction/keymap"
import { createObject } from "../../model/factories"
import { createDocument, parseDocument } from "../../model/schema"
import { createStore } from "../../store/createStore"
import { measure as sizeMeasure } from "./testUtils"

// The real measurer takes a style object; the mind map code adapts it to a size.
const measure = (text, style) => sizeMeasure(text, style.size)
import { nodesOwnKeys } from "./commands"
import { flattenMindmaps, nestMindmaps, sanitizeMindmaps } from "./document"
import { createMap } from "./model"
import { clearMap } from "./storeOps"
import * as tree from "./tree"

const press = (x, y, over = {}) => ({
	clientX: x,
	clientY: y,
	button: 0,
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	...over,
})

// A map with a root and two children A, B; A has A1. Ids are readable.
function sample(extra = {}) {
	const { map, root } = createMap({ origin: { x: 500, y: 350 }, id: "m" })
	const mk = (id, parentId, order, text) => ({
		id,
		mapId: "m",
		parentId,
		order,
		text,
		collapsed: false,
		color: null,
		marker: null,
		note: "",
	})
	const nodes = [
		{ ...root, id: "r", text: "Root" },
		mk("a", "r", 0, "Alpha"),
		mk("b", "r", 1, "Beta"),
		mk("a1", "a", 0, "Alpha one"),
	]
	const document = {
		...createDocument(),
		mindmaps: nestMindmaps([{ ...map, rootId: "r" }], nodes, []),
		...extra,
	}
	return document
}

let store
let controller
let asked
function setup(document = sample(), options = {}) {
	store = createStore(document, options)
	store.state.size = { width: 1000, height: 700 }
	store.state.viewport = { x: 0, y: 0, scale: 1 }
	asked = []
	controller = new CanvasController(store, {
		measure,
		ask: async (message) => (asked.push(message), true),
	})
	return controller
}
const text = (id) => store.getMapNode(id).text
const kids = (id) => tree.childrenOf(store.nodesOfMap("m"), id).map((n) => n.id)
const run = (name, extra = {}) => controller.mapCommand({ name, ...extra })

describe("how a document holds mind maps", () => {
	it("nests and flattens without loss", () => {
		const doc = sample()
		const flat = flattenMindmaps(doc.mindmaps)
		expect(flat.maps).toHaveLength(1)
		expect(flat.nodes).toHaveLength(4)
		expect(
			nestMindmaps(flat.maps, flat.nodes, flat.crosslinks)[0]
				.nodes.map((n) => n.id)
				.sort(),
		).toEqual(["a", "a1", "b", "r"])
	})

	it("repairs a map: orphans, cycles, duplicate ids, a missing root, dangling cross-links", () => {
		const doc = sample()
		const raw = JSON.parse(JSON.stringify(doc.mindmaps))
		raw[0].nodes.push({ id: "orphan", parentId: "nobody", order: 0, text: "x" })
		raw[0].nodes.push(
			{ id: "c1", parentId: "c2", order: 0, text: "x" },
			{ id: "c2", parentId: "c1", order: 0, text: "y" },
		) // a cycle apart from the tree
		raw[0].nodes.push({ id: "a", parentId: "r", order: 9, text: "again" }) // duplicate id
		raw[0].crosslinks = [
			{ id: "l1", from: "a", to: "b", label: "ok" },
			{ id: "l2", from: "a", to: "gone", label: "bad" },
			{ id: "l3", from: "a", to: "a", label: "self" },
		]
		const { mindmaps, issues } = sanitizeMindmaps(raw)
		expect(mindmaps[0].nodes.map((n) => n.id).sort()).toEqual(["a", "a1", "b", "r"])
		expect(mindmaps[0].crosslinks.map((l) => l.id)).toEqual(["l1"])
		expect(issues.length).toBeGreaterThan(0)
		expect(sanitizeMindmaps([{ ...raw[0], rootId: "nobody" }]).mindmaps).toEqual([])
		expect(sanitizeMindmaps("nonsense").mindmaps).toEqual([])
	})

	it("cleans values, caps lengths, and refuses ids that objects already use", () => {
		const doc = sample()
		const raw = JSON.parse(JSON.stringify(doc.mindmaps))
		const alpha = raw[0].nodes.find((n) => n.id === "a")
		alpha.text = "x".repeat(900)
		alpha.color = "url(#evil)"
		alpha.marker = { icon: "../x", dot: "#GGGGGG" }
		alpha.note = "n".repeat(5000)
		const { mindmaps } = sanitizeMindmaps(raw)
		const a = mindmaps[0].nodes.find((n) => n.id === "a")
		expect([a.text.length, a.color, a.marker, a.note.length]).toEqual([500, null, null, 2000])
		expect(sanitizeMindmaps(raw, new Set(["m"])).mindmaps).toEqual([]) // the map's id is taken by a shape
	})

	it("a parsed document keeps its mind maps, and a broken one is repaired on the way in", () => {
		const doc = sample()
		doc.mindmaps[0].nodes.push({ id: "orphan", parentId: "x", order: 0, text: "" })
		const { document, issues } = parseDocument(JSON.parse(JSON.stringify(doc)))
		expect(document.mindmaps[0].nodes).toHaveLength(4)
		expect(issues.join()).toContain("repaired")
	})
})

describe("the store", () => {
	beforeEach(() => setup())

	it("holds the maps, nodes and cross-links, and saves them nested again", () => {
		expect(store.maps.value).toHaveLength(1)
		expect(store.mapNodes.value).toHaveLength(4)
		const saved = store.snapshot().mindmaps
		expect(saved[0].id).toBe("m")
		expect(saved[0].nodes).toHaveLength(4)
		expect(saved[0].nodes[0]).not.toHaveProperty("mapId")
	})

	it("a mind map step is one undo step, and undo puts every node back", () => {
		const before = JSON.stringify(store.snapshot().mindmaps)
		const change = tree.addChild(store.nodesOfMap("m"), "b", "new")
		store.applyOps([{ t: "add", list: "mapnodes", items: change.add }], { label: "Add node" })
		expect(store.mapNodes.value).toHaveLength(5)
		expect(store.history.undoStack).toHaveLength(1)
		store.undo()
		expect(JSON.stringify(store.snapshot().mindmaps)).toBe(before)
		store.redo()
		expect(store.mapNodes.value).toHaveLength(5)
	})

	it("counts nodes against the board's object limit", () => {
		store.setLimits({ maxObjects: 4 })
		const change = tree.addChild(store.nodesOfMap("m"), "b", "one too many")
		expect(
			store.applyOps([{ t: "add", list: "mapnodes", items: change.add }], { label: "x" }),
		).toBe(false)
		expect(store.mapNodes.value).toHaveLength(4)
	})

	it("restoring a version replaces the maps as well", () => {
		const { document } = parseDocument(JSON.parse(JSON.stringify(sample())))
		const other = { ...document, mindmaps: [] }
		store.replaceContent(other)
		expect(store.maps.value).toHaveLength(0)
		store.undo()
		expect(store.mapNodes.value).toHaveLength(4)
	})

	it("generic delete leaves nodes alone (they have their own delete)", () => {
		store.select(["a"])
		expect(store.removeItems(["a"])).toBe(false)
		expect(store.mapNodes.value).toHaveLength(4)
	})
})

describe("the commands", () => {
	beforeEach(() => setup())

	it("Tab adds a child and starts editing it; one step", async () => {
		store.select(["b"])
		await run("mm.child")
		expect(store.mapNodes.value).toHaveLength(5)
		const added = kids("b")[0]
		expect(store.state.selection).toEqual([added])
		expect(store.state.editingNodeId).toBe(added)
		expect(store.state.editingNodeNew).toBe(true)
		expect(store.history.undoStack).toHaveLength(1)
	})

	it("Enter adds a sibling right after, renumbering the rest; on the root it adds a child", async () => {
		store.select(["a"])
		await run("mm.sibling")
		expect(kids("r").length).toBe(3)
		expect(kids("r")[0]).toBe("a")
		expect(kids("r")[2]).toBe("b")
		store.select(["r"])
		await run("mm.sibling")
		expect(kids("r").length).toBe(4)
	})

	it("promotes, moves among siblings, and ignores what is not allowed", async () => {
		store.select(["a1"])
		await run("mm.promote") // depth 2 -> becomes a sibling of "a"
		expect(store.getMapNode("a1").parentId).toBe("r")
		store.select(["b"])
		await run("mm.moveUp")
		expect(kids("r")).toEqual(["a", "b", "a1"]) // "b" went above "a1", which is now its sibling
		store.select(["a"])
		expect(await run("mm.promote")).toBe(false) // first level
		store.select(["r"])
		expect(await run("mm.moveDown")).toBe(false)
	})

	it("arrows walk the tree", async () => {
		store.select(["r"])
		await run("mm.nav", { direction: "right" })
		expect(store.state.selection[0]).toBe("a")
		await run("mm.nav", { direction: "right" })
		expect(store.state.selection[0]).toBe("a1")
		await run("mm.nav", { direction: "left" })
		expect(store.state.selection[0]).toBe("a")
	})

	it("Delete asks before removing a branch, and removes it with its cross-links in one step", async () => {
		store.applyOps(
			[
				{
					t: "add",
					list: "crosslinks",
					items: [{ id: "l", mapId: "m", from: "a1", to: "b", label: "see" }],
				},
			],
			{ label: "x" },
		)
		store.select(["a"])
		await run("mm.delete")
		expect(asked).toEqual(["Delete 2 nodes?"])
		expect(store.mapNodes.value.map((n) => n.id).sort()).toEqual(["b", "r"])
		expect(store.crosslinks.value).toHaveLength(0)
		expect(store.state.selection).toEqual(["r"])
		store.undo()
		expect(store.mapNodes.value).toHaveLength(4)
		expect(store.crosslinks.value).toHaveLength(1)
	})

	it("a refused question changes nothing", async () => {
		controller.ask = async () => false
		store.select(["a"])
		expect(await run("mm.delete")).toBe(false)
		expect(store.mapNodes.value).toHaveLength(4)
	})

	it("Delete on a leaf asks nothing; on the only map's root it clears the map; with several it deletes it", async () => {
		store.select(["b"])
		await run("mm.delete")
		expect(asked).toEqual([])
		store.select(["r"])
		await run("mm.delete")
		expect(asked.at(-1)).toContain("Clear")
		expect(store.mapNodes.value.map((n) => n.id)).toEqual(["r"])
		store.undo()
		expect(store.mapNodes.value.length).toBeGreaterThan(1)
		// a second map: now the root deletes its whole map
		const second = createMap({ origin: { x: 1500, y: 0 }, id: "m2" })
		store.applyOps(
			[
				{ t: "add", list: "maps", items: [second.map] },
				{ t: "add", list: "mapnodes", items: [second.root] },
			],
			{ label: "x" },
		)
		store.select([second.root.id])
		await run("mm.delete")
		expect(asked.at(-1)).toContain("whole mind map")
		expect(store.maps.value.map((m) => m.id)).toEqual(["m"])
	})

	it("collapse and expand, collapse all and expand all", async () => {
		store.select(["a"])
		await run("mm.toggle")
		expect(store.getMapNode("a").collapsed).toBe(true)
		await run("mm.toggle", { collapsed: false })
		expect(store.getMapNode("a").collapsed).toBe(false)
		store.select(["r"])
		await run("mm.collapseAll")
		expect(store.getMapNode("a").collapsed).toBe(true)
		expect(store.getMapNode("b").collapsed).toBe(false) // a leaf has nothing to collapse
		await run("mm.expandAll")
		expect(store.getMapNode("a").collapsed).toBe(false)
	})

	it("M makes a new map in the middle of the screen with its root ready to type over", async () => {
		store.clearSelection()
		await run("mm.new")
		expect(store.maps.value).toHaveLength(2)
		const made = store.maps.value[1]
		expect(made.origin).toEqual({ x: 500, y: 350 })
		expect(store.state.editingNodeId).toBe(made.rootId)
		expect(store.getMapNode(made.rootId).text).toBe("Central idea")
	})

	it("a read-only viewer can walk the map but change nothing", async () => {
		setup(sample(), { readonly: true })
		store.select(["r"])
		expect(await run("mm.child")).toBe(false)
		expect(await run("mm.delete")).toBe(false)
		await run("mm.nav", { direction: "right" })
		expect(store.state.selection[0]).toBe("a")
		expect(store.mapNodes.value).toHaveLength(4)
	})

	it("clears a map down to its root", () => {
		expect(clearMap(store, "m")).toBe(true)
		expect(store.mapNodes.value.map((n) => n.id)).toEqual(["r"])
	})
})

describe("the keys", () => {
	const key = (k, over = {}) => ({ key: k, target: {}, ...over })
	beforeEach(() => setup())

	it("belong to the mind map only when nodes are all that is selected", () => {
		store.select(["a"])
		expect(nodesOwnKeys(store)).toBe(true)
		const o = { mindmap: true }
		expect(commandFor(key("Tab"), o)).toEqual({ name: "mm.child" })
		expect(commandFor(key("Tab", { shiftKey: true }), o)).toEqual({ name: "mm.promote" })
		expect(commandFor(key("Enter"), o)).toEqual({ name: "mm.sibling" })
		expect(commandFor(key("ArrowRight"), o)).toEqual({ name: "mm.nav", direction: "right" }) // not a nudge
		expect(commandFor(key("ArrowUp", { altKey: true }), o)).toEqual({ name: "mm.moveUp" })
		expect(commandFor(key("Delete"), o)).toEqual({ name: "mm.delete" })
		expect(commandFor(key("ArrowRight"), {})).toMatchObject({ name: "nudge" })
		expect(commandFor(key("Tab"), {})).toBeNull()
		store.select(["a"])
		store.addObjects([
			{
				...createObject(
					"rectangle",
					{ x: 0, y: 0, w: 10, h: 10 },
					{ theme: "ocean", z: 1 },
				),
				id: "s",
			},
		])
		store.select(["a", "s"])
		expect(nodesOwnKeys(store)).toBe(false)
	})

	it("a viewer may use the arrows only; M makes a map for editors", () => {
		expect(commandFor(key("ArrowRight"), { mindmap: true, readonly: true })).toEqual({
			name: "mm.nav",
			direction: "right",
		})
		expect(commandFor(key("Tab"), { mindmap: true, readonly: true })).toBeNull()
		expect(commandFor(key("m"), {})).toEqual({ name: "mm.new" })
		expect(commandFor(key("m"), { readonly: true })).toBeNull()
	})

	it("go through runCommand to the mind map", async () => {
		store.select(["b"])
		await runCommand(store, controller, { name: "mm.child" }, { mindmap: controller.mapHost() })
		expect(kids("b")).toHaveLength(1)
	})
})

describe("the pointer", () => {
	beforeEach(() => setup())
	const centre = (id) => {
		const box = controller.maps.value.get("m").boxes.get(id)
		return { x: box.x + box.w / 2, y: box.y + box.h / 2, box }
	}

	it("finds a node under a point, and selects it by a press", () => {
		const { x, y } = centre("a")
		expect(controller.nodeAt({ x, y }).node.id).toBe("a")
		expect(controller.nodeAt({ x: 5000, y: 5000 })).toBeNull()
		controller.pointerDown(press(x, y))
		controller.pointerUp(press(x, y))
		expect(store.state.selection).toEqual(["a"])
	})

	it("Shift adds nodes to the selection", () => {
		const a = centre("a")
		const b = centre("b")
		controller.pointerDown(press(a.x, a.y))
		controller.pointerUp(press(a.x, a.y))
		controller.pointerDown(press(b.x, b.y, { shiftKey: true }))
		controller.pointerUp(press(b.x, b.y, { shiftKey: true }))
		expect(store.state.selection.sort()).toEqual(["a", "b"])
	})

	it("a double-click on a node edits it and makes no shape", () => {
		const { x, y } = centre("b")
		controller.doubleClick(press(x, y))
		expect(store.state.editingNodeId).toBe("b")
		expect(store.objects.value).toHaveLength(0)
	})

	it("dragging a node onto another makes it that node's child, in one step", () => {
		const from = centre("a1")
		const onto = centre("b")
		controller.pointerDown(press(from.x, from.y))
		controller.pointerMove(press(onto.x, onto.y))
		expect(store.state.mapDrag.target).toEqual({ type: "into", id: "b" })
		controller.pointerUp(press(onto.x, onto.y))
		expect(store.getMapNode("a1").parentId).toBe("b")
		expect(store.state.mapDrag).toBeNull()
		expect(store.history.undoStack).toHaveLength(1)
		store.undo()
		expect(store.getMapNode("a1").parentId).toBe("a")
	})

	it("above or below a node it reorders among that node's siblings", () => {
		const a = centre("a")
		const b = centre("b")
		controller.pointerDown(press(b.x, b.y))
		controller.pointerMove(press(a.x, a.box.y + 2)) // the top of "a"
		expect(store.state.mapDrag.target).toEqual({ type: "before", id: "a" })
		controller.pointerUp(press(a.x, a.box.y + 2))
		expect(kids("r")).toEqual(["b", "a"])
	})

	it("never drops a node into its own subtree, and not on empty canvas", () => {
		const a = centre("a")
		const inner = centre("a1")
		controller.pointerDown(press(a.x, a.y))
		controller.pointerMove(press(inner.x, inner.y))
		expect(store.state.mapDrag.target).toBeNull()
		controller.pointerUp(press(inner.x, inner.y))
		expect(store.getMapNode("a").parentId).toBe("r")
		controller.pointerDown(press(a.x, a.y))
		controller.pointerMove(press(900, 600))
		expect(store.state.mapDrag.target).toBeNull()
		controller.pointerUp(press(900, 600))
		expect(kids("r")).toEqual(["a", "b"])
	})

	it("dragging the root moves the whole map, in one step", () => {
		const root = centre("r")
		controller.pointerDown(press(root.x, root.y))
		controller.pointerMove(press(root.x + 100, root.y + 40))
		expect(store.state.mapDrag).toMatchObject({ mapId: "m", dx: 100, dy: 40 })
		controller.pointerUp(press(root.x + 100, root.y + 40))
		expect(store.getMap("m").origin).toEqual({ x: 600, y: 390 })
		expect(store.history.undoStack).toHaveLength(1)
		expect(controller.maps.value.get("m").boxes.get("r").x).toBeGreaterThan(
			centre("r").box.x - 1,
		)
	})

	it("the collapse badge and the plus button do what Tab and the minus key do", () => {
		const toggle = { target: { closest: () => ({ dataset: { mmtoggle: "a" } }) } }
		controller.pointerDown(press(0, 0, toggle))
		expect(store.getMapNode("a").collapsed).toBe(true)
		const add = {
			target: {
				closest: (sel) => (sel === "[data-mmadd]" ? { dataset: { mmadd: "b" } } : null),
			},
		}
		controller.pointerDown(press(0, 0, add))
		expect(kids("b")).toHaveLength(1)
	})

	it("a viewer can select but not drag", () => {
		setup(sample(), { readonly: true })
		const a = centre("a")
		const b = centre("b")
		controller.pointerDown(press(a.x, a.y))
		controller.pointerMove(press(b.x, b.y))
		controller.pointerUp(press(b.x, b.y))
		expect(store.state.selection).toEqual(["a"])
		expect(store.getMapNode("a").parentId).toBe("r")
	})
})

describe("drawing and exporting", () => {
	beforeEach(() => setup())

	it("a map takes no room for what is collapsed", async () => {
		const before = controller.maps.value.get("m")
		expect(before.boxes.has("a1")).toBe(true)
		store.select(["a"])
		await run("mm.toggle")
		const after = controller.maps.value.get("m")
		expect(after.boxes.has("a1")).toBe(false)
	})

	it("follows the text being typed", () => {
		const narrow = controller.maps.value.get("m").boxes.get("b").w
		store.state.nodeDraft = { id: "b", text: "A much longer name than before" }
		expect(controller.maps.value.get("m").boxes.get("b").w).toBeGreaterThan(narrow)
	})

	it("exports the map: its text, branches and area", () => {
		const items = collectItems(store, "board")
		expect(isEmpty(items)).toBe(false)
		const area = exportArea(store, items, "board", measure)
		expect(area.w).toBeGreaterThan(100)
		const svg = buildSvg(items, area, { measure })
		expect(svg).toContain("Alpha one")
		expect(svg).toContain('data-mindmap="m"')
		expect((svg.match(/<path/g) || []).length).toBeGreaterThanOrEqual(3) // a branch for each child
	})

	it("a selection export takes only the maps that have a selected node", () => {
		store.select(["a"])
		expect(collectItems(store, "selection").maps).toHaveLength(1)
		store.clearSelection()
		expect(collectItems(store, "selection").maps).toHaveLength(0)
	})
})

describe("two people on one map", () => {
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
		const wire = { on: true }
		const send = (from, to) =>
			from.doc.on(
				"update",
				(u, origin) => wire.on && origin !== "wire" && Y.applyUpdate(to.doc, u, "wire"),
			)
		send(a, b)
		send(b, a)
		wire.mend = () => {
			wire.on = true
			Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)), "wire")
			Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)), "wire")
		}
		return { a, b, wire }
	}
	const ids = (s) => s.mapNodes.value.map((n) => n.id).sort()
	const add = (s, parent, text) => {
		const change = tree.addChild(s.nodesOfMap("m"), parent, text)
		s.applyOps([{ t: "add", list: "mapnodes", items: change.add }], { label: "x" })
		return change.add[0].id
	}

	it("a node added by one appears for the other, and an edit and a move too", async () => {
		const { a, b } = pair()
		const id = add(a.store, "b", "from A")
		await settle()
		expect(ids(b.store)).toContain(id)
		a.store.applyOps(
			[
				{
					t: "update",
					list: "mapnodes",
					changes: [{ id, patch: { text: "renamed", color: "#22C55E" } }],
				},
			],
			{ label: "x" },
		)
		await settle()
		expect(b.store.getMapNode(id)).toMatchObject({ text: "renamed", color: "#22C55E" })
		const move = tree.reparent(a.store.nodesOfMap("m"), id, "a", null)
		a.store.applyOps([{ t: "update", list: "mapnodes", changes: move.update }], { label: "x" })
		await settle()
		expect(b.store.getMapNode(id).parentId).toBe("a")
	})

	it("one deletes a branch while the other adds under it: both settle on the repaired map", async () => {
		const { a, b, wire } = pair()
		wire.on = false
		const removal = tree.removeSubtree(a.store.nodesOfMap("m"), "a")
		a.store.applyOps([{ t: "remove", list: "mapnodes", ids: removal.remove }], { label: "x" })
		add(b.store, "a1", "orphan-to-be")
		wire.mend()
		await settle()
		await settle()
		expect(ids(a.store)).toEqual(ids(b.store))
		expect(ids(a.store)).toEqual(["b", "r"]) // nothing left pointing at a deleted parent
	})

	it("two people adding under the same node both keep their node, in the same order for both", async () => {
		const { a, b, wire } = pair()
		wire.on = false
		const x = add(a.store, "b", "A's")
		const y = add(b.store, "b", "B's")
		wire.mend()
		await settle()
		expect(ids(a.store)).toEqual(ids(b.store))
		expect(ids(a.store)).toEqual(expect.arrayContaining([x, y]))
		const order = (s) => tree.childrenOf(s.nodesOfMap("m"), "b").map((n) => n.id)
		expect(order(a.store)).toEqual(order(b.store))
	})

	it("a new map and its cross-link travel too", async () => {
		const { a, b } = pair()
		const second = createMap({ origin: { x: 2000, y: 0 }, id: "m2" })
		a.store.applyOps(
			[
				{ t: "add", list: "maps", items: [second.map] },
				{ t: "add", list: "mapnodes", items: [second.root] },
			],
			{ label: "x" },
		)
		a.store.applyOps(
			[
				{
					t: "add",
					list: "crosslinks",
					items: [{ id: "cl", mapId: "m", from: "a", to: "b", label: "ties" }],
				},
			],
			{ label: "x" },
		)
		await settle()
		expect(b.store.maps.value.map((m) => m.id).sort()).toEqual(["m", "m2"])
		expect(b.store.crosslinks.value[0]).toMatchObject({ id: "cl", label: "ties" })
	})
})

describe("a layout that is reused still shows the current colours, markers and notes", () => {
	it("redraws a node whose colour changed even though its place did not", () => {
		setup()
		const first = controller.maps.value.get("m")
		const same = first.boxes
		store.applyOps(
			[
				{
					t: "update",
					list: "mapnodes",
					changes: [
						{
							id: "a",
							patch: {
								color: "#8B5CF6",
								note: "n",
							},
						},
					],
				},
			],
			{ label: "x" },
		)
		const after = controller.maps.value.get("m")
		expect(after.boxes).toBe(same) // not laid out again
		const a = after.nodes.find((n) => n.id === "a")
		expect([a.color, a.note]).toEqual(["#8B5CF6", "n"])
	})
})

describe("the outline makes nodes without the map editing them", () => {
	it("noEdit leaves the new node selected but not being typed into", async () => {
		setup()
		store.select(["b"])
		await controller.mapCommand({ name: "mm.sibling", noEdit: true })
		expect(store.state.editingNodeId).toBeNull()
		expect(store.state.selection).toHaveLength(1)
		expect(store.getMapNode(store.state.selection[0]).parentId).toBe("r")
		await controller.mapCommand({ name: "mm.child", noEdit: true })
		expect(store.state.editingNodeId).toBeNull()
	})
})

describe("cross-links", () => {
	it("joins two nodes once, in either direction, with a label, and refuses a node to itself", async () => {
		const { addCrosslink } = await import("./storeOps")
		setup()
		expect(addCrosslink(store, "m", "a1", "b", "see also")).toBe(true)
		expect(addCrosslink(store, "m", "b", "a1", "again")).toBe(false)
		expect(addCrosslink(store, "m", "a", "a")).toBe(false)
		expect(store.crosslinksOfMap("m")).toHaveLength(1)
		expect(store.history.undoStack).toHaveLength(1)
		store.undo()
		expect(store.crosslinksOfMap("m")).toHaveLength(0)
	})

	it("is drawn dotted with its label, between the two nodes", () => {
		setup()
		store.applyOps(
			[
				{
					t: "add",
					list: "crosslinks",
					items: [{ id: "l", mapId: "m", from: "a1", to: "b", label: "see also" }],
				},
			],
			{ label: "x" },
		)
		const svg = buildSvg(
			collectItems(store, "board"),
			exportArea(store, collectItems(store, "board"), "board", measure),
			{ measure },
		)
		expect(svg).toContain("see also")
		expect(svg).toContain('stroke-dasharray="2 5"')
	})
})

describe("a marker takes room at the left of the text", () => {
	it("makes the node wider, and the layout is laid out again when a marker appears", () => {
		setup()
		const plain = controller.maps.value.get("m").boxes.get("a").w
		store.applyOps(
			[
				{
					t: "update",
					list: "mapnodes",
					changes: [{ id: "a", patch: { marker: { icon: "star", dot: null } } }],
				},
			],
			{ label: "x" },
		)
		expect(controller.maps.value.get("m").boxes.get("a").w).toBe(plain + 22)
	})
})

describe("font size", () => {
	beforeEach(() => setup())
	const box = (id) => controller.maps.value.get("m").boxes.get(id)

	it("a node's own size makes its box bigger, and Default puts it back", () => {
		const small = box("a")
		store.applyOps(
			[{ t: "update", list: "mapnodes", changes: [{ id: "a", patch: { fontSize: 32 } }] }],
			{ label: "x" },
		)
		expect(box("a").w).toBeGreaterThan(small.w + 30)
		expect(box("a").h).toBeGreaterThan(small.h)
		expect(box("b").w).toBe(box("b").w) // the others are not touched
		store.applyOps(
			[{ t: "update", list: "mapnodes", changes: [{ id: "a", patch: { fontSize: null } }] }],
			{ label: "x" },
		)
		expect(box("a").w).toBe(small.w)
	})

	it("the setters clean the value, and one call can set the whole map", () => {
		const nodes = store.nodesOfMap("m")
		expect(tree.setFontSize(nodes, "a", 5)).toBeNull() // below 8 cleans to no size, and a had none
		expect(tree.setFontSize(nodes, "a", "24").update[0].patch.fontSize).toBe(24)
		expect(tree.setFontSize(nodes, "a", 500)).toBeNull() // out of range cleans to "no size": nothing changes
		expect(tree.cleanFontSize(96)).toBe(96)
		expect(tree.cleanFontSize(97)).toBeNull()
		expect(tree.cleanFontSize("")).toBeNull()
		const all = tree.setAllFontSize(nodes, 20)
		expect(all.update).toHaveLength(4)
		expect(tree.setAllFontSize(tree.applyChange(nodes, all), 20)).toBeNull()
		expect(tree.setAllFontSize(tree.applyChange(nodes, all), null).update).toHaveLength(4)
	})

	it("is drawn at that size, kept through a save, and refused out of range", () => {
		store.applyOps(
			[{ t: "update", list: "mapnodes", changes: [{ id: "a", patch: { fontSize: 28 } }] }],
			{ label: "x" },
		)
		const items = collectItems(store, "board")
		const svg = buildSvg(items, exportArea(store, items, "board", measure), { measure })
		expect(svg).toContain('font-size="28"')
		const saved = parseDocument(JSON.parse(JSON.stringify(store.snapshot()))).document
		expect(saved.mindmaps[0].nodes.find((n) => n.id === "a").fontSize).toBe(28)
		const wild = JSON.parse(JSON.stringify(store.snapshot()))
		wild.mindmaps[0].nodes.find((n) => n.id === "a").fontSize = 5000
		expect(
			parseDocument(wild).document.mindmaps[0].nodes.find((n) => n.id === "a").fontSize,
		).toBeNull()
	})
})
