<script setup>
// Edits the text of a flowchart step, or the label of an arrow: a text field right over it. Enter
// keeps the text, Shift+Enter starts a new line, Escape or clicking away keeps it too. A step made a
// moment ago and left empty is thrown away (it keeps its default wording only if never typed in).
import { computed, nextTick, ref, watch } from "vue"
import { toScreen } from "../geometry/viewport"
import { FLOW_LABEL_LIMIT, FLOW_TEXT_LIMIT, fontSizeOf } from "../modes/flowchart/model"
import { setEdgeLabel, setNodeText } from "../modes/flowchart/ops"
import { applyFlowChange } from "../modes/flowchart/storeOps"

const props = defineProps({
	store: { type: Object, required: true },
	controller: { type: Object, required: true },
})

const input = ref(null)
const value = ref("")
let session = null // {id, isEdge, fresh, original}

const id = computed(() => props.store.state.editingFlowId)
const node = computed(() => props.store.getFlowNode(id.value))
const edge = computed(() => (node.value ? null : props.store.getFlowEdge(id.value)))
const layout = computed(() => {
	const chartId = (node.value || edge.value)?.chartId
	return chartId ? props.controller.flows.value.get(chartId) : null
})

const style = computed(() => {
	const l = layout.value
	if (!l) return {}
	const { viewport } = props.store.state
	const s = viewport.scale
	if (node.value) {
		const size = l.sizes.get(node.value.id)
		const p = toScreen(viewport, { x: node.value.x - size.w / 2, y: node.value.y - size.h / 2 })
		return {
			left: `${p.x}px`,
			top: `${p.y}px`,
			width: `${size.w * s}px`,
			minHeight: `${size.h * s}px`,
			fontSize: `${fontSizeOf(node.value) * s}px`,
			padding: `${8 * s}px ${12 * s}px`,
			borderRadius: `${10 * s}px`,
			textAlign: "center",
		}
	}
	const route = l.routes.get(edge.value.id)
	if (!route) return {}
	const width = 140
	const p = toScreen(viewport, { x: route.label.x - width / 2, y: route.label.y - 12 })
	return {
		left: `${p.x}px`,
		top: `${p.y}px`,
		width: `${width * s}px`,
		minHeight: `${24 * s}px`,
		fontSize: `${13 * s}px`,
		padding: `${2 * s}px ${6 * s}px`,
		borderRadius: `${12 * s}px`,
		textAlign: "center",
	}
})

function resize() {
	const el = input.value
	if (!el) return
	el.style.height = "auto"
	el.style.height = `${el.scrollHeight}px`
}

function end() {
	props.store.state.editingFlowId = null
	props.store.state.editingFlowNew = false
}

function chartParts(chartId) {
	return { nodes: props.store.nodesOfChart(chartId), edges: props.store.edgesOfChart(chartId) }
}

// Saves what was typed. A new step left empty is thrown away.
function commit() {
	if (!session) return
	const { id: target, isEdge, fresh, original } = session
	session = null
	if (isEdge) {
		const current = props.store.getFlowEdge(target)
		if (!current) return
		const text = value.value.trim().slice(0, FLOW_LABEL_LIMIT)
		if (text === original) return
		const { edges } = chartParts(current.chartId)
		applyFlowChange(props.store, current.chartId, setEdgeLabel(edges, target, text), {
			label: "Edit label",
			select: target,
			selectUndo: [target],
		})
		return
	}
	const current = props.store.getFlowNode(target)
	if (!current) return
	const text = value.value.slice(0, FLOW_TEXT_LIMIT)
	if (fresh && !text.trim() && current.type !== "junction") {
		// left empty: the step keeps its default wording instead of being thrown away
		return
	}
	if (text === original) return
	const { nodes } = chartParts(current.chartId)
	applyFlowChange(props.store, current.chartId, setNodeText(nodes, target, text), {
		label: "Edit step",
		select: target,
		selectUndo: [target],
	})
}

watch(
	id,
	(next, previous) => {
		if (previous && session) commit()
		if (!next || props.store.state.readonly) return
		const n = props.store.getFlowNode(next)
		const e = n ? null : props.store.getFlowEdge(next)
		if (!n && !e) return
		session = {
			id: next,
			isEdge: Boolean(e),
			fresh: props.store.state.editingFlowNew,
			original: n ? n.text : e.label,
		}
		value.value = session.original
		nextTick(() => {
			resize()
			input.value?.focus()
			input.value?.select()
		})
	},
	{ immediate: true },
)

function keep() {
	commit()
	end()
}
</script>

<template>
	<div
		v-if="(node || edge) && layout"
		class="pointer-events-none absolute inset-0"
		data-testid="flow-editor"
	>
		<textarea
			ref="input"
			v-model="value"
			rows="1"
			class="pointer-events-auto absolute resize-none overflow-hidden border-2 border-blue-600 bg-white leading-[1.35] text-ink-gray-9 shadow-lg focus:outline-none"
			:style="style"
			:maxlength="edge ? FLOW_LABEL_LIMIT : FLOW_TEXT_LIMIT"
			:aria-label="edge ? 'Arrow label' : 'Step text'"
			data-testid="flow-input"
			@input="resize"
			@pointerdown.stop
			@pointerup.stop
			@dblclick.stop
			@keydown.enter.exact.stop.prevent="keep"
			@keydown.esc.stop.prevent="keep"
			@keydown.stop
			@blur="keep"
		/>
	</div>
</template>
