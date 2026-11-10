// Builds the template files in oqiva/seed/templates/ from scripts/template-specs.mjs, using the
// engine's own factories so a template is an ordinary Oqiva document. Run with:
//   npx vite-node scripts/build-templates.mjs
// The output is deterministic (fixed ids), so running it again changes nothing.
import fs from "node:fs"
import path from "node:path"
import {
	createConnector,
	createFrame,
	createNote,
	createObject,
	createTable,
} from "../src/engine/model/factories"
import { presetByKey, presetObject } from "../src/engine/model/library"
import {
	createDocument,
	NOTE_COLORS,
	parseDocument,
	sanitizeText,
} from "../src/engine/model/schema"
import { setCellFill, setCellText } from "../src/engine/store/tableOps"
import { nestMindmaps } from "../src/engine/modes/mindmap/document"
import { createMap } from "../src/engine/modes/mindmap/model"
import { treeToChange } from "../src/engine/modes/mindmap/paste"
import { COL, ROW, TEMPLATES } from "./template-specs.mjs"

const OUT = path.resolve("../oqiva/seed/templates")
const THEME = "ocean"
const TEXT_SIZES = { s: 14, m: 18, l: 26, xl: 36 }
const plain = (content, over = {}) =>
	sanitizeText(
		{
			align: "left",
			size: 18,
			color: "#1E293B",
			paragraphs: content.split("\n").map((t) => ({ runs: t ? [{ t }] : [] })),
			...over,
		},
		THEME,
	)

function build(spec) {
	const objects = []
	const lines = []
	const centres = new Map()
	let z = 1
	const add = (object, id) => {
		object.id = id
		object.z = z++
		objects.push(object)
		centres.set(id, { x: object.x + object.w / 2, y: object.y + object.h / 2 })
		return object
	}
	;(spec.frames || []).forEach((f, i) =>
		add(createFrame({ x: f.x, y: f.y, w: f.w, h: f.h }, { name: f.name, z: 0 }), `frame-${i + 1}`),
	)
	for (const node of spec.nodes || []) {
		const preset = presetByKey(node.preset)
		if (!preset) throw new Error(`${spec.slug}: unknown preset ${node.preset}`)
		const sized = {
			...preset,
			w: node.w ?? preset.w,
			h: node.h ?? preset.h,
			color: node.color ?? preset.color,
			text: node.label ?? preset.label,
		}
		const x = node.x ?? node.col * COL
		const y = node.y ?? node.row * ROW
		add(presetObject(sized, { x, y }, { theme: THEME, z: 0 }), node.id)
	}
	for (const t of spec.tables || []) {
		let table = createTable({
			rows: t.rows.length,
			cols: 2,
			center: { x: 0, y: 0 },
			theme: THEME,
			z: 0,
			cell: { w: 150, h: 36 },
		})
		const grid = table.table
		let next = grid
		t.rows.forEach(([a, b], r) => {
			if (a) next = setCellText(next, r, 0, plain(a, { size: 15, align: "left" }))
			if (b) next = setCellText(next, r, 1, plain(b, { size: 15, align: "left", color: "#64748B" }))
			if (r === 0) {
				next = setCellFill(next, 0, 0, "#DBEAFE")
				next = setCellFill(next, 0, 1, "#DBEAFE")
			}
		})
		table = { ...table, table: next, x: t.x, y: t.y }
		add(table, t.id)
	}
	for (const n of spec.notes || []) {
		const color = NOTE_COLORS.find((c) => c.name === n.color) || NOTE_COLORS[0]
		const note = createNote({ x: n.x, y: n.y, w: n.w ?? 200, h: n.h ?? 140 }, { color, z: 0 })
		if (n.text) note.text.paragraphs = [{ runs: [{ t: n.text }] }]
		add(note, n.id)
	}
	for (const t of spec.texts || []) {
		const size = TEXT_SIZES[t.size] || 18
		const box = createObject(
			"text",
			{ x: t.x, y: t.y, w: 520, h: Math.round(size * 1.6) },
			{ theme: THEME, z: 0, text: plain(t.text, { size }) },
		)
		add(box, t.id)
	}
	;(spec.edges || []).forEach((edge, i) => {
		const a = centres.get(edge.from)
		const b = centres.get(edge.to)
		if (!a || !b) throw new Error(`${spec.slug}: line ${edge.from} to ${edge.to} has no shape`)
		const dx = b.x - a.x
		const dy = b.y - a.y
		const horizontal = Math.abs(dx) >= Math.abs(dy) * 0.6
		const [from, to] = edge.anchors
			? edge.anchors
			: horizontal
				? dx >= 0
					? ["e", "w"]
					: ["w", "e"]
				: dy >= 0
					? ["s", "n"]
					: ["n", "s"]
		const aligned = !edge.anchors && (Math.abs(dx) < 8 || Math.abs(dy) < 8)
		const line = createConnector({
			from: { objectId: edge.from, anchor: from },
			to: { objectId: edge.to, anchor: to },
			geometry: aligned ? "straight" : "elbow",
			arrow: true,
			theme: THEME,
			z: i + 1,
		})
		line.id = `line-${i + 1}`
		if (edge.label) line.label = { text: edge.label }
		if (edge.dashed) line.style = { ...line.style, dash: "dashed" }
		lines.push(line)
	})
	// Mind maps: a nested array ["Root", ["Child", ["Grandchild"]], ...] becomes a tree with fixed ids.
	const mapRecords = []
	const mapNodes = []
	;(spec.maps || []).forEach((entry, m) => {
		const { map, root } = createMap({ origin: entry.origin, id: `${spec.slug}-map${m + 1}` })
		const toTree = ([text, ...children]) => ({ text, children: children.map(toTree) })
		const top = toTree(entry.tree)
		const change = treeToChange({
			mapId: map.id,
			parentId: root.id,
			startOrder: 0,
			tree: top.children,
		})
		const nodes = [{ ...root, text: top.text }, ...change.add]
		const renamed = new Map(nodes.map((n, i) => [n.id, `${map.id}-n${i}`]))
		for (const node of nodes)
			mapNodes.push({
				...node,
				id: renamed.get(node.id),
				parentId: node.parentId ? renamed.get(node.parentId) : null,
			})
		mapRecords.push({ ...map, rootId: renamed.get(root.id) })
	})
	const document = {
		...createDocument({ theme: THEME }),
		objects,
		connectors: lines,
		mindmaps: nestMindmaps(mapRecords, mapNodes, []),
	}
	const { document: clean, issues } = parseDocument(JSON.parse(JSON.stringify(document)))
	if (issues.length) throw new Error(`${spec.slug}: ${issues.join(", ")}`)
	const ids = new Set(clean.objects.map((o) => o.id))
	if (ids.size !== objects.length) throw new Error(`${spec.slug}: duplicate ids`)
	return clean
}

fs.mkdirSync(OUT, { recursive: true })
for (const spec of TEMPLATES) {
	const document = build(spec)
	const file = {
		slug: spec.slug,
		name: spec.name,
		description: spec.description,
		category: spec.category,
		tags: spec.tags,
		sort_order: spec.sort_order,
		document,
	}
	fs.writeFileSync(path.join(OUT, `${spec.slug}.json`), `${JSON.stringify(file, null, "\t")}\n`)
	console.log(
		`${spec.slug}: ${document.objects.length} objects, ${document.connectors.length} lines, ${document.mindmaps.length} maps`,
	)
}
