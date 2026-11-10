<script setup>
// The bar at the top of the board while mind map nodes are selected: add a branch, colour, marker,
// note, the map's layout, collapse all, focus and the outline. Like the bar for shapes, each group
// is one icon that opens a small menu.
import { computed, ref, watch } from "vue"
import { BRANCH_PALETTE, branchColor } from "../modes/mindmap/colors"
import { iconData } from "../model/icons"
import { addCrosslink, applyChange } from "../modes/mindmap/storeOps"
import { NOTE_LIMIT } from "../modes/mindmap/model"
import {
	FONT_SIZE_RANGE,
	setAllFontSize,
	setColor,
	setFontSize,
	setMarker,
	setNote,
} from "../modes/mindmap/tree"
import BarMenu from "./BarMenu.vue"

const props = defineProps({
	store: { type: Object, required: true },
	controller: { type: Object, required: true },
})

const MARKERS = [
	"star",
	"flag",
	"circle-check",
	"triangle-alert",
	"lightbulb",
	"circle-help",
	"heart",
	"target",
	"clock",
	"rocket",
]
const DOTS = ["#EF4444", "#F97316", "#EAB308", "#22C55E", "#3B82F6", "#8B5CF6", "#64748B"]

const state = computed(() => props.store.state)
const nodes = computed(() => props.store.selectedNodes())
const visible = computed(
	() => nodes.value.length > 0 && nodes.value.length === state.value.selection.length,
)
const editable = computed(() => !state.value.readonly)
const single = computed(() => (nodes.value.length === 1 ? nodes.value[0] : null))
const map = computed(() => (single.value ? props.store.getMap(single.value.mapId) : null))
const shownColor = computed(() => {
	const n = single.value
	return n ? branchColor(props.store.nodesOfMap(n.mapId), n.id) : null
})

// Run a tree setter on every selected node (each map's nodes are read fresh, one step in all).
function setEach(setter, value, label) {
	const picked = nodes.value
	const byMap = new Map()
	for (const n of picked) byMap.set(n.mapId, [...(byMap.get(n.mapId) || []), n])
	for (const [mapId, list] of byMap) {
		const change = { add: [], update: [], remove: [] }
		for (const n of list) {
			const one = setter(props.store.nodesOfMap(mapId), n.id, value)
			if (one) change.update.push(...one.update)
		}
		applyChange(props.store, mapId, change, {
			label,
			select: list[0].id,
			selectUndo: picked.map((n) => n.id),
		})
	}
	props.store.select(picked.map((n) => n.id))
}
const color = (value) => setEach(setColor, value, "Colour branch")
const marker = (value) => setEach(setMarker, value, "Marker")

// Text size: the selected nodes, or every node of their map. An empty value puts the size back to
// the default of the node's level.
const SIZES = [12, 14, 16, 18, 20, 24, 32, 40, 56]
const wholeMap = ref(false)
const sizeDraft = ref("")
watch(
	() => single.value?.id,
	() => (sizeDraft.value = single.value?.fontSize ? String(single.value.fontSize) : ""),
	{ immediate: true },
)
function applySize(value) {
	const size = value === null || value === "" ? null : Number(value)
	if (size !== null && !(size >= FONT_SIZE_RANGE.min && size <= FONT_SIZE_RANGE.max)) return
	sizeDraft.value = size ? String(size) : ""
	if (!wholeMap.value) return setEach(setFontSize, size, "Text size")
	const picked = nodes.value.map((n) => n.id)
	for (const mapId of new Set(nodes.value.map((n) => n.mapId)))
		applyChange(props.store, mapId, setAllFontSize(props.store.nodesOfMap(mapId), size), {
			label: "Text size of the whole map",
			select: picked[0],
			selectUndo: picked,
		})
	props.store.select(picked)
}
const defaultSize = computed(() => (single.value && !single.value.parentId ? 20 : 16))

// The note: a draft, kept when the box loses focus.
const draft = ref("")
watch(
	() => single.value?.id,
	() => (draft.value = single.value?.note || ""),
	{ immediate: true },
)
function saveNote() {
	if (single.value && draft.value !== single.value.note)
		setEach(setNote, draft.value, "Edit note")
}

const run = (command) => props.controller.mapCommand(command)

// Two nodes of one map selected: a dotted cross-link between them, with an optional label.
const pair = computed(() =>
	nodes.value.length === 2 && nodes.value[0].mapId === nodes.value[1].mapId ? nodes.value : null,
)
const existing = computed(() => {
	if (!pair.value) return null
	const [a, b] = pair.value.map((n) => n.id)
	return (
		props.store
			.crosslinksOfMap(pair.value[0].mapId)
			.find((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a)) || null
	)
})
const linkLabel = ref("")
watch(
	() => existing.value?.id,
	() => (linkLabel.value = existing.value?.label || ""),
	{ immediate: true },
)
function saveLink() {
	if (!pair.value) return
	const label = linkLabel.value.trim().slice(0, 100)
	if (existing.value) {
		props.store.applyOps(
			[
				{
					t: "update",
					list: "crosslinks",
					changes: [{ id: existing.value.id, patch: { label } }],
				},
			],
			{ label: "Cross-link label" },
		)
	} else {
		addCrosslink(props.store, pair.value[0].mapId, pair.value[0].id, pair.value[1].id, label)
	}
}
function removeLink() {
	if (existing.value)
		props.store.applyOps([{ t: "remove", list: "crosslinks", ids: [existing.value.id] }], {
			label: "Remove cross-link",
		})
}
function setLayout(layout) {
	if (!map.value || map.value.layout === layout) return
	props.store.applyOps(
		[{ t: "update", list: "maps", changes: [{ id: map.value.id, patch: { layout } }] }],
		{
			label: "Map layout",
		},
	)
}
const markerOf = computed(() => single.value?.marker || null)
</script>

<template>
	<div
		v-if="visible"
		class="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-20rem)] -translate-x-1/2 items-center gap-0.5 rounded-xl border border-outline-gray-2 bg-surface-white p-1.5 text-sm shadow-lg"
		role="toolbar"
		aria-label="Mind map options"
		data-testid="mindmap-bar"
		data-print="hide"
		@pointerdown.stop
		@pointerup.stop
		@dblclick.stop
		@wheel.stop
		@contextmenu.stop
	>
		<template v-if="editable && single">
			<button
				type="button"
				class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-7 hover:bg-surface-gray-2"
				title="Add a child (Tab)"
				aria-label="Add a child"
				data-testid="mm-child"
				@click="run({ name: 'mm.child' })"
			>
				<span class="lucide-git-branch-plus block h-[18px] w-[18px]" aria-hidden="true" />
			</button>
			<button
				v-if="single.parentId"
				type="button"
				class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-7 hover:bg-surface-gray-2"
				title="Add a sibling (Enter)"
				aria-label="Add a sibling"
				data-testid="mm-sibling"
				@click="run({ name: 'mm.sibling' })"
			>
				<span class="lucide-list-plus block h-[18px] w-[18px]" aria-hidden="true" />
			</button>
			<span class="mx-1 h-6 w-px bg-outline-gray-2" aria-hidden="true" />
		</template>

		<BarMenu
			v-if="editable"
			label="Branch colour"
			icon="lucide-palette"
			:swatch="shownColor"
			wide
		>
			<h3 class="text-xs font-medium text-ink-gray-6">Branch colour</h3>
			<div class="flex flex-wrap gap-1.5" data-testid="mm-colors">
				<button
					type="button"
					class="rounded-md border border-outline-gray-3 px-2 py-1 text-xs text-ink-gray-8 hover:bg-surface-gray-2"
					data-testid="mm-color-auto"
					@click="color(null)"
				>
					Automatic
				</button>
				<button
					v-for="c in BRANCH_PALETTE"
					:key="c"
					type="button"
					class="h-6 w-6 rounded-full border border-outline-gray-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
					:class="single?.color === c ? 'ring-2 ring-outline-gray-5 ring-offset-1' : ''"
					:style="{ backgroundColor: c }"
					:title="c"
					:aria-label="`Colour ${c}`"
					:data-testid="`mm-color-${c.slice(1)}`"
					@click="color(c)"
				/>
			</div>
		</BarMenu>

		<BarMenu v-if="editable" label="Marker" icon="lucide-badge-check" wide>
			<h3 class="text-xs font-medium text-ink-gray-6">Marker</h3>
			<div class="flex flex-wrap gap-1" data-testid="mm-markers">
				<button
					type="button"
					class="rounded-md border border-outline-gray-3 px-2 py-1 text-xs text-ink-gray-8 hover:bg-surface-gray-2"
					data-testid="mm-marker-none"
					@click="marker(null)"
				>
					None
				</button>
				<button
					v-for="icon in MARKERS"
					:key="icon"
					type="button"
					class="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-gray-2"
					:class="markerOf?.icon === icon ? 'bg-surface-gray-3' : ''"
					:title="icon"
					:aria-label="`Marker ${icon}`"
					:data-testid="`mm-marker-${icon}`"
					@click="marker({ icon, dot: markerOf?.dot || null })"
				>
					<svg
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<component
							:is="tag"
							v-for="([tag, attrs], i) in iconData(icon)?.shapes || []"
							:key="i"
							v-bind="attrs"
						/>
					</svg>
				</button>
			</div>
			<h3 class="mt-1 text-xs font-medium text-ink-gray-6">Dot</h3>
			<div class="flex flex-wrap gap-1.5">
				<button
					v-for="dot in DOTS"
					:key="dot"
					type="button"
					class="h-5 w-5 rounded-full border border-outline-gray-3"
					:class="markerOf?.dot === dot ? 'ring-2 ring-outline-gray-5 ring-offset-1' : ''"
					:style="{ backgroundColor: dot }"
					:aria-label="`Dot ${dot}`"
					:data-testid="`mm-dot-${dot.slice(1)}`"
					@click="marker({ icon: markerOf?.icon || null, dot })"
				/>
			</div>
		</BarMenu>

		<BarMenu v-if="editable" label="Text size" icon="lucide-a-large-small" wide>
			<h3 class="text-xs font-medium text-ink-gray-6">Text size</h3>
			<div class="flex flex-wrap gap-1" data-testid="mm-sizes">
				<button
					v-for="size in SIZES"
					:key="size"
					type="button"
					class="min-w-8 rounded-md border border-outline-gray-3 px-1.5 py-1 text-xs text-ink-gray-8 hover:bg-surface-gray-2"
					:class="single?.fontSize === size ? 'bg-surface-gray-3 font-semibold' : ''"
					:data-testid="`mm-size-${size}`"
					@click="applySize(size)"
				>
					{{ size }}
				</button>
			</div>
			<div class="flex items-center gap-1.5">
				<input
					v-model="sizeDraft"
					type="number"
					:min="FONT_SIZE_RANGE.min"
					:max="FONT_SIZE_RANGE.max"
					:placeholder="`${defaultSize}`"
					aria-label="Text size"
					class="w-20 rounded-md border border-outline-gray-2 bg-surface-white px-2 py-1 text-sm text-ink-gray-9 focus:border-outline-gray-4 focus:outline-none"
					data-testid="mm-size-input"
					@keydown.stop
					@keydown.enter.prevent="applySize(sizeDraft)"
					@change="applySize(sizeDraft)"
				/>
				<button
					type="button"
					class="rounded-md border border-outline-gray-2 px-2 py-1 text-xs text-ink-gray-8 hover:bg-surface-gray-2"
					data-testid="mm-size-default"
					@click="applySize(null)"
				>
					Default
				</button>
			</div>
			<label class="flex items-center gap-1.5 text-xs text-ink-gray-7">
				<input v-model="wholeMap" type="checkbox" data-testid="mm-size-whole" />
				Every node in this map
			</label>
		</BarMenu>

		<BarMenu
			v-if="single"
			label="Note"
			icon="lucide-sticky-note"
			:swatch="single.note ? '#FACC15' : null"
			wide
		>
			<h3 class="text-xs font-medium text-ink-gray-6">Note</h3>
			<textarea
				v-model="draft"
				rows="5"
				:maxlength="NOTE_LIMIT"
				:readonly="!editable"
				class="w-full rounded-md border border-outline-gray-2 bg-surface-white px-2 py-1.5 text-sm text-ink-gray-9 focus:border-outline-gray-4 focus:outline-none"
				placeholder="A longer thought about this node"
				aria-label="Note"
				data-testid="mm-note"
				@keydown.stop
				@blur="saveNote"
			/>
			<p class="text-xs text-ink-gray-5">Shown when you hover the node.</p>
		</BarMenu>

		<BarMenu v-if="pair && editable" label="Cross-link" icon="lucide-link-2" wide>
			<h3 class="text-xs font-medium text-ink-gray-6">Cross-link</h3>
			<input
				v-model="linkLabel"
				type="text"
				maxlength="100"
				placeholder="Label (optional)"
				aria-label="Cross-link label"
				class="w-full rounded-md border border-outline-gray-2 bg-surface-white px-2 py-1 text-sm text-ink-gray-9 placeholder:text-ink-gray-4 focus:border-outline-gray-4 focus:outline-none"
				data-testid="mm-link-label"
				@keydown.stop
				@keydown.enter.prevent="saveLink"
			/>
			<button
				type="button"
				class="rounded-md border border-outline-gray-2 px-2 py-1 text-sm text-ink-gray-8 hover:bg-surface-gray-2"
				data-testid="mm-link-save"
				@click="saveLink"
			>
				{{ existing ? "Update label" : "Link these two" }}
			</button>
			<button
				v-if="existing"
				type="button"
				class="rounded-md px-2 py-1 text-left text-sm text-red-600 hover:bg-surface-gray-2"
				data-testid="mm-link-remove"
				@click="removeLink"
			>
				Remove the link
			</button>
		</BarMenu>

		<BarMenu v-if="map" label="Layout" icon="lucide-layout-dashboard">
			<h3 class="text-xs font-medium text-ink-gray-6">Map layout</h3>
			<button
				v-for="[value, label] in [
					['both', 'Both sides'],
					['right', 'Right side only'],
				]"
				:key="value"
				type="button"
				class="rounded-md px-2 py-1 text-left text-sm hover:bg-surface-gray-2"
				:class="
					map.layout === value ? 'bg-surface-gray-3 text-ink-gray-9' : 'text-ink-gray-8'
				"
				:disabled="!editable"
				:data-testid="`mm-layout-${value}`"
				@click="setLayout(value)"
			>
				{{ label }}
			</button>
			<h3 class="mt-1 text-xs font-medium text-ink-gray-6">Branches</h3>
			<button
				type="button"
				class="rounded-md px-2 py-1 text-left text-sm text-ink-gray-8 hover:bg-surface-gray-2"
				:disabled="!editable"
				data-testid="mm-collapse-all"
				@click="run({ name: 'mm.collapseAll' })"
			>
				Collapse all
			</button>
			<button
				type="button"
				class="rounded-md px-2 py-1 text-left text-sm text-ink-gray-8 hover:bg-surface-gray-2"
				:disabled="!editable"
				data-testid="mm-expand-all"
				@click="run({ name: 'mm.expandAll' })"
			>
				Expand all
			</button>
		</BarMenu>

		<span class="mx-1 h-6 w-px bg-outline-gray-2" aria-hidden="true" />
		<button
			type="button"
			class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-7 hover:bg-surface-gray-2"
			:class="state.focusBranch ? 'bg-surface-gray-3' : ''"
			title="Focus on this branch"
			aria-label="Focus on this branch"
			:aria-pressed="state.focusBranch"
			data-testid="mm-focus"
			@click="state.focusBranch = !state.focusBranch"
		>
			<span class="lucide-focus block h-[18px] w-[18px]" aria-hidden="true" />
		</button>
		<button
			type="button"
			class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-7 hover:bg-surface-gray-2"
			:class="state.outlineOpen ? 'bg-surface-gray-3' : ''"
			title="Outline"
			aria-label="Outline"
			:aria-pressed="state.outlineOpen"
			data-testid="mm-outline"
			@click="state.outlineOpen = !state.outlineOpen"
		>
			<span class="lucide-list-tree block h-[18px] w-[18px]" aria-hidden="true" />
		</button>
		<button
			v-if="editable"
			type="button"
			class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-7 hover:bg-surface-gray-2"
			title="Delete (Delete)"
			aria-label="Delete"
			data-testid="mm-delete"
			@click="run({ name: 'mm.delete' })"
		>
			<span class="lucide-trash-2 block h-[18px] w-[18px]" aria-hidden="true" />
		</button>
	</div>
</template>
