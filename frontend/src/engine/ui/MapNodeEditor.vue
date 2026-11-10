<script setup>
// Edits the text of a mind map node: a text field right over the node. The map follows the typing
// (the node grows with its text). Enter keeps the text and adds a sibling, Tab keeps it and adds a
// child, Shift+Enter starts a new line, Escape or clicking away just keeps the text. A node made a
// moment ago that is left empty is thrown away.
import { computed, nextTick, ref, watch } from "vue"
import { toScreen } from "../geometry/viewport"
import { applyChange } from "../modes/mindmap/storeOps"
import { NODE_TEXT_LIMIT } from "../modes/mindmap/model"
import { setText } from "../modes/mindmap/tree"

const props = defineProps({
	store: { type: Object, required: true },
	controller: { type: Object, required: true },
})

const input = ref(null)
const value = ref("")
let session = null // {id, fresh, original}

const node = computed(() => props.store.getMapNode(props.store.state.editingNodeId))
const box = computed(() => {
	const n = node.value
	return n ? props.controller.maps.value.get(n.mapId)?.boxes.get(n.id) || null : null
})
const style = computed(() => {
	if (!box.value) return {}
	const { viewport } = props.store.state
	const p = toScreen(viewport, { x: box.value.x, y: box.value.y })
	const s = viewport.scale
	const depth = box.value.depth
	return {
		left: `${p.x}px`,
		top: `${p.y}px`,
		width: `${Math.max(box.value.w, 120) * s}px`,
		minHeight: `${box.value.h * s}px`,
		fontSize: `${(node.value.fontSize || (depth === 0 ? 20 : 16)) * s}px`,
		padding: `${8 * s}px ${14 * s}px`,
		borderRadius: `${(depth === 0 ? 14 : 10) * s}px`,
	}
})

function resize() {
	const el = input.value
	if (!el) return
	el.style.height = "auto"
	el.style.height = `${el.scrollHeight}px`
}

function typed() {
	props.store.state.nodeDraft = { id: session.id, text: value.value }
	resize()
}

function end() {
	props.store.state.editingNodeId = null
	props.store.state.nodeDraft = null
	props.store.state.editingNodeNew = false
}

// Saves what was typed. Returns the node's id (still there), or null if it was thrown away.
function commit() {
	if (!session) return null
	const { id, fresh, original } = session
	session = null
	const current = props.store.getMapNode(id)
	const text = value.value.slice(0, NODE_TEXT_LIMIT)
	props.store.state.nodeDraft = null
	if (!current) return null
	if (fresh && !text.trim()) {
		props.store.discardLastStep() // a node made a moment ago and left empty
		return null
	}
	if (text !== original) {
		applyChange(
			props.store,
			current.mapId,
			setText(props.store.nodesOfMap(current.mapId), id, text),
			{
				label: "Edit node",
				select: id,
				selectUndo: [id],
			},
		)
	}
	return id
}

watch(
	() => props.store.state.editingNodeId,
	(id, previous) => {
		if (previous && session) commit()
		if (!id || !node.value || props.store.state.readonly) return
		session = { id, fresh: props.store.state.editingNodeNew, original: node.value.text }
		value.value = node.value.text
		nextTick(() => {
			resize()
			input.value?.focus()
			input.value?.select()
		})
	},
	{ immediate: true },
)

async function keep(then) {
	const id = commit()
	end()
	if (id && then) {
		props.store.select([id])
		await props.controller.mapCommand({ name: then })
	}
}
</script>

<template>
	<div
		v-if="node && box"
		class="pointer-events-none absolute inset-0"
		data-testid="map-node-editor"
	>
		<textarea
			ref="input"
			v-model="value"
			rows="1"
			class="pointer-events-auto absolute resize-none overflow-hidden border-2 border-blue-600 bg-white text-left leading-[1.35] text-ink-gray-9 shadow-lg focus:outline-none"
			:style="style"
			:maxlength="NODE_TEXT_LIMIT"
			aria-label="Node text"
			data-testid="map-node-input"
			@input="typed"
			@pointerdown.stop
			@pointerup.stop
			@dblclick.stop
			@keydown.enter.exact.stop.prevent="keep('mm.sibling')"
			@keydown.tab.exact.stop.prevent="keep('mm.child')"
			@keydown.tab.shift.stop.prevent="keep('mm.promote')"
			@keydown.esc.stop.prevent="keep(null)"
			@keydown.stop
			@blur="keep(null)"
		/>
	</div>
</template>
