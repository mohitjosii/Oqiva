<script setup>
// Edits a section's name: a small text field where the name is drawn, above the frame's top-left
// corner. Enter or clicking away keeps the name, Escape throws the change away.
import { computed, nextTick, ref, watch } from "vue"
import { toScreen } from "../geometry/viewport"

const props = defineProps({ store: { type: Object, required: true } })

const NAME_LIMIT = 200
const input = ref(null)
const value = ref("")
const discard = ref(false)
const frame = computed(() => {
	const object = props.store.getObject(props.store.state.editingId)
	return object?.kind === "frame" ? object : null
})
const position = computed(() => {
	if (!frame.value) return {}
	const scale = props.store.state.viewport.scale
	const p = toScreen(props.store.state.viewport, { x: frame.value.x, y: frame.value.y })
	return {
		left: `${p.x}px`,
		top: `${p.y - 34}px`,
		width: `${Math.min(360, Math.max(160, frame.value.w * scale))}px`,
	}
})

let editing = null
function finish() {
	if (!editing) return
	const id = editing
	editing = null
	if (discard.value) return
	const name = value.value.trim().slice(0, NAME_LIMIT)
	const current = props.store.getObject(id)
	if (!current || !name || current.name === name) return // an empty name keeps the old one
	props.store.updateItems([{ id, patch: { name } }], { label: "Rename section" })
}

watch(
	() => frame.value?.id,
	(id, previous) => {
		if (previous) finish()
		if (!id) return
		editing = id
		discard.value = false
		value.value = frame.value.name || ""
		nextTick(() => {
			input.value?.focus()
			input.value?.select()
		})
	},
	{ immediate: true },
)

function cancel() {
	discard.value = true
	props.store.state.editingId = null
}
function done() {
	props.store.state.editingId = null
}
</script>

<template>
	<div
		v-if="frame"
		class="pointer-events-none absolute inset-0"
		data-testid="frame-name-editor"
		data-print="hide"
	>
		<input
			ref="input"
			v-model="value"
			type="text"
			:maxlength="NAME_LIMIT"
			aria-label="Section name"
			class="pointer-events-auto absolute rounded-md border border-outline-gray-3 bg-surface-white px-2 py-1 text-sm font-semibold text-ink-gray-9 shadow focus:outline-none focus:ring-2 focus:ring-outline-gray-5"
			:style="position"
			data-testid="frame-name-input"
			@pointerdown.stop
			@pointerup.stop
			@dblclick.stop
			@keydown.enter.stop.prevent="done"
			@keydown.esc.stop.prevent="cancel"
			@blur="done"
		/>
	</div>
</template>
