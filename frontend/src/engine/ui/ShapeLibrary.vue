<script setup>
// The shape library (Shift+S): ready-made shapes in groups, with search. Click a tile to add the
// shape beside the selection or near the middle of the screen; drag it onto the board to drop it
// exactly there (the frame it lands in lights up). The arrow keys walk the grid, Enter adds.
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import { LIBRARY, presetObject, resolveRecent, searchPresets } from "../model/library"
import ShapeView from "../render/ShapeView.vue"

const props = defineProps({
	store: { type: Object, required: true },
	controller: { type: Object, required: true },
})

const state = computed(() => props.store.state)
const query = ref("")
const panel = ref(null)
const search = ref(null)
const DRAG_THRESHOLD_PX = 5

const groups = computed(() => {
	const found = searchPresets(query.value)
	const recent = query.value.trim() ? [] : resolveRecent(state.value.recentPresets)
	return recent.length
		? [{ group: "Recent", hint: "Shapes you added lately", presets: recent }, ...found]
		: found
})
// Tiles in reading order, each with a group-scoped id (a shape can be under Recent and its own group).
const tiles = computed(() =>
	groups.value.flatMap((g) =>
		g.presets.map((preset) => ({ id: `${g.group}:${preset.key}`, preset })),
	),
)
const focusId = ref(null)

// What a tile draws: the preset as an object, without its label, scaled into the tile.
const glyphs = new Map()
function glyph(preset) {
	if (!glyphs.has(preset.key)) {
		const object = presetObject(preset, { x: 0, y: 0 }, { theme: "ocean", z: 0 })
		const scale = Math.min(1, 56 / preset.h, 120 / preset.w)
		glyphs.set(preset.key, {
			object: { ...object, text: null },
			box: { w: preset.w * scale, h: preset.h * scale },
			view: `-2 -2 ${preset.w + 4} ${preset.h + 4}`,
		})
	}
	return glyphs.get(preset.key)
}

function place(preset) {
	props.controller.placePreset(preset)
}

// ----- click or drag -----
const ghost = ref(null) // {preset, x, y, over}
let press = null

function insideCanvas(x, y) {
	const canvas = document.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect()
	const rect = panel.value?.getBoundingClientRect()
	if (!canvas || x < canvas.left || x > canvas.right || y < canvas.top || y > canvas.bottom)
		return false
	return !(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
}

function onDown(event, preset) {
	if (event.button !== 0 || state.value.readonly) return
	press = { preset, x: event.clientX, y: event.clientY, dragging: false }
	window.addEventListener("pointermove", onMove)
	window.addEventListener("pointerup", onUp)
	window.addEventListener("pointercancel", cancel)
	window.addEventListener("keydown", onEsc, true)
}
function onMove(event) {
	if (!press) return
	if (
		!press.dragging &&
		Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD_PX
	)
		return
	press.dragging = true
	document.body.style.cursor = "grabbing"
	const over = insideCanvas(event.clientX, event.clientY)
	ghost.value = { preset: press.preset, x: event.clientX, y: event.clientY, over }
	state.value.hintFrame = over
		? (props.controller.frameAtPoint(props.controller.boardPoint(event))?.id ?? null)
		: null
}
function onUp(event) {
	const done = press
	const wasDragging = done?.dragging
	const over = wasDragging && insideCanvas(event.clientX, event.clientY)
	cancel()
	if (!done) return
	if (!wasDragging) place(done.preset)
	else if (over) props.controller.placePreset(done.preset, props.controller.boardPoint(event))
	suppressClick = true
	setTimeout(() => (suppressClick = false), 0)
}
function onEsc(event) {
	if (event.key !== "Escape" || !press?.dragging) return
	event.stopPropagation()
	event.preventDefault()
	cancel()
}
function cancel() {
	press = null
	ghost.value = null
	state.value.hintFrame = null
	document.body.style.cursor = ""
	window.removeEventListener("pointermove", onMove)
	window.removeEventListener("pointerup", onUp)
	window.removeEventListener("pointercancel", cancel)
	window.removeEventListener("keydown", onEsc, true)
}
onBeforeUnmount(cancel)

// A click with no pointer (a screen reader, or Enter) arrives with detail 0; pointer clicks were
// already handled on release.
let suppressClick = false
function onClick(event, preset) {
	if (event.detail === 0 && !suppressClick) place(preset)
}

// ----- keyboard -----
function focusTile(id) {
	focusId.value = id
	nextTick(() => panel.value?.querySelector(`[data-tile="${CSS.escape(id)}"]`)?.focus())
}
function onTileKey(event, index) {
	const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 }
	if (event.key in steps) {
		event.preventDefault()
		const next = index + steps[event.key]
		if (next < 0) return search.value?.focus()
		if (next < tiles.value.length) focusTile(tiles.value[next].id)
	} else if (event.key === "Home") {
		event.preventDefault()
		focusTile(tiles.value[0].id)
	} else if (event.key === "End") {
		event.preventDefault()
		focusTile(tiles.value.at(-1).id)
	} else if (event.key === "Escape") {
		close()
	}
}
function onSearchKey(event) {
	event.stopPropagation() // typing letters must not switch tools
	if (event.key === "ArrowDown" && tiles.value.length) {
		event.preventDefault()
		focusTile(tiles.value[0].id)
	} else if (event.key === "Enter") {
		const top = tiles.value.find((t) => !t.id.startsWith("Recent:"))
		if (top) place(top.preset)
	} else if (event.key === "Escape") {
		if (query.value) query.value = ""
		else close()
	}
}
const close = () => (state.value.libraryOpen = false)

watch(
	() => state.value.libraryOpen,
	(open) => {
		if (open) {
			state.value.commentsOpen = false // they share the left edge
			state.value.outlineOpen = false
			nextTick(() => search.value?.focus())
		}
	},
	{ immediate: true },
)
watch(
	() => tiles.value.map((t) => t.id).join(),
	() => (focusId.value = tiles.value[0]?.id ?? null),
	{ immediate: true },
)
const total = LIBRARY.reduce((n, g) => n + g.presets.length, 0)
</script>

<template>
	<aside
		v-if="state.libraryOpen && !state.readonly"
		ref="panel"
		class="absolute bottom-24 left-4 top-14 z-10 flex w-72 flex-col overflow-hidden rounded-xl border border-outline-gray-2 bg-surface-white shadow-lg"
		aria-label="Shape library"
		data-testid="shape-library"
		data-print="hide"
		@pointerdown.stop
		@dblclick.stop
		@wheel.stop
		@contextmenu.stop
	>
		<header class="flex items-center gap-1 border-b border-outline-gray-2 px-3 py-2">
			<h2 class="flex-1 text-sm font-medium text-ink-gray-9">Shapes</h2>
			<button
				type="button"
				class="rounded p-1 text-ink-gray-6 hover:bg-surface-gray-2"
				title="Close the shape library"
				aria-label="Close the shape library"
				@click="close"
			>
				<span class="lucide-x block h-4 w-4" aria-hidden="true" />
			</button>
		</header>
		<div class="border-b border-outline-gray-2 p-2">
			<input
				ref="search"
				v-model="query"
				type="search"
				class="w-full rounded-md border border-outline-gray-2 bg-surface-white px-2 py-1.5 text-sm text-ink-gray-9 placeholder:text-ink-gray-4 focus:border-outline-gray-4 focus:outline-none"
				placeholder="Search shapes"
				aria-label="Search shapes"
				data-testid="library-search"
				@keydown="onSearchKey"
			/>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto p-2">
			<p
				v-if="!groups.length"
				class="px-2 py-6 text-center text-sm text-ink-gray-5"
				data-testid="library-empty"
			>
				No shapes match "{{ query }}".
			</p>
			<section
				v-for="group in groups"
				:key="group.group"
				class="mb-3"
				:aria-label="group.group"
			>
				<h3 class="px-1 text-xs font-medium text-ink-gray-7">{{ group.group }}</h3>
				<p class="mb-1 px-1 text-xs text-ink-gray-5">{{ group.hint }}</p>
				<div class="grid grid-cols-2 gap-1.5">
					<button
						v-for="preset in group.presets"
						:key="`${group.group}:${preset.key}`"
						type="button"
						class="flex touch-none flex-col items-center gap-1 rounded-lg border border-outline-gray-2 bg-surface-white px-1.5 pb-1 pt-2 text-xs text-ink-gray-8 hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
						:title="`${preset.label}: click to add, or drag onto the board`"
						:aria-label="preset.label"
						:data-tile="`${group.group}:${preset.key}`"
						:data-preset="preset.key"
						:tabindex="focusId === `${group.group}:${preset.key}` ? 0 : -1"
						@pointerdown="onDown($event, preset)"
						@click="onClick($event, preset)"
						@keydown="
							onTileKey(
								$event,
								tiles.findIndex((t) => t.id === `${group.group}:${preset.key}`),
							)
						"
						@focus="focusId = `${group.group}:${preset.key}`"
					>
						<svg
							:viewBox="glyph(preset).view"
							:width="glyph(preset).box.w"
							:height="glyph(preset).box.h"
							class="shrink-0"
							aria-hidden="true"
						>
							<ShapeView :object="glyph(preset).object" :detail="false" />
						</svg>
						<span class="max-w-full truncate">{{ preset.label }}</span>
					</button>
				</div>
			</section>
		</div>
		<footer class="border-t border-outline-gray-2 px-3 py-1.5 text-xs text-ink-gray-5">
			{{ total }} shapes · Click to add · Drag onto the board · Type to rename
		</footer>
		<div
			v-if="ghost"
			class="pointer-events-none fixed z-50 border-2 border-dashed border-blue-600 bg-blue-50/60"
			:class="ghost.over ? 'opacity-90' : 'opacity-60'"
			:style="{
				left: `${ghost.x}px`,
				top: `${ghost.y}px`,
				width: ghost.over
					? `${Math.max(24, ghost.preset.w * state.viewport.scale)}px`
					: '72px',
				height: ghost.over
					? `${Math.max(18, ghost.preset.h * state.viewport.scale)}px`
					: '44px',
				transform: 'translate(-50%, -50%)',
				borderRadius: ghost.preset.shape === 'ellipse' ? '9999px' : '8px',
			}"
			data-testid="shape-drag-preview"
		/>
	</aside>
</template>
