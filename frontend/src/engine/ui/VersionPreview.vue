<script setup>
// A look at an old version, drawn the same way as the board but on its own, read-only copy, so
// nothing on the real board changes until Restore is pressed.
import { Button } from "frappe-ui"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { CanvasController } from "../interaction/controller"
import { fitView } from "../interaction/view"
import { createStore } from "../store/createStore"
import { measureText } from "../text/measure"
import BoardCanvas from "../render/BoardCanvas.vue"

const props = defineProps({
	document: { type: Object, required: true }, // a parsed document
	title: { type: String, required: true },
	canRestore: { type: Boolean, default: true },
	busy: { type: Boolean, default: false },
})
const emit = defineEmits(["close", "restore"])

const store = createStore(props.document, { readonly: true })
const controller = new CanvasController(store, { measure: measureText })
const root = ref(null)
const stop = watch(
	() => store.state.size.width,
	(width) => {
		if (!width) return
		fitView(store)
		stop()
	},
)
const objectCount = computed(() => store.objects.value.length + store.connectors.value.length)

function onKey(event) {
	if (event.key === "Escape") {
		event.stopPropagation()
		emit("close")
	}
}
onMounted(() => {
	window.addEventListener("keydown", onKey, true)
	root.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener("keydown", onKey, true))
</script>

<template>
	<!-- Marked as an open layer so the editor behind leaves the keyboard alone. -->
	<div
		ref="root"
		class="absolute inset-0 z-30 flex flex-col bg-black/40 p-4 sm:p-8"
		role="dialog"
		aria-modal="true"
		:aria-label="`Preview: ${title}`"
		tabindex="-1"
		data-dismissable-layer
		data-state="open"
		data-testid="version-preview"
		data-print="hide"
		@pointerdown.stop
		@dblclick.stop
		@wheel.stop
	>
		<div
			class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-outline-gray-2 bg-surface-white shadow-2xl"
		>
			<header class="flex items-center gap-2 border-b border-outline-gray-2 px-4 py-2">
				<div class="min-w-0 flex-1">
					<h2 class="truncate text-sm font-medium text-ink-gray-9">{{ title }}</h2>
					<p class="text-xs text-ink-gray-5">
						A read-only look: {{ objectCount }}
						{{ objectCount === 1 ? "object" : "objects" }}. The board has not changed.
					</p>
				</div>
				<Button
					v-if="canRestore"
					variant="solid"
					label="Restore this version"
					:loading="busy"
					data-testid="preview-restore"
					@click="emit('restore')"
				/>
				<Button
					variant="subtle"
					label="Close"
					data-testid="preview-close"
					@click="emit('close')"
				/>
			</header>
			<div class="relative min-h-0 flex-1">
				<BoardCanvas :store="store" :controller="controller" :fonts="0" />
			</div>
		</div>
	</div>
</template>
