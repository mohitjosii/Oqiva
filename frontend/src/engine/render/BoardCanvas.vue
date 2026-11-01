<script setup>
// The drawing surface: grid, page, objects (only those on screen), selection and previews.
// It forwards pointer events to the controller and holds no document logic of its own.
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { objectBounds, rectsIntersect } from "../geometry/bounds"
import { visibleRect } from "../geometry/viewport"
import { createObject } from "../model/factories"
import { GRID_SIZES, pageSize } from "../model/schema"
import ShapeView from "./ShapeView.vue"
import SelectionOverlay from "./SelectionOverlay.vue"

const props = defineProps({
	store: { type: Object, required: true },
	controller: { type: Object, required: true },
	fonts: { type: Number, default: 0 },
})

const root = ref(null)
const state = computed(() => props.store.state)
const canvas = computed(() => props.store.canvas.value)
const viewport = computed(() => state.value.viewport)

const DETAIL_SCALE = 0.35 // below this the shapes are drawn without text
const CULL_MARGIN_PX = 120
const PAGE_BG = "#e9ebef"
const GRID_DOT = "#c3c8d0"

let observer = null
onMounted(() => {
	props.controller.bounds = () => root.value.getBoundingClientRect()
	observer = new ResizeObserver(([entry]) => {
		const { width, height } = entry.contentRect
		state.value.size = { width, height }
	})
	observer.observe(root.value)
	const box = root.value.getBoundingClientRect()
	state.value.size = { width: box.width, height: box.height }
})
onBeforeUnmount(() => observer?.disconnect())

// Only objects that touch the screen are mounted, which is what keeps big boards smooth.
const visible = computed(() => {
	const view = visibleRect(viewport.value, state.value.size)
	const margin = CULL_MARGIN_PX / viewport.value.scale
	const area = {
		x: view.x - margin,
		y: view.y - margin,
		w: view.w + margin * 2,
		h: view.h + margin * 2,
	}
	return props.store.objects.value.filter((object) => rectsIntersect(objectBounds(object), area))
})

const worldTransform = computed(
	() => `translate(${viewport.value.x} ${viewport.value.y}) scale(${viewport.value.scale})`,
)
const detail = computed(() => viewport.value.scale >= DETAIL_SCALE)
const preset = computed(() => canvas.value.mode === "preset")
const page = computed(() => pageSize(canvas.value))
const pageFill = computed(() => canvas.value.background || "#ffffff")

const gridSpacing = computed(() => {
	const base = GRID_SIZES[canvas.value.grid]
	const spacing = base ? base * viewport.value.scale : 0
	return spacing >= 5 ? spacing : 0
})
// In a preset canvas the grid covers only the page; otherwise it fills the screen.
const gridArea = computed(() => {
	if (!gridSpacing.value) return null
	if (!preset.value) return { x: 0, y: 0, width: "100%", height: "100%" }
	const s = viewport.value.scale
	return {
		x: viewport.value.x,
		y: viewport.value.y,
		width: page.value.width * s,
		height: page.value.height * s,
	}
})

const previewObject = computed(() => {
	const preview = state.value.preview
	if (!preview) return null
	const object = createObject(preview.tool, preview.rect, {
		theme: props.store.theme.value.preset,
		z: 0,
		sides: state.value.toolOptions.sides,
	})
	return {
		...object,
		id: "preview",
		text: null,
		style: { ...object.style, fill: null, dash: "dashed" },
	}
})

const cursor = computed(() => props.controller.cursor)

function pointerDown(event) {
	if (event.button === 1) event.preventDefault()
	root.value.setPointerCapture?.(event.pointerId)
	props.controller.pointerDown(event)
}
function pointerUp(event) {
	root.value.releasePointerCapture?.(event.pointerId)
	props.controller.pointerUp(event)
}
</script>

<template>
	<div
		ref="root"
		class="absolute inset-0 select-none overflow-hidden touch-none"
		:style="{ cursor, backgroundColor: preset ? PAGE_BG : pageFill }"
		data-testid="board-canvas"
		@pointerdown="pointerDown"
		@pointermove="controller.pointerMove($event)"
		@pointerup="pointerUp"
		@pointercancel="controller.cancel()"
		@dblclick="controller.doubleClick($event)"
		@wheel.prevent="controller.wheel($event)"
		@contextmenu.prevent
	>
		<svg class="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<pattern
					v-if="gridSpacing"
					id="oqiva-grid"
					patternUnits="userSpaceOnUse"
					:width="gridSpacing"
					:height="gridSpacing"
					:x="viewport.x"
					:y="viewport.y"
				>
					<circle :cx="1" :cy="1" r="1" :fill="GRID_DOT" />
				</pattern>
			</defs>
			<g :transform="worldTransform">
				<rect
					v-if="preset"
					:width="page.width"
					:height="page.height"
					:fill="pageFill"
					style="filter: drop-shadow(0 1px 6px rgba(15, 23, 42, 0.18))"
				/>
			</g>
			<rect
				v-if="gridArea"
				v-bind="gridArea"
				fill="url(#oqiva-grid)"
				pointer-events="none"
				data-testid="grid"
			/>
			<g :transform="worldTransform" data-testid="objects">
				<ShapeView
					v-for="object in visible"
					:key="object.id"
					:object="object"
					:detail="detail"
					:hide-text="object.id === state.editingId"
					:fonts="fonts"
				/>
				<ShapeView v-if="previewObject" :object="previewObject" />
			</g>
			<SelectionOverlay :store="store" />
		</svg>
		<slot />
	</div>
</template>
