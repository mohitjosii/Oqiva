<script setup>
// The bar at the top while a drawing tool is chosen. Pen and highlighter: a colour and a width (a
// number you type, in board units, or one of a few usual ones). Eraser: cut strokes (ink) or remove
// whole objects, and one of three tip sizes. The laser has nothing to set.
import { computed } from "vue"
import { INKS } from "../model/strokes"
import { ERASER_SIZES } from "../interaction/eraser"
import BarMenu from "./BarMenu.vue"
import ColorSwatches from "./ColorSwatches.vue"
import FontSizeField from "./FontSizeField.vue"

const props = defineProps({ store: { type: Object, required: true } })

const state = computed(() => props.store.state)
const tool = computed(() => state.value.tool)
const inking = computed(() => tool.value === "pen" || tool.value === "highlighter")
const visible = computed(() => (inking.value || tool.value === "eraser") && !state.value.readonly)
const options = computed(() => state.value.ink[tool.value] || null)
const WIDTHS = { pen: [1, 2, 4, 6, 10, 16], highlighter: [10, 14, 18, 24, 32, 48] }

const setColor = (hex) => options.value && hex && (state.value.ink[tool.value].color = hex)
const setWidth = (width) => (state.value.ink[tool.value].width = width)
const SIZE_LABELS = { s: "Small", m: "Medium", l: "Large" }
</script>

<template>
	<div
		v-if="visible"
		class="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-20rem)] -translate-x-1/2 items-center gap-1 rounded-xl border border-outline-gray-2 bg-surface-white p-1.5 text-sm shadow-lg"
		role="toolbar"
		:aria-label="inking ? 'Pen options' : 'Eraser options'"
		data-testid="draw-bar"
		data-print="hide"
		@pointerdown.stop
		@pointerup.stop
		@dblclick.stop
		@wheel.stop
	>
		<template v-if="inking && options">
			<BarMenu label="Pen colour" icon="lucide-palette" :swatch="options.color" wide>
				<h3 class="text-xs font-medium text-ink-gray-6">
					{{ tool === "pen" ? "Pen" : "Highlighter" }} colour
				</h3>
				<ColorSwatches :model-value="options.color" name="ink" @pick="setColor" />
			</BarMenu>
			<span class="px-1 text-xs text-ink-gray-6">Width</span>
			<FontSizeField
				:model-value="options.width"
				:presets="WIDTHS[tool]"
				:min="1"
				:max="80"
				testid="ink-width"
				label="Pen width"
				@update:model-value="setWidth"
			/>
			<span
				class="mx-1 inline-block shrink-0 rounded-full"
				:style="{
					width: `${Math.min(28, options.width)}px`,
					height: `${Math.min(28, options.width)}px`,
					backgroundColor: options.color,
					opacity: INKS[tool].opacity,
				}"
				aria-hidden="true"
			/>
		</template>
		<template v-else>
			<button
				v-for="mode in ['ink', 'object']"
				:key="mode"
				type="button"
				class="rounded-md px-2.5 py-1 text-xs text-ink-gray-7 hover:bg-surface-gray-2"
				:class="
					state.ink.eraserMode === mode
						? 'bg-surface-gray-3 font-semibold text-ink-gray-9'
						: ''
				"
				:aria-pressed="state.ink.eraserMode === mode"
				:data-testid="`eraser-mode-${mode}`"
				:title="
					mode === 'ink'
						? 'Cut away just the part you touch'
						: 'Remove the whole object you touch'
				"
				@click="state.ink.eraserMode = mode"
			>
				{{ mode === "ink" ? "Ink" : "Objects" }}
			</button>
			<span class="mx-1 h-6 w-px bg-outline-gray-2" aria-hidden="true" />
			<button
				v-for="size in ERASER_SIZES"
				:key="size"
				type="button"
				class="rounded-md px-2.5 py-1 text-xs text-ink-gray-7 hover:bg-surface-gray-2"
				:class="
					state.ink.eraserSize === size
						? 'bg-surface-gray-3 font-semibold text-ink-gray-9'
						: ''
				"
				:aria-pressed="state.ink.eraserSize === size"
				:data-testid="`eraser-size-${size}`"
				@click="state.ink.eraserSize = size"
			>
				{{ SIZE_LABELS[size] }}
			</button>
		</template>
	</div>
</template>
