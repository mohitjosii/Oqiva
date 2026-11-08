<script setup>
// The bar at the bottom of the board: tools, undo and redo, zoom, and canvas settings.
import { Button, Dropdown, Popover, Select } from "frappe-ui"
import { computed, ref } from "vue"
import { IMAGE_TYPES } from "../interaction/images"
import { fitView, zoomIn, zoomOut, zoomTo } from "../interaction/view"
import { CONNECTOR_TOOLS, connectorToolById } from "../model/connectorTools"
import { CANVAS_PRESETS } from "../model/schema"
import { SHAPE_TOOLS, TEXT_TOOL, toolById } from "../model/shapes"
import { THEMES } from "../model/themes"
import TableSizePicker from "./TableSizePicker.vue"

const props = defineProps({
	store: { type: Object, required: true },
	controller: { type: Object, required: true },
})
const emit = defineEmits(["image"])

const picker = ref(null)
function picked(event) {
	for (const file of event.target.files) emit("image", file)
	event.target.value = "" // so choosing the same file again still counts
}

const state = computed(() => props.store.state)
const canvas = computed(() => props.store.canvas.value)
const readonly = computed(() => state.value.readonly)
const percent = computed(() => Math.round(state.value.viewport.scale * 100))
const shapeTool = computed(() => toolById(state.value.lastShapeTool) || SHAPE_TOOLS[0])
const shapeActive = computed(() => SHAPE_TOOLS.some((tool) => tool.id === state.value.tool))

const lineTool = computed(
	() => connectorToolById(state.value.lastConnectorTool) || CONNECTOR_TOOLS[0],
)
const lineActive = computed(() => CONNECTOR_TOOLS.some((tool) => tool.id === state.value.tool))
const lineOptions = computed(() =>
	CONNECTOR_TOOLS.map((tool) => ({
		label: tool.label,
		icon: tool.icon,
		onClick: () => {
			state.value.lastConnectorTool = tool.id
			chooseTool(tool.id)
		},
	})),
)

function chooseTable({ rows, cols }) {
	state.value.toolOptions.tableRows = rows
	state.value.toolOptions.tableCols = cols
	chooseTool("table")
}

function chooseTool(id) {
	props.controller.cancel()
	state.value.tool = id
}

const shapeOptions = computed(() => [
	...SHAPE_TOOLS.map((tool) => ({
		label: tool.label,
		icon: tool.icon,
		onClick: () => {
			state.value.lastShapeTool = tool.id
			chooseTool(tool.id)
		},
	})),
])

const sideOptions = Array.from({ length: 10 }, (_, i) => ({
	label: `${i + 3} sides`,
	value: i + 3,
}))

const zoomOptions = computed(() => [
	{ label: "Fit everything", onClick: () => fitView(props.store) },
	...[0.5, 1, 2].map((scale) => ({
		label: `${scale * 100}%`,
		onClick: () => zoomTo(props.store, scale),
	})),
])

const BACKGROUNDS = [
	["None (white)", null],
	["Warm paper", "#FFF8E7"],
	["Light gray", "#F3F4F6"],
	["Sky", "#EAF3FF"],
	["Mint", "#E9F8EF"],
]

const tick = (selected) => (selected ? "check" : null)
const settingsOptions = computed(() => [
	{
		group: "Canvas size",
		items: [
			{
				label: "Infinite canvas",
				icon: tick(canvas.value.mode === "infinite"),
				onClick: () => props.store.setCanvas({ mode: "infinite" }),
			},
			...Object.entries(CANVAS_PRESETS).map(([key, preset]) => ({
				label: `${preset.label} (${preset.width}×${preset.height})`,
				icon: tick(canvas.value.mode === "preset" && canvas.value.preset === key),
				onClick: () => {
					props.store.setCanvas({ mode: "preset", preset: key })
					fitView(props.store)
				},
			})),
		],
	},
	{
		group: "Background",
		items: BACKGROUNDS.map(([label, value]) => ({
			label,
			icon: tick(canvas.value.background === value),
			onClick: () => props.store.setCanvas({ background: value }),
		})),
	},
	{
		group: "Grid",
		items: [
			["off", "No grid"],
			["dense", "Dense grid"],
			["sparse", "Sparse grid"],
		].map(([value, label]) => ({
			label,
			icon: tick(canvas.value.grid === value),
			onClick: () => props.store.setCanvas({ grid: value }),
		})),
	},
	{
		group: "Colour theme for new shapes",
		items: Object.entries(THEMES).map(([key, theme]) => ({
			label: theme.label,
			icon: tick(props.store.theme.value.preset === key),
			onClick: () => props.store.setTheme(key),
		})),
	},
])
</script>

<template>
	<div
		class="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-outline-gray-2 bg-surface-white p-1.5 shadow-lg"
		role="toolbar"
		aria-label="Board tools"
		data-print="hide"
		data-testid="palette"
		@pointerdown.stop
		@dblclick.stop
		@wheel.stop
	>
		<Button
			icon="mouse-pointer"
			:variant="state.tool === 'select' ? 'subtle' : 'ghost'"
			title="Select (V)"
			:aria-pressed="state.tool === 'select'"
			@click="chooseTool('select')"
		/>
		<Button
			icon="move"
			:variant="state.tool === 'hand' ? 'subtle' : 'ghost'"
			title="Hand (H)"
			:aria-pressed="state.tool === 'hand'"
			@click="chooseTool('hand')"
		/>
		<span class="mx-1 h-6 w-px bg-outline-gray-2" aria-hidden="true" />
		<Dropdown :options="shapeOptions" :disabled="readonly">
			<Button
				:icon="shapeTool.icon"
				iconRight="chevron-down"
				:variant="shapeActive ? 'subtle' : 'ghost'"
				title="Shapes"
				:disabled="readonly"
				:aria-pressed="shapeActive"
			/>
		</Dropdown>
		<Select
			v-if="state.tool === 'polygon'"
			v-model="state.toolOptions.sides"
			class="w-28"
			:options="sideOptions"
			aria-label="Polygon sides"
		/>
		<Dropdown :options="lineOptions" :disabled="readonly">
			<Button
				:icon="lineTool.icon"
				iconRight="chevron-down"
				:variant="lineActive ? 'subtle' : 'ghost'"
				title="Lines and arrows (L)"
				:disabled="readonly"
				:aria-pressed="lineActive"
				data-testid="lines-button"
			/>
		</Dropdown>
		<Button
			:icon="TEXT_TOOL.icon"
			:variant="state.tool === 'text' ? 'subtle' : 'ghost'"
			title="Text box (T)"
			:disabled="readonly"
			:aria-pressed="state.tool === 'text'"
			@click="chooseTool('text')"
		/>
		<Button
			icon="image"
			variant="ghost"
			title="Add picture"
			:disabled="readonly"
			data-testid="add-picture"
			@click="picker.click()"
		/>
		<Popover placement="top">
			<template #target="{ togglePopover }">
				<Button
					icon="grid"
					:variant="state.tool === 'table' ? 'subtle' : 'ghost'"
					title="Table"
					:disabled="readonly"
					:aria-pressed="state.tool === 'table'"
					data-testid="table-button"
					@click="togglePopover()"
				/>
			</template>
			<template #body-main="{ close }">
				<div class="p-3">
					<TableSizePicker
						@pick="
							(size) => {
								chooseTable(size)
								close()
							}
						"
					/>
				</div>
			</template>
		</Popover>
		<input
			ref="picker"
			type="file"
			multiple
			class="hidden"
			:accept="IMAGE_TYPES.join(',')"
			aria-label="Choose pictures"
			data-testid="picture-input"
			@change="picked"
		/>
		<span class="mx-1 h-6 w-px bg-outline-gray-2" aria-hidden="true" />
		<Button
			icon="rotate-ccw"
			variant="ghost"
			title="Undo"
			:disabled="!store.canUndo"
			@click="store.undo()"
		/>
		<Button
			icon="rotate-cw"
			variant="ghost"
			title="Redo"
			:disabled="!store.canRedo"
			@click="store.redo()"
		/>
		<span class="mx-1 h-6 w-px bg-outline-gray-2" aria-hidden="true" />
		<Button icon="minus" variant="ghost" title="Zoom out" @click="zoomOut(store)" />
		<Dropdown :options="zoomOptions">
			<Button
				variant="ghost"
				:label="`${percent}%`"
				title="Zoom"
				data-testid="zoom-level"
				class="min-w-[3.5rem]"
			/>
		</Dropdown>
		<Button icon="plus" variant="ghost" title="Zoom in" @click="zoomIn(store)" />
		<span class="mx-1 h-6 w-px bg-outline-gray-2" aria-hidden="true" />
		<Dropdown :options="settingsOptions" :disabled="readonly" placement="right">
			<Button icon="sliders" variant="ghost" title="Canvas settings" :disabled="readonly" />
		</Dropdown>
	</div>
</template>
