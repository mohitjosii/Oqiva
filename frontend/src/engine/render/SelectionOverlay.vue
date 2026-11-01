<script setup>
// Selection outlines, resize and rotation handles, the marquee. Drawn in screen pixels so
// handles keep their size at every zoom. Handles carry data-handle for the controller.
import { computed } from "vue"
import { boundsOfObjects, corners } from "../geometry/bounds"
import { HANDLE_NAMES, handlePoint, rotationHandlePoint } from "../geometry/resize"
import { toScreen } from "../geometry/viewport"

const props = defineProps({ store: { type: Object, required: true } })

const ACCENT = "#2563eb"
const HANDLE = 9
const ROTATE_GAP_PX = 28
const CURSORS = {
	n: "ns-resize",
	s: "ns-resize",
	e: "ew-resize",
	w: "ew-resize",
	nw: "nwse-resize",
	se: "nwse-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
}

const state = computed(() => props.store.state)
const selected = computed(() => props.store.selectedObjects())
const single = computed(() => (selected.value.length === 1 ? selected.value[0] : null))
const editable = computed(() => !state.value.readonly && !state.value.editingId)
const toPx = (point) => toScreen(state.value.viewport, point)

const outlines = computed(() =>
	selected.value.map((object) => ({
		id: object.id,
		points: corners(object)
			.map((corner) => {
				const p = toPx(corner)
				return `${p.x},${p.y}`
			})
			.join(" "),
	})),
)

const handles = computed(() => {
	const object = single.value
	if (!object || !editable.value) return []
	return HANDLE_NAMES.map((name) => ({
		name,
		...toPx(handlePoint(object, name)),
		cursor: CURSORS[name],
	}))
})

const rotation = computed(() => {
	const object = single.value
	if (!object || !editable.value) return null
	const top = toPx(handlePoint(object, "n"))
	const knob = toPx(rotationHandlePoint(object, ROTATE_GAP_PX / state.value.viewport.scale))
	return { top, knob }
})

const group = computed(() => {
	if (selected.value.length < 2) return null
	const box = boundsOfObjects(selected.value)
	const a = toPx({ x: box.x, y: box.y })
	const b = toPx({ x: box.x + box.w, y: box.y + box.h })
	return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }
})

const marquee = computed(() => {
	const m = state.value.marquee
	if (!m) return null
	const a = toPx({ x: m.x, y: m.y })
	const b = toPx({ x: m.x + m.w, y: m.y + m.h })
	return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }
})
</script>

<template>
	<g data-testid="selection-overlay">
		<polygon
			v-for="outline in outlines"
			:key="outline.id"
			:points="outline.points"
			fill="none"
			:stroke="ACCENT"
			stroke-width="1.5"
			pointer-events="none"
		/>
		<rect
			v-if="group"
			v-bind="group"
			fill="none"
			:stroke="ACCENT"
			stroke-width="1"
			stroke-dasharray="4 3"
			pointer-events="none"
		/>
		<template v-if="rotation">
			<line
				:x1="rotation.top.x"
				:y1="rotation.top.y"
				:x2="rotation.knob.x"
				:y2="rotation.knob.y"
				:stroke="ACCENT"
				stroke-width="1"
				pointer-events="none"
			/>
			<circle
				:cx="rotation.knob.x"
				:cy="rotation.knob.y"
				r="5.5"
				fill="#fff"
				:stroke="ACCENT"
				stroke-width="1.5"
				data-handle="rotate"
				style="cursor: grab"
			/>
		</template>
		<rect
			v-for="handle in handles"
			:key="handle.name"
			:x="handle.x - HANDLE / 2"
			:y="handle.y - HANDLE / 2"
			:width="HANDLE"
			:height="HANDLE"
			rx="1.5"
			fill="#fff"
			:stroke="ACCENT"
			stroke-width="1.5"
			:data-handle="handle.name"
			:style="{ cursor: handle.cursor }"
		/>
		<rect
			v-if="marquee"
			v-bind="marquee"
			:fill="ACCENT"
			fill-opacity="0.08"
			:stroke="ACCENT"
			stroke-width="1"
			pointer-events="none"
		/>
	</g>
</template>
