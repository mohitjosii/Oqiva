<script setup>
// The board's name in the editor's top bar. Click to rename: Enter or leaving the field saves,
// Escape puts the old name back, an empty name is ignored.
import { nextTick, ref } from "vue"

const props = defineProps({
	title: { type: String, required: true },
	editable: { type: Boolean, default: false },
})
const emit = defineEmits(["rename"])

const draft = ref(null) // null when not editing
const input = ref(null)

async function start() {
	if (!props.editable) return
	draft.value = props.title
	await nextTick()
	input.value?.select()
}

function commit() {
	if (draft.value === null) return
	const name = draft.value.trim()
	draft.value = null
	if (name && name !== props.title) emit("rename", name)
}
</script>

<template>
	<input
		v-if="draft !== null"
		ref="input"
		v-model="draft"
		class="w-72 max-w-full rounded border border-outline-gray-3 bg-surface-white px-2 py-1 text-base font-semibold text-ink-gray-9 focus:outline-none focus:ring-2 focus:ring-outline-gray-4"
		maxlength="120"
		aria-label="Board name"
		@keydown.enter.prevent="commit"
		@keydown.esc.prevent="draft = null"
		@blur="commit"
	/>
	<button
		v-else-if="editable"
		type="button"
		class="max-w-xs truncate rounded px-2 py-1 text-left text-base font-semibold text-ink-gray-9 hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-4"
		title="Click to rename"
		@click="start"
	>
		{{ title }}
	</button>
	<h1 v-else class="max-w-xs truncate px-2 py-1 text-base font-semibold text-ink-gray-9">
		{{ title }}
	</h1>
</template>
