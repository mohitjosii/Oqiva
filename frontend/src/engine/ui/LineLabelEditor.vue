<script setup>
// Edits a line's label: a small text field over the middle of the line. Labels are plain
// text (up to 200 characters), so a field is enough; Enter or clicking away keeps the text,
// Escape throws the change away.
import { computed, nextTick, ref, watch } from "vue"
import { toScreen } from "../geometry/viewport"

const props = defineProps({
	store: { type: Object, required: true },
	paths: { type: Object, required: true }, // a ref to every line's path
})

const input = ref(null)
const value = ref("")
const discard = ref(false)
const connector = computed(() => props.store.getConnector(props.store.state.editingId))
const path = computed(() => (connector.value ? props.paths.value.get(connector.value.id) : null))
const position = computed(() => {
	if (!path.value) return {}
	const p = toScreen(props.store.state.viewport, path.value.mid)
	return { left: `${p.x}px`, top: `${p.y}px` }
})

let editing = null
function finish() {
	if (!editing) return
	const id = editing
	editing = null
	if (discard.value) return
	const text = value.value.trim().slice(0, 200)
	const current = props.store.getConnector(id)
	if (!current || (current.label?.text || "") === text) return
	props.store.updateConnectors([{ id, patch: { label: text ? { text } : null } }], {
		label: "Edit line label",
	})
}

watch(
	() => connector.value?.id,
	(id, previous) => {
		if (previous) finish()
		if (!id) return
		editing = id
		discard.value = false
		value.value = connector.value.label?.text || ""
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
		v-if="connector && path"
		class="pointer-events-none absolute inset-0"
		data-testid="line-label-editor"
	>
		<input
			ref="input"
			v-model="value"
			type="text"
			maxlength="200"
			aria-label="Line label"
			class="pointer-events-auto absolute w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-outline-gray-3 bg-surface-white px-3 py-1 text-center text-sm text-ink-gray-9 shadow focus:outline-none focus:ring-2 focus:ring-outline-gray-5"
			:style="position"
			@pointerdown.stop
			@pointerup.stop
			@dblclick.stop
			@keydown.enter.stop.prevent="done"
			@keydown.esc.stop.prevent="cancel"
		/>
	</div>
</template>
