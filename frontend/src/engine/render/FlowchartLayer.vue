<script setup>
// Every flowchart on the board, drawn from the layouts the controller keeps. A chart is redrawn only
// when its own layout, the selection around it, or what is being done to it changes.
import { computed } from "vue"
import { rectsIntersect } from "../geometry/bounds"
import { flowScene } from "./flowchartScene"
import { layoutBounds } from "../modes/flowchart/layouts"
import { stepNumbers } from "../modes/flowchart/numbering"
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
const measure = (text, size) => measureText(text, { size })

const scenes = computed(() => {
	void props.fonts
	const layouts = props.controller.flows.value
	const selected = new Set(state.value.selection)
	const drag = state.value.flowDrag
	const out = []
	for (const layout of layouts.values()) {
		if (!layout.nodes.length) continue
		const b = layoutBounds(layout)
		if (!b) continue
		if (
			!rectsIntersect(
				{ x: b.x - 60, y: b.y - 60, w: b.w + 120, h: b.h + 120 },
				props.cullArea,
			)
		)
			continue
		out.push({
			id: layout.chart.id,
			node: flowScene(layout, {
				measure,
				detail: props.detail,
				selected,
				editingId: state.value.editingFlowId,
				background: props.background,
				numbers: layout.chart.numbered
					? stepNumbers(layout.chart, layout.nodes, layout.edges)
					: null,
				drag: drag && drag.chartId === layout.chart.id ? drag : null,
				spliceEdge: drag && drag.chartId === layout.chart.id ? drag.spliceEdge : null,
				interactive: !state.value.readonly && state.value.tool === "select",
			}),
		})
	}
	return out
})
</script>

<template>
	<g :transform="transform" data-testid="flowcharts">
		<SvgTree v-for="scene in scenes" :key="scene.id" :node="scene.node" />
	</g>
</template>
