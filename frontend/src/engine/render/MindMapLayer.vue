<script setup>
// Every mind map on the board, drawn from the layouts the controller keeps. A map is redrawn only
// when its own layout, the selection around it, or what is being done to it changes.
import { computed } from "vue"
import { rectsIntersect } from "../geometry/bounds"
import { mapScene } from "./mindmapScene"
import { sized } from "../modes/mindmap/layouts"
import { measureText } from "../text/measure"
import SvgTree from "./SvgTree"

const props = defineProps({
	store: { type: Object, required: true },
	controller: { type: Object, required: true },
	transform: { type: String, required: true },
	cullArea: { type: Object, required: true },
	detail: { type: Boolean, default: true },
	background: { type: String, default: "#ffffff" },
	fonts: { type: Number, default: 0 },
})

const state = computed(() => props.store.state)

// With focus mode on, only the selected node's branch (it, what grows from it, and the path back to
// the root) stays at full strength.
const focus = computed(() => {
	if (!state.value.focusBranch) return null
	const [node] = props.store.selectedNodes()
	if (!node) return null
	const nodes = props.store.nodesOfMap(node.mapId)
	const ids = new Set()
	const kids = new Map()
	const byId = new Map(nodes.map((n) => [n.id, n]))
	for (const n of nodes)
		if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) || []), n.id])
	const stack = [node.id]
	while (stack.length) {
		const id = stack.pop()
		ids.add(id)
		stack.push(...(kids.get(id) || []))
	}
	for (let n = byId.get(node.parentId); n; n = byId.get(n.parentId)) ids.add(n.id)
	return ids
})

const scenes = computed(() => {
	void props.fonts
	const layouts = props.controller.maps.value
	const selected = new Set(state.value.selection)
	const drag = state.value.mapDrag
	const out = []
	for (const layout of layouts.values()) {
		const b = layout.bounds
		const offset = drag && drag.mapId === layout.map.id ? drag : null
		const area = offset
			? {
					...props.cullArea,
					x: props.cullArea.x - offset.dx,
					y: props.cullArea.y - offset.dy,
				}
			: props.cullArea
		if (!rectsIntersect({ x: b.x - 40, y: b.y - 40, w: b.w + 80, h: b.h + 80 }, area)) continue
		out.push({
			id: layout.map.id,
			node: mapScene(layout, props.store.crosslinksOfMap(layout.map.id), {
				measure: sized(measureText),
				detail: props.detail,
				selected,
				editingId: state.value.editingNodeId,
				focus: focus.value,
				background: props.background,
				drag: drag && drag.nodeId ? drag : null,
				offset,
				interactive: !state.value.readonly && state.value.tool === "select",
			}),
		})
	}
	return out
})
</script>

<template>
	<g :transform="transform" data-testid="mindmaps">
		<SvgTree v-for="scene in scenes" :key="scene.id" :node="scene.node" />
	</g>
</template>
