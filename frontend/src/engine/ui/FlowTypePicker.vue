<script setup>
// The little menu that asks what kind of step to add: it opens beside a "+" handle, or where a
// connector was dropped on empty canvas. Click a type (or press its letter) and the step is placed
// and connected for you.
import { computed, onBeforeUnmount, onMounted } from "vue"
import { TYPE_INFO } from "../modes/flowchart/model"

const props = defineProps({
	store: { type: Object, required: true },
	controller: { type: Object, required: true },
})

const picker = computed(() => props.store.state.flowPicker)
const TYPES = [
	{ type: "process", key: "Enter" },
	{ type: "decision", key: "D" },
	{ type: "terminator", key: "T" },
	{ type: "io", key: "I" },
	{ type: "junction", key: "J" },
]
// A small drawing of each shape, so a type is recognised without reading.
const GLYPH = {
	terminator: { tag: "rect", attrs: { x: 2, y: 6, width: 28, height: 12, rx: 6 } },
	process: { tag: "rect", attrs: { x: 2, y: 4, width: 28, height: 16, rx: 2 } },
	decision: { tag: "polygon", attrs: { points: "16,1 30,12 16,23 2,12" } },
	io: { tag: "polygon", attrs: { points: "8,4 30,4 24,20 2,20" } },
	junction: { tag: "circle", attrs: { cx: 16, cy: 12, r: 5 } },
}

const style = computed(() => {
	const p = picker.value
	if (!p) return {}
	const { width, height } = props.store.state.size
	return {
		left: `${Math.min(Math.max(8, p.point.x + 14), width - 220)}px`,
		top: `${Math.min(Math.max(8, p.point.y - 20), height - 70)}px`,
	}
})

function choose(type) {
	const p = picker.value
	if (!p) return
	props.store.state.flowPicker = null
	props.controller.flowCommand({ name: "fl.add", type, from: p.from, point: p.at })
}
const close = () => (props.store.state.flowPicker = null)

function onKey(event) {
	if (!picker.value) return
	if (event.key === "Escape") {
		event.stopPropagation()
		event.preventDefault()
		return close()
	}
	const found = TYPES.find(
		(t) =>
			(t.key.length === 1 && event.key.toUpperCase() === t.key) ||
			(t.key === "Enter" && event.key === "Enter"),
	)
	if (found && !event.ctrlKey && !event.metaKey && !event.altKey) {
		event.stopPropagation()
		event.preventDefault()
		choose(found.type)
	}
}
onMounted(() => window.addEventListener("keydown", onKey, true))
onBeforeUnmount(() => window.removeEventListener("keydown", onKey, true))
</script>

<template>
	<div
		v-if="picker"
		class="absolute z-20 flex gap-1 rounded-xl border border-outline-gray-2 bg-surface-white p-1.5 shadow-lg"
		:style="style"
		role="menu"
		aria-label="Add a step"
		data-testid="flow-picker"
		data-dismissable-layer
		data-state="open"
		data-print="hide"
		@pointerdown.stop
		@dblclick.stop
	>
		<button
			v-for="t in TYPES"
			:key="t.type"
			type="button"
			role="menuitem"
			class="flex h-12 w-14 flex-col items-center justify-center gap-0.5 rounded-lg text-ink-gray-7 hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
			:title="`${TYPE_INFO[t.type].label} (${t.key})`"
			:aria-label="TYPE_INFO[t.type].label"
			:data-testid="`flow-pick-${t.type}`"
			@click="choose(t.type)"
		>
			<svg
				viewBox="0 0 32 24"
				width="32"
				height="24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				aria-hidden="true"
			>
				<component :is="GLYPH[t.type].tag" v-bind="GLYPH[t.type].attrs" />
			</svg>
			<span class="text-[10px] leading-none">{{ t.key }}</span>
		</button>
		<button
			type="button"
			class="flex h-12 w-8 items-center justify-center rounded-lg text-ink-gray-5 hover:bg-surface-gray-2"
			title="Close"
			aria-label="Close"
			@click="close"
		>
			<span class="lucide-x block h-4 w-4" aria-hidden="true" />
		</button>
	</div>
</template>
