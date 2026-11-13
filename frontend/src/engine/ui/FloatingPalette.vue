<script setup>
// The bar at the bottom of the board: tools, undo and redo, zoom, and canvas settings.
import { Dropdown, Popover, Select, toast } from "frappe-ui"
import { computed, ref } from "vue"
import { IMAGE_TYPES } from "../interaction/images"
import { fitBounds } from "../geometry/viewport"
import { fitView, setViewport, zoomIn, zoomOut, zoomTo } from "../interaction/view"
import { CONNECTOR_TOOLS, connectorToolById } from "../model/connectorTools"
import { CANVAS_PRESETS } from "../model/schema"
import { SHAPE_TOOLS, TEXT_TOOL, toolById } from "../model/shapes"
import { THEMES } from "../model/themes"
import IconPicker from "./IconPicker.vue"
import TableSizePicker from "./TableSizePicker.vue"
import ToolButton from "./ToolButton.vue"

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

// The drawing tools share one button with a menu, like shapes and lines do.
const DRAW_TOOLS = [
	{ id: "pen", label: "Pen (P)", icon: "lucide-pen-line" },
	{ id: "highlighter", label: "Highlighter (Shift+H)", icon: "lucide-highlighter" },
	{ id: "eraser", label: "Eraser (E)", icon: "lucide-eraser" },
	{ id: "laser", label: "Laser pointer (Shift+L)", icon: "lucide-locate-fixed" },
]
const drawTool = computed(
	() => DRAW_TOOLS.find((tool) => tool.id === state.value.lastDrawTool) || DRAW_TOOLS[0],
)
const drawActive = computed(() => DRAW_TOOLS.some((tool) => tool.id === state.value.tool))
const drawOptions = computed(() => [
	{
		group: "Draw",
		items: DRAW_TOOLS.map((tool) => ({
			label: tool.label,
			icon: tool.icon,
			// a viewer cannot draw, but can still point with the laser
			disabled: readonly.value && tool.id !== "laser",
			onClick: () => {
				state.value.lastDrawTool = tool.id
				chooseTool(tool.id)
			},
		})),
	},
	{
		group: "This board",
		items: [
			{
				label: "Hand-drawn outlines",
				icon: canvas.value.sketch ? "check" : null,
				disabled: readonly.value,
				onClick: () =>
					props.store.setCanvas({ sketch: !canvas.value.sketch }, "Drawing style"),
			},
			{
				label: "Double-click adds a text box",
				icon: canvas.value.doubleClick === "text" ? "check" : null,
				disabled: readonly.value,
				onClick: () =>
					props.store.setCanvas(
						{ doubleClick: canvas.value.doubleClick === "text" ? "shape" : "text" },
						"Double-click setting",
					),
			},
		],
	},
])

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

// Choosing the comment tool says what to do next, since nothing on the board changes yet.
function chooseComment() {
	if (state.value.tool === "comment") return chooseTool("select")
	chooseTool("comment")
	toast.info("Click a shape, or any place on the board, to comment on it.")
}

// A new mind map in the middle of the screen, its central idea ready to type over.
function newMap() {
	props.controller.cancel()
	props.controller.mapCommand({ name: "mm.new" })
	toast.info("Type its name, then Tab adds a branch and Enter a sibling.")
}

// A new flowchart (Start, a step and End, joined) below the rest of the board, ready to type over.
function newFlowchart() {
	props.controller.cancel()
	props.controller.flowCommand({ name: "fl.new" })
	toast.info("Type the step, then Enter adds the next one. D adds a decision.")
}

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

// Frames are the board's sections: a menu to jump to one.
const frames = computed(() => props.store.objects.value.filter((o) => o.kind === "frame"))
const sectionOptions = computed(() =>
	frames.value.map((frame) => ({
		label: frame.name || "Untitled section",
		onClick: () => {
			const box = { x: frame.x, y: frame.y - 28, w: frame.w, h: frame.h + 28 }
			setViewport(
				props.store,
				fitBounds(box, state.value.size, { padding: 48, maxScale: 1.5 }),
			)
			props.store.select([frame.id])
		},
	})),
)

function pickIcon(choice, close) {
	props.controller.placeIcon(choice)
	close()
}

const zoomOptions = computed(() => [
	{ label: "Fit everything", onClick: () => fitView(props.store) },
	{
		label: state.value.minimap ? "Hide the map" : "Show the map",
		onClick: () => (state.value.minimap = !state.value.minimap),
	},
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
		class="absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border border-outline-gray-2 bg-surface-white p-1.5 shadow-lg"
		role="toolbar"
		aria-label="Board tools"
		data-print="hide"
		data-testid="palette"
		@pointerdown.stop
		@dblclick.stop
		@wheel.stop
	>
		<ToolButton
			icon="mouse-pointer"
			title="Select (V)"
			:active="state.tool === 'select'"
			@click="chooseTool('select')"
		/>
		<ToolButton
			icon="move"
			title="Hand (H)"
			:active="state.tool === 'hand'"
			@click="chooseTool('hand')"
		/>
		<Dropdown :options="drawOptions">
			<ToolButton
				:icon="drawTool.icon"
				caret
				title="Draw: pen, highlighter, eraser, laser"
				:active="drawActive"
				data-testid="draw-button"
			/>
		</Dropdown>
		<span class="mx-1 h-6 w-px shrink-0 bg-outline-gray-2" aria-hidden="true" />
		<ToolButton
			icon="lucide-shapes"
			title="Shape library (Shift+S)"
			:active="state.libraryOpen"
			:disabled="readonly"
			data-testid="library-button"
			@click="state.libraryOpen = !state.libraryOpen"
		/>
		<Dropdown :options="shapeOptions" :disabled="readonly">
			<ToolButton
				:icon="shapeTool.icon"
				caret
				title="Shapes"
				:active="shapeActive"
				:disabled="readonly"
			/>
		</Dropdown>
		<Select
			v-if="state.tool === 'polygon'"
			v-model="state.toolOptions.sides"
			class="w-28 shrink-0"
			:options="sideOptions"
			aria-label="Polygon sides"
		/>
		<Dropdown :options="lineOptions" :disabled="readonly">
			<ToolButton
				:icon="lineTool.icon"
				caret
				title="Lines and arrows (L)"
				:active="lineActive"
				:disabled="readonly"
				data-testid="lines-button"
			/>
		</Dropdown>
		<ToolButton
			:icon="TEXT_TOOL.icon"
			title="Text box (T)"
			:active="state.tool === 'text'"
			:disabled="readonly"
			@click="chooseTool('text')"
		/>
		<ToolButton
			icon="lucide-sticky-note"
			title="Sticky note (N)"
			:active="state.tool === 'note'"
			:disabled="readonly"
			data-testid="note-tool"
			@click="chooseTool(state.tool === 'note' ? 'select' : 'note')"
		/>
		<ToolButton
			icon="lucide-network"
			title="New mind map (M)"
			:disabled="readonly"
			data-testid="mindmap-tool"
			@click="newMap"
		/>
		<ToolButton
			icon="lucide-workflow"
			title="New flowchart (Shift+F)"
			:disabled="readonly"
			data-testid="flowchart-tool"
			@click="newFlowchart"
		/>
		<ToolButton
			icon="lucide-frame"
			title="Frame, a named section (F)"
			:active="state.tool === 'frame'"
			:disabled="readonly"
			data-testid="frame-tool"
			@click="chooseTool(state.tool === 'frame' ? 'select' : 'frame')"
		/>
		<ToolButton
			icon="message-square"
			title="Comment (C)"
			:active="state.tool === 'comment'"
			:disabled="!state.canComment"
			data-testid="comment-tool"
			@click="chooseComment"
		/>
		<ToolButton
			icon="image"
			title="Add picture"
			:disabled="readonly"
			data-testid="add-picture"
			@click="picker.click()"
		/>
		<Popover placement="top">
			<template #target="{ togglePopover }">
				<ToolButton
					icon="grid"
					title="Table"
					:active="state.tool === 'table'"
					:disabled="readonly"
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
		<Popover placement="top">
			<template #target="{ togglePopover }">
				<ToolButton
					icon="lucide-smile-plus"
					title="Icons and emoji"
					:disabled="readonly"
					data-testid="icons-button"
					@click="togglePopover()"
				/>
			</template>
			<template #body-main="{ close }">
				<IconPicker @pick="(choice) => pickIcon(choice, close)" />
			</template>
		</Popover>
		<Dropdown v-if="frames.length" :options="sectionOptions">
			<ToolButton
				icon="lucide-locate-fixed"
				caret
				title="Jump to a section"
				data-testid="sections-button"
			/>
		</Dropdown>
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
		<span class="mx-1 h-6 w-px shrink-0 bg-outline-gray-2" aria-hidden="true" />
		<ToolButton
			icon="rotate-ccw"
			title="Undo"
			:disabled="!store.canUndo"
			@click="store.undo()"
		/>
		<ToolButton
			icon="rotate-cw"
			title="Redo"
			:disabled="!store.canRedo"
			@click="store.redo()"
		/>
		<span class="mx-1 h-6 w-px shrink-0 bg-outline-gray-2" aria-hidden="true" />
		<ToolButton icon="minus" title="Zoom out" @click="zoomOut(store)" />
		<Dropdown :options="zoomOptions">
			<ToolButton :label="`${percent}%`" title="Zoom" data-testid="zoom-level" />
		</Dropdown>
		<ToolButton icon="plus" title="Zoom in" @click="zoomIn(store)" />
		<span class="mx-1 h-6 w-px shrink-0 bg-outline-gray-2" aria-hidden="true" />
		<Dropdown :options="settingsOptions" :disabled="readonly" placement="right">
			<ToolButton icon="sliders" title="Canvas settings" :disabled="readonly" />
		</Dropdown>
	</div>
</template>
