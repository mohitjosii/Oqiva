<script setup>
// A short card of the things worth knowing on a first board. It opens by itself once on an empty board
// (and never again once dismissed), or whenever someone asks for it from the help menu.
import { computed, onMounted, ref, watch } from "vue"

const props = defineProps({
	modelValue: { type: Boolean, default: false },
	store: { type: Object, required: true },
})
const emit = defineEmits(["update:modelValue"])

const KEY = "oqiva.tipsSeen"
function seen() {
	try {
		return window.localStorage.getItem(KEY) === "1"
	} catch {
		return false
	}
}
function remember() {
	try {
		window.localStorage.setItem(KEY, "1")
	} catch {
		// private mode: the tips may come back next time, which is harmless
	}
}

const empty = computed(
	() =>
		!props.store.objects.value.length &&
		!props.store.connectors.value.length &&
		!props.store.maps.value.length &&
		!props.store.charts.value.length,
)
const editor = computed(() => !props.store.state.readonly)
const auto = ref(false) // opened on its own (an empty board, first time)

onMounted(() => {
	if (editor.value && empty.value && !seen()) auto.value = true
})
// the first thing added to the board puts the card away
watch(empty, (isEmpty) => {
	if (!isEmpty && auto.value) auto.value = false
})

const open = computed(() => props.modelValue || auto.value)
function close() {
	remember()
	auto.value = false
	emit("update:modelValue", false)
}

const TIPS = [
	["Add something", "Pick a shape from the bar at the bottom, then click or drag on the board."],
	["Draw", "Press P for the pen, E for the eraser, Shift+L for a laser pointer."],
	["Connect", "Hover over a shape and click an arrow around it, or press L to draw a line."],
	["Mind map and flowchart", "Press M for a mind map and Shift+F for a flowchart."],
	["Move around", "Hold Space and drag, scroll to pan, Ctrl and scroll to zoom."],
	["Everything", "Press ? to see every shortcut."],
]
</script>

<template>
	<aside
		v-if="open"
		class="absolute bottom-16 left-4 z-20 w-72 rounded-xl border border-outline-gray-2 bg-surface-white p-4 text-sm shadow-xl max-md:bottom-24 max-md:left-3 max-md:w-[calc(100%-1.5rem)]"
		role="dialog"
		aria-label="Quick tips"
		data-testid="quick-tips"
		data-print="hide"
		@pointerdown.stop
		@dblclick.stop
	>
		<h2 class="text-base font-semibold text-ink-gray-9">Getting started</h2>
		<ul class="mt-2 space-y-2">
			<li v-for="[title, text] in TIPS" :key="title">
				<span class="font-medium text-ink-gray-8">{{ title }}.</span>{{ " "
				}}<span class="text-ink-gray-6">{{ text }}</span>
			</li>
		</ul>
		<button
			type="button"
			class="mt-3 rounded-md bg-surface-gray-7 px-3 py-1.5 text-sm text-ink-white hover:bg-surface-gray-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
			data-testid="tips-close"
			@click="close"
		>
			Got it
		</button>
	</aside>
</template>
