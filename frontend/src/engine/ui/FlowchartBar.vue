<script setup>
// The bar at the top of the board while flowchart steps or arrows are selected: add the next step,
// change a step's type, add a decision output, edit an arrow's label, insert a step in the middle
// of an arrow, and for the whole chart Tidy up, direction and step numbers. Each group is one icon
// that opens a small menu, like the bars for shapes and mind maps.
import { computed, ref } from "vue"
import FontSizeField from "./FontSizeField.vue"
import { FLOW_FONT_SIZE } from "../modes/flowchart/model"
import BarMenu from "./BarMenu.vue"

const props = defineProps({
	store: { type: Object, required: true },
	controller: { type: Object, required: true },
})

const TYPES = [
	{ type: "process", label: "Step", key: "Enter" },
	{ type: "decision", label: "Decision", key: "D" },
	{ type: "terminator", label: "Start / End", key: "T" },
	{ type: "io", label: "Input / Output", key: "I" },
	{ type: "junction", label: "Junction", key: "J" },
]
const GLYPH = {
	terminator: { tag: "rect", attrs: { x: 2, y: 6, width: 28, height: 12, rx: 6 } },
	process: { tag: "rect", attrs: { x: 2, y: 4, width: 28, height: 16, rx: 2 } },
	decision: { tag: "polygon", attrs: { points: "16,1 30,12 16,23 2,12" } },
	io: { tag: "polygon", attrs: { points: "8,4 30,4 24,20 2,20" } },
	junction: { tag: "circle", attrs: { cx: 16, cy: 12, r: 5 } },
}

const state = computed(() => props.store.state)
const nodes = computed(() => props.store.selectedFlowNodes())
const edges = computed(() => props.store.selectedFlowEdges())
const visible = computed(
	() =>
		nodes.value.length + edges.value.length > 0 &&
		nodes.value.length + edges.value.length === state.value.selection.length,
)
const editable = computed(() => !state.value.readonly)
const node = computed(() =>
	nodes.value.length === 1 && !edges.value.length ? nodes.value[0] : null,
)
const edge = computed(() =>
	edges.value.length === 1 && !nodes.value.length ? edges.value[0] : null,
)
const chart = computed(() => {
	const chartId = (nodes.value[0] || edges.value[0])?.chartId
	return chartId ? props.store.getChart(chartId) : null
})

const run = (command) => props.controller.flowCommand(command)

// Text size: the selected steps, or every step of their chart. Empty puts it back to the default.
const wholeChart = ref(false)
const shownSize = computed(() => {
	const sizes = new Set(nodes.value.map((n) => n.fontSize || FLOW_FONT_SIZE))
	return sizes.size === 1 ? [...sizes][0] : null
})
const setSize = (size) => run({ name: "fl.fontSize", size, whole: wholeChart.value })
const addNext = (type) => run({ name: "fl.add", type })
const insert = (type) => run({ name: "fl.insert", edge: edge.value.id, type })
const swap = (type) => run({ name: "fl.swap", type })
</script>

<template>
	<div
		v-if="visible && chart && editable"
		class="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-20rem)] -translate-x-1/2 items-center gap-0.5 rounded-xl border border-outline-gray-2 bg-surface-white p-1.5 text-sm shadow-lg"
		role="toolbar"
		aria-label="Flowchart options"
		data-testid="flowchart-bar"
		data-print="hide"
		@pointerdown.stop
		@pointerup.stop
		@dblclick.stop
		@wheel.stop
		@contextmenu.stop
	>
		<template v-if="editable && node">
			<BarMenu label="Add next step" icon="lucide-circle-plus">
				<h3 class="text-xs font-medium text-ink-gray-6">Add next step</h3>
				<div class="flex flex-col gap-0.5" data-testid="fl-add-menu">
					<button
						v-for="t in TYPES"
						:key="t.type"
						type="button"
						class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink-gray-8 hover:bg-surface-gray-2"
						:data-testid="`fl-add-${t.type}`"
						@click="addNext(t.type)"
					>
						<svg
							viewBox="0 0 32 24"
							width="24"
							height="18"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<component :is="GLYPH[t.type].tag" v-bind="GLYPH[t.type].attrs" />
						</svg>
						<span class="flex-1">{{ t.label }}</span>
						<kbd class="text-xs text-ink-gray-5">{{ t.key }}</kbd>
					</button>
				</div>
			</BarMenu>
			<BarMenu label="Step type" icon="lucide-shapes">
				<h3 class="text-xs font-medium text-ink-gray-6">Change type</h3>
				<div class="flex flex-col gap-0.5" data-testid="fl-swap-menu">
					<button
						v-for="t in TYPES"
						:key="t.type"
						type="button"
						class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink-gray-8 hover:bg-surface-gray-2"
						:class="node.type === t.type ? 'bg-surface-gray-3 font-medium' : ''"
						:data-testid="`fl-swap-${t.type}`"
						@click="swap(t.type)"
					>
						<svg
							viewBox="0 0 32 24"
							width="24"
							height="18"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<component :is="GLYPH[t.type].tag" v-bind="GLYPH[t.type].attrs" />
						</svg>
						<span>{{ t.label }}</span>
					</button>
				</div>
			</BarMenu>
			<BarMenu label="Text size" icon="lucide-a-large-small" wide>
				<h3 class="text-xs font-medium text-ink-gray-6">Text size</h3>
				<div class="flex items-center gap-1.5">
					<FontSizeField
						:model-value="shownSize"
						testid="fl-size-input"
						@update:model-value="setSize"
					/>
					<button
						type="button"
						class="rounded-md border border-outline-gray-2 px-2 py-1 text-xs text-ink-gray-8 hover:bg-surface-gray-2"
						data-testid="fl-size-default"
						@click="setSize(null)"
					>
						Default
					</button>
				</div>
				<label class="flex items-center gap-1.5 text-xs text-ink-gray-7">
					<input v-model="wholeChart" type="checkbox" data-testid="fl-size-whole" />
					Every step of the chart
				</label>
			</BarMenu>
			<button
				v-if="node.type === 'decision'"
				type="button"
				class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-7 hover:bg-surface-gray-2"
				title="Add another output"
				aria-label="Add another output"
				data-testid="fl-branch"
				@click="run({ name: 'fl.branch' })"
			>
				<span class="lucide-split block h-[18px] w-[18px]" aria-hidden="true" />
			</button>
			<button
				type="button"
				class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-7 hover:bg-surface-gray-2"
				title="Edit text (F2)"
				aria-label="Edit text"
				data-testid="fl-edit"
				@click="run({ name: 'fl.edit' })"
			>
				<span class="lucide-pencil block h-[18px] w-[18px]" aria-hidden="true" />
			</button>
			<span class="mx-1 h-6 w-px bg-outline-gray-2" aria-hidden="true" />
		</template>

		<template v-if="editable && edge">
			<button
				type="button"
				class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-ink-gray-7 hover:bg-surface-gray-2"
				title="Edit label (F2)"
				aria-label="Edit label"
				data-testid="fl-label"
				@click="run({ name: 'fl.edit' })"
			>
				<span class="lucide-tag block h-[18px] w-[18px]" aria-hidden="true" />
				<span>{{ edge.label || "Add label" }}</span>
			</button>
			<BarMenu label="Insert step" icon="lucide-circle-plus">
				<h3 class="text-xs font-medium text-ink-gray-6">Insert a step here</h3>
				<div class="flex flex-col gap-0.5" data-testid="fl-insert-menu">
					<button
						v-for="t in TYPES"
						:key="t.type"
						type="button"
						class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink-gray-8 hover:bg-surface-gray-2"
						:data-testid="`fl-insert-${t.type}`"
						@click="insert(t.type)"
					>
						<svg
							viewBox="0 0 32 24"
							width="24"
							height="18"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<component :is="GLYPH[t.type].tag" v-bind="GLYPH[t.type].attrs" />
						</svg>
						<span>{{ t.label }}</span>
					</button>
				</div>
			</BarMenu>
			<span class="mx-1 h-6 w-px bg-outline-gray-2" aria-hidden="true" />
		</template>

		<template v-if="editable">
			<button
				type="button"
				class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-ink-gray-7 hover:bg-surface-gray-2"
				title="Tidy up: lay the whole chart out again"
				data-testid="fl-tidy"
				@click="run({ name: 'fl.tidy' })"
			>
				<span class="lucide-wand-sparkles block h-[18px] w-[18px]" aria-hidden="true" />
				<span>Tidy up</span>
			</button>
			<button
				type="button"
				class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-7 hover:bg-surface-gray-2"
				:title="chart.direction === 'TB' ? 'Flow left to right' : 'Flow top to bottom'"
				:aria-label="chart.direction === 'TB' ? 'Flow left to right' : 'Flow top to bottom'"
				data-testid="fl-direction"
				@click="run({ name: 'fl.direction' })"
			>
				<span
					:class="
						chart.direction === 'TB'
							? 'lucide-arrow-down-up'
							: 'lucide-arrow-right-left'
					"
					class="block h-[18px] w-[18px]"
					aria-hidden="true"
				/>
			</button>
			<button
				type="button"
				class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-7 hover:bg-surface-gray-2"
				:class="chart.numbered ? 'bg-surface-gray-3 text-ink-gray-9' : ''"
				:title="chart.numbered ? 'Hide step numbers' : 'Number the steps'"
				:aria-pressed="chart.numbered"
				aria-label="Number the steps"
				data-testid="fl-numbered"
				@click="run({ name: 'fl.numbered' })"
			>
				<span class="lucide-list-ordered block h-[18px] w-[18px]" aria-hidden="true" />
			</button>
			<button
				type="button"
				class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-7 hover:bg-surface-gray-2"
				title="Delete (Delete)"
				aria-label="Delete"
				data-testid="fl-delete"
				@click="run({ name: 'fl.delete' })"
			>
				<span class="lucide-trash-2 block h-[18px] w-[18px]" aria-hidden="true" />
			</button>
		</template>
	</div>
</template>
