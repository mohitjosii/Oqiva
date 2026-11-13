// Puts a described diagram on the board. Each kind is one ``store.applyOps`` call, so one Undo takes
// the whole diagram away and a peer sees one ordinary edit (the same rule as restoring a version).
//
// A diagram is drawn at the middle of what the person is looking at. If that would land on top of
// what is already on the board, it goes in free space to the right of it instead, and the view is
// moved to show it.

import { addChartOps } from "../modes/flowchart/storeOps"
import { layoutMap } from "../modes/mindmap/layout"
import { buildArchitecture, buildFlowchart, buildMindMap, cleanSpec } from "./diagram"

const GAP = 100
const MARGIN = 24

const overlaps = (a, b) =>
	a.x < b.x + b.w + MARGIN &&
	a.x + a.w + MARGIN > b.x &&
	a.y < b.y + b.h + MARGIN &&
	a.y + a.h + MARGIN > b.y

// Builds at ``origin``, and again beside the existing content when the first try would cover it.
function placed(build, origin, content) {
	const first = build(origin)
	if (!first || !content || !overlaps(first.box, content)) return first
	return build({
		x: origin.x + (content.x + content.w + GAP - first.box.x),
		y: origin.y + (content.y - first.box.y),
	})
}

// ``host``: {origin, measure(text, size), content?() -> the box round what is on the board,
// reveal?(rect)}. Returns true when the diagram was added.
export function insertDiagram(store, spec, kind, host) {
	if (store.state.readonly) return false
	const clean = cleanSpec(spec)
	if (!clean.nodes.length) return false
	const { origin, measure } = host
	const content = host.content?.() ?? null

	if (kind === "mindmap") {
		const built = placed(
			(at) => {
				const made = buildMindMap(clean, { origin: at })
				if (!made) return null
				return { ...made, box: layoutMap(made.map, made.nodes, measure).bounds }
			},
			origin,
			content,
		)
		if (!built) return false
		const ops = [
			{ t: "add", list: "maps", items: [built.map] },
			{ t: "add", list: "mapnodes", items: built.nodes },
		]
		if (built.links.length) ops.push({ t: "add", list: "crosslinks", items: built.links })
		const ok = store.applyOps(ops, {
			label: "Add AI mind map",
			select: [built.selectId],
			selectUndo: [],
		})
		if (ok) host.reveal?.(built.box)
		return ok
	}

	if (kind === "architecture") {
		const z = store.nextZ()
		const theme = store.theme.value.preset
		const built = placed(
			(at) => buildArchitecture(clean, { origin: at, measure, theme, z }),
			origin,
			content,
		)
		if (!built) return false
		const ok = store.applyOps(
			[
				{ t: "add", list: "objects", items: [...built.frames, ...built.objects] },
				{ t: "add", list: "connectors", items: built.connectors },
			],
			{
				label: "Add AI architecture diagram",
				select: built.objects.map((o) => o.id),
				selectUndo: [],
			},
		)
		if (ok) host.reveal?.(built.box)
		return ok
	}

	const built = placed((at) => buildFlowchart(clean, { origin: at, measure }), origin, content)
	if (!built) return false
	const ok = store.applyOps(
		addChartOps(built.chart, { add: { nodes: built.nodes, edges: built.edges } }),
		{
			label: "Add AI flowchart",
			select: [built.selectId],
			selectUndo: [],
		},
	)
	if (ok) host.reveal?.(built.box)
	return ok
}
