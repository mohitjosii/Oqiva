<script setup>
// A faint hint in the middle of a board with nothing on it. It never takes a click, and goes the moment
// anything is added.
import { computed } from "vue"

const props = defineProps({ store: { type: Object, required: true } })

const empty = computed(
	() =>
		!props.store.objects.value.length &&
		!props.store.connectors.value.length &&
		!props.store.maps.value.length &&
		!props.store.charts.value.length,
)
const editor = computed(() => !props.store.state.readonly)
const drawing = computed(() =>
	["pen", "highlighter", "eraser", "laser"].includes(props.store.state.tool),
)
</script>

<template>
	<div
		v-if="empty && !drawing"
		class="pointer-events-none absolute inset-0 flex items-center justify-center"
		data-testid="empty-hint"
		data-print="hide"
	>
		<div class="max-w-sm text-center text-ink-gray-4">
			<p class="text-base font-medium">
				{{ editor ? "A blank board" : "This board is empty" }}
			</p>
			<p v-if="editor" class="mt-1 text-sm">
				Double-click to add something, draw with the pen (P), or start from a template.
			</p>
		</div>
	</div>
</template>
