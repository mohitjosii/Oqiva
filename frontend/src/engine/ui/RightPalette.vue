<script setup>
// The panel on the right: what can be done to the current selection. It shows the options
// every selected thing supports (interaction/palette.js) and nothing else. Every tile is one
// click and one undo step.
import { Dropdown } from "frappe-ui"
import { computed, onMounted, ref, watch } from "vue"
import { commonValue, availableSections } from "../interaction/palette"
import { MAX_SIDES, MIN_SIDES, runAction, shapeToolOf } from "../interaction/actions"
import { activeCell } from "../interaction/tables"
import { NOTE_COLORS, sanitizeLink } from "../model/schema"
import { SHAPE_TOOLS } from "../model/shapes"
import BarMenu from "./BarMenu.vue"
import ColorSwatches from "./ColorSwatches.vue"
import FontSizeField from "./FontSizeField.vue"
import PaletteTile from "./PaletteTile.vue"

const props = defineProps({
	store: { type: Object, required: true },
	measure: { type: Function, required: true },
	links: { type: Object, default: null }, // {searchBoards(query)} from the page
})

const WIDTHS = [1, 2, 3, 4, 6, 8]
const state = computed(() => props.store.state)
const objects = computed(() => props.store.selectedObjects())
const connectors = computed(() => props.store.selectedConnectors())
const items = computed(() => [...objects.value, ...connectors.value])
const sections = computed(() => availableSections(objects.value, connectors.value))
const visible = computed(
	() => items.value.length > 0 && !state.value.readonly && !state.value.editingId,
)
const has = (name) => sections.value.has(name)

// Spelled out in full so the icon classes are found when the stylesheet is built.
const SHAPE_ICONS = {
	rectangle: "lucide-rectangle-horizontal",
	square: "lucide-square",
	ellipse: "lucide-egg",
	circle: "lucide-circle",
	triangle: "lucide-triangle",
	diamond: "lucide-diamond",
	polygon: "lucide-pentagon",
	arrow: "lucide-arrow-big-right",
	hexagon: "lucide-hexagon",
	trapezoid: "lucide-box",
	cylinder: "lucide-database",
	document: "lucide-file-text",
	cloud: "lucide-cloud",
}

const shapes = computed(() => objects.value.filter((o) => o.kind === "shape"))
// Which kind the selected shapes are (undefined when they differ), and how many sides a polygon has.
const shapeTool = computed(() => commonValue(shapes.value, shapeToolOf))
const polygonSides = computed(() =>
	commonValue(
		shapes.value.filter((o) => o.shape === "polygon"),
		(o) => o.sides,
	),
)
const hasPolygon = computed(() => shapes.value.some((o) => o.shape === "polygon"))
const sideChoices = Array.from({ length: MAX_SIDES - MIN_SIDES + 1 }, (_, i) => {
	const n = MIN_SIDES + i
	return { label: `${n} sides`, value: n }
})
const canCommentHere = computed(
	() => state.value.canComment && items.value.length === 1 && objects.value.length === 1,
)

// ----- link: a web address or another board, on the one selected object -----
const object = computed(() => (objects.value.length === 1 ? objects.value[0] : null))
const link = computed(() => object.value?.link || null)
const urlDraft = ref("")
const urlError = ref("")
const boardQuery = ref("")
const boardResults = ref([])
const pickingBoard = ref(false)
watch(
	() => object.value?.id,
	() => {
		urlDraft.value = ""
		urlError.value = ""
		pickingBoard.value = false
	},
)
function addUrl() {
	const text = urlDraft.value.trim()
	const value = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
	if (!text || !sanitizeLink({ url: value })) {
		urlError.value = "Enter a web address (https://…) or a mail address (mailto:…)."
		return
	}
	urlError.value = ""
	run({ name: "link", value: { url: value } })
	urlDraft.value = ""
}
let searchTimer = null
function searchBoards() {
	clearTimeout(searchTimer)
	searchTimer = setTimeout(async () => {
		boardResults.value = (await props.links?.searchBoards?.(boardQuery.value)) || []
	}, 200)
}
function startBoardPick() {
	pickingBoard.value = true
	boardQuery.value = ""
	searchBoards()
}
function linkBoard(board) {
	run({ name: "link", value: { board: board.name, title: board.title } })
	pickingBoard.value = false
}
const frameName = computed(() => (object.value?.kind === "frame" ? object.value.name : ""))
const nameDraft = ref("")
watch(frameName, (name) => (nameDraft.value = name || ""), { immediate: true })
const noteFill = computed(() => shared((item) => item.style?.fill))

const run = (action) => runAction(props.store, action, { measure: props.measure })
const cell = computed(() => activeCell(props.store))
const cellFill = computed(() => {
	const [object] = objects.value
	return cell.value && object?.table
		? object.table.fills[cell.value.row][cell.value.col]
		: undefined
})
const table = (op, extra = {}) => run({ name: "table", op, ...extra })
const style = (target, value, extra = {}) => run({ name: "style", target, value, ...extra })

// What the selection shares, for showing the current choice.
const shared = (read) => commonValue(items.value, read)
const textual = computed(() => items.value.filter((item) => item.text))
const sharedText = (read) => commonValue(textual.value, read)
const runs = computed(() =>
	textual.value.flatMap((item) => item.text.paragraphs.flatMap((p) => p.runs)),
)
const allRuns = (key) => runs.value.length > 0 && runs.value.every((run) => run[key])

const fill = computed(() => shared((item) => item.style?.fill))
const stroke = computed(() => shared((item) => item.style?.stroke))
const strokeWidth = computed(() => shared((item) => item.style?.strokeWidth))
const dash = computed(() => shared((item) => item.style?.dash))
const opacity = computed(() => shared((item) => item.style?.opacity))
// null follows the board, true is hand-drawn, false is clean; undefined when the selection differs
const sketchValue = computed(() => shared((item) => item.style?.sketch ?? null))
const radius = computed(() => shared((item) => item.style?.radius))
const textColor = computed(() => sharedText((item) => item.text.color))
const textSize = computed(() => sharedText((item) => item.text.size))
const textAlign = computed(() => sharedText((item) => item.text.align))
const geometry = computed(() => shared((item) => item.geometry))
const startHead = computed(() => shared((item) => item.heads?.start))
const endHead = computed(() => shared((item) => item.heads?.end))
const lineOnly = computed(() => objects.value.length === 0)

const alignChoices = [
	["selection", "The selection"],
	["first", "First selected"],
	["last", "Last selected"],
	["canvas", "The canvas"],
]
const alignTarget = computed(() => (objects.value.length < 2 ? "canvas" : state.value.alignTo))
const alignLabel = computed(() => alignChoices.find(([value]) => value === alignTarget.value)[1])
const alignOptions = computed(() =>
	alignChoices
		.filter(([value]) => objects.value.length >= 2 || value === "canvas")
		.map(([value, label]) => ({
			label,
			icon: value === alignTarget.value ? "check" : null,
			onClick: () => (state.value.alignTo = value),
		})),
)

const widthOptions = computed(() =>
	WIDTHS.map((width) => ({
		label: `${width} px`,
		icon: width === strokeWidth.value ? "check" : null,
		onClick: () => style("strokeWidth", width),
	})),
)

// Recent colours live in this browser only: a convenience, never part of the board.
const KEY = "oqiva.recentColors"
onMounted(() => {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) || "[]")
		if (Array.isArray(saved))
			state.value.recentColors = saved.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 8)
	} catch {
		// storage can be blocked; the palette works without it
	}
})
watch(
	() => state.value.recentColors,
	(colors) => {
		try {
			localStorage.setItem(KEY, JSON.stringify(colors))
		} catch {
			// ignore a full or blocked store
		}
	},
	{ deep: true },
)

const percent = (value) => (typeof value === "number" ? Math.round(value * 100) : 100)
</script>

<template>
	<div
		v-if="visible"
		class="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-20rem)] -translate-x-1/2 items-center gap-0.5 rounded-xl border border-outline-gray-2 bg-surface-white p-1.5 text-sm shadow-lg"
		role="toolbar"
		aria-label="Selection options"
		data-testid="right-palette"
		data-print="hide"
		@pointerdown.stop
		@pointerup.stop
		@dblclick.stop
		@wheel.stop
		@contextmenu.stop
	>
		<BarMenu v-if="has('shapeType')" label="Shape" icon="lucide-shapes">
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">Shape</h3>
			<div class="flex flex-wrap gap-0.5" data-testid="shape-types">
				<PaletteTile
					v-for="tool in SHAPE_TOOLS"
					:key="tool.id"
					:icon="SHAPE_ICONS[tool.id]"
					:title="`Make it a ${tool.label.toLowerCase()}`"
					:active="shapeTool === tool.id"
					:testid="`shape-${tool.id}`"
					@click="run({ name: 'shape', tool: tool.id })"
				/>
			</div>
			<div v-if="hasPolygon" class="mt-1.5">
				<Dropdown
					:options="
						sideChoices.map((c) => ({
							label: c.label,
							icon: c.value === polygonSides ? 'check' : null,
							onClick: () => run({ name: 'sides', value: c.value }),
						}))
					"
				>
					<button
						type="button"
						class="whitespace-nowrap rounded border border-outline-gray-2 px-2 py-0.5 text-xs text-ink-gray-8 hover:bg-surface-gray-2"
						data-testid="polygon-sides"
					>
						{{ polygonSides === undefined ? "Mixed" : `${polygonSides} sides` }}
					</button>
				</Dropdown>
			</div>
		</BarMenu>

		<BarMenu
			v-if="has('noteColor')"
			label="Note colour"
			icon="lucide-sticky-note"
			:swatch="noteFill"
		>
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">Note colour</h3>
			<div class="flex flex-wrap gap-1" data-testid="note-colors">
				<button
					v-for="c in NOTE_COLORS"
					:key="c.name"
					type="button"
					class="h-6 w-6 rounded border border-outline-gray-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
					:class="noteFill === c.fill ? 'ring-2 ring-outline-gray-5 ring-offset-1' : ''"
					:style="{ backgroundColor: c.fill }"
					:title="`${c.name} note`"
					:aria-label="`${c.name} note`"
					:aria-pressed="noteFill === c.fill"
					@click="style('fill', c.fill)"
				/>
			</div>
		</BarMenu>

		<BarMenu v-if="has('frameName')" label="Section name" icon="lucide-frame">
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">Section name</h3>
			<input
				v-model="nameDraft"
				type="text"
				maxlength="200"
				class="w-full rounded-md border border-outline-gray-2 bg-surface-white px-2 py-1 text-sm text-ink-gray-9 focus:border-outline-gray-4 focus:outline-none"
				aria-label="Section name"
				data-testid="frame-name"
				@keydown.stop
				@change="run({ name: 'frameName', value: nameDraft })"
			/>
		</BarMenu>

		<BarMenu v-if="has('link')" label="Link" icon="lucide-link">
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">Link</h3>
			<div v-if="link" class="flex items-center gap-1" data-testid="link-current">
				<span class="min-w-0 flex-1 truncate text-xs text-ink-gray-8">{{
					link.url || link.title || link.board
				}}</span>
				<button
					type="button"
					class="rounded px-1.5 py-0.5 text-xs text-blue-700 hover:bg-surface-gray-2"
					data-testid="link-remove"
					@click="run({ name: 'link', value: null })"
				>
					Remove
				</button>
			</div>
			<template v-else>
				<form class="flex gap-1" @submit.prevent="addUrl">
					<input
						v-model="urlDraft"
						type="text"
						class="min-w-0 flex-1 rounded-md border border-outline-gray-2 bg-surface-white px-2 py-1 text-xs text-ink-gray-9 placeholder:text-ink-gray-4 focus:border-outline-gray-4 focus:outline-none"
						placeholder="https://…"
						aria-label="Link address"
						data-testid="link-url"
						@keydown.stop
					/>
					<button
						type="submit"
						class="rounded-md border border-outline-gray-2 px-2 text-xs text-ink-gray-8 hover:bg-surface-gray-2"
						data-testid="link-add"
					>
						Add
					</button>
				</form>
				<p v-if="urlError" class="mt-1 text-xs text-red-600" role="alert">{{ urlError }}</p>
				<button
					v-if="links && !pickingBoard"
					type="button"
					class="mt-1 text-xs text-blue-700 hover:underline"
					data-testid="link-board"
					@click="startBoardPick"
				>
					Or link to another board
				</button>
				<div v-if="pickingBoard" class="mt-1" data-testid="board-picker">
					<input
						v-model="boardQuery"
						type="search"
						class="w-full rounded-md border border-outline-gray-2 bg-surface-white px-2 py-1 text-xs text-ink-gray-9 placeholder:text-ink-gray-4 focus:border-outline-gray-4 focus:outline-none"
						placeholder="Search boards"
						aria-label="Search boards"
						@keydown.stop
						@input="searchBoards"
					/>
					<ul class="mt-1 max-h-32 overflow-y-auto">
						<li v-for="b in boardResults" :key="b.name">
							<button
								type="button"
								class="w-full truncate rounded px-1.5 py-1 text-left text-xs text-ink-gray-8 hover:bg-surface-gray-2"
								@click="linkBoard(b)"
							>
								{{ b.title }}
							</button>
						</li>
						<li v-if="!boardResults.length" class="px-1.5 py-1 text-xs text-ink-gray-5">
							{{
								boardQuery.trim().length < 2
									? "Type two letters to search."
									: "No boards found."
							}}
						</li>
					</ul>
				</div>
			</template>
		</BarMenu>

		<div v-if="canCommentHere" aria-label="Comment">
			<PaletteTile
				icon="lucide-message-square"
				title="Add a comment to this"
				testid="add-comment"
				@click="run({ name: 'comment' })"
			/>
		</div>

		<BarMenu v-if="has('arrange')" label="Arrange" icon="lucide-layers">
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">Arrange</h3>
			<div class="flex flex-wrap gap-0.5">
				<PaletteTile
					icon="lucide-bring-to-front"
					title="Bring to front"
					testid="front"
					@click="run({ name: 'arrange', mode: 'front' })"
				/>
				<PaletteTile
					icon="lucide-move-up"
					title="Bring forward"
					testid="forward"
					@click="run({ name: 'arrange', mode: 'forward' })"
				/>
				<PaletteTile
					icon="lucide-move-down"
					title="Send backward"
					testid="backward"
					@click="run({ name: 'arrange', mode: 'backward' })"
				/>
				<PaletteTile
					icon="lucide-send-to-back"
					title="Send to back"
					testid="back"
					@click="run({ name: 'arrange', mode: 'back' })"
				/>
				<PaletteTile
					v-if="has('group')"
					icon="lucide-group"
					title="Group"
					testid="group"
					@click="run({ name: 'group' })"
				/>
				<PaletteTile
					v-if="has('ungroup')"
					icon="lucide-ungroup"
					title="Ungroup"
					testid="ungroup"
					@click="run({ name: 'ungroup' })"
				/>
			</div>
		</BarMenu>

		<BarMenu v-if="has('align')" label="Align" icon="lucide-align-center-vertical">
			<div class="mb-1 flex items-center justify-between">
				<h3 class="text-xs font-medium text-ink-gray-6">Align to</h3>
				<Dropdown :options="alignOptions">
					<button
						type="button"
						class="rounded px-1.5 py-0.5 text-xs text-ink-gray-8 hover:bg-surface-gray-2"
						data-testid="align-target"
					>
						{{ alignLabel }}
					</button>
				</Dropdown>
			</div>
			<div class="flex flex-wrap gap-0.5">
				<PaletteTile
					icon="lucide-align-start-vertical"
					title="Align left"
					testid="align-left"
					@click="run({ name: 'align', mode: 'left' })"
				/>
				<PaletteTile
					icon="lucide-align-center-vertical"
					title="Align centre"
					testid="align-center"
					@click="run({ name: 'align', mode: 'center' })"
				/>
				<PaletteTile
					icon="lucide-align-end-vertical"
					title="Align right"
					testid="align-right"
					@click="run({ name: 'align', mode: 'right' })"
				/>
				<PaletteTile
					icon="lucide-align-start-horizontal"
					title="Align top"
					testid="align-top"
					@click="run({ name: 'align', mode: 'top' })"
				/>
				<PaletteTile
					icon="lucide-align-center-horizontal"
					title="Align middle"
					testid="align-middle"
					@click="run({ name: 'align', mode: 'middle' })"
				/>
				<PaletteTile
					icon="lucide-align-end-horizontal"
					title="Align bottom"
					testid="align-bottom"
					@click="run({ name: 'align', mode: 'bottom' })"
				/>
			</div>
		</BarMenu>

		<BarMenu
			v-if="has('removeGaps') || has('size') || has('swap')"
			label="Space and size"
			icon="lucide-move-horizontal"
			wide
		>
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">Space and size</h3>
			<div class="flex flex-wrap gap-0.5">
				<PaletteTile
					v-if="has('distribute')"
					icon="lucide-align-horizontal-distribute-center"
					title="Space evenly, across"
					testid="distribute-h"
					@click="run({ name: 'distribute', axis: 'horizontal' })"
				/>
				<PaletteTile
					v-if="has('distribute')"
					icon="lucide-align-vertical-distribute-center"
					title="Space evenly, down"
					testid="distribute-v"
					@click="run({ name: 'distribute', axis: 'vertical' })"
				/>
				<PaletteTile
					v-if="has('removeGaps')"
					icon="lucide-fold-horizontal"
					title="Remove gaps, across"
					testid="gaps-h"
					@click="run({ name: 'removeGaps', axis: 'horizontal' })"
				/>
				<PaletteTile
					v-if="has('removeGaps')"
					icon="lucide-fold-vertical"
					title="Remove gaps, down"
					testid="gaps-v"
					@click="run({ name: 'removeGaps', axis: 'vertical' })"
				/>
				<PaletteTile
					v-if="has('size')"
					icon="lucide-move-horizontal"
					title="Same width"
					testid="same-width"
					@click="run({ name: 'sameSize', dimension: 'width' })"
				/>
				<PaletteTile
					v-if="has('size')"
					icon="lucide-move-vertical"
					title="Same height"
					testid="same-height"
					@click="run({ name: 'sameSize', dimension: 'height' })"
				/>
				<PaletteTile
					v-if="has('size')"
					icon="lucide-scaling"
					title="Same width and height"
					testid="same-both"
					@click="run({ name: 'sameSize', dimension: 'both' })"
				/>
				<PaletteTile
					v-if="has('swap')"
					icon="lucide-arrow-left-right"
					title="Swap positions"
					testid="swap"
					@click="run({ name: 'swap' })"
				/>
			</div>
		</BarMenu>

		<BarMenu v-if="has('transform')" label="Rotate and flip" icon="lucide-rotate-cw">
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">Rotate and flip</h3>
			<div class="flex flex-wrap gap-0.5">
				<PaletteTile
					icon="lucide-rotate-ccw-square"
					title="Rotate 90° left"
					testid="rotate-left"
					@click="run({ name: 'rotate', degrees: -90 })"
				/>
				<PaletteTile
					icon="lucide-rotate-cw-square"
					title="Rotate 90° right"
					testid="rotate-right"
					@click="run({ name: 'rotate', degrees: 90 })"
				/>
				<PaletteTile
					v-if="has('flip')"
					icon="lucide-flip-horizontal"
					title="Flip horizontally"
					testid="flip-h"
					@click="run({ name: 'flip', axis: 'horizontal' })"
				/>
				<PaletteTile
					v-if="has('flip')"
					icon="lucide-flip-vertical"
					title="Flip vertically"
					testid="flip-v"
					@click="run({ name: 'flip', axis: 'vertical' })"
				/>
			</div>
		</BarMenu>

		<BarMenu v-if="has('line')" label="Line" icon="lucide-spline" :swatch="stroke" wide>
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">Line</h3>
			<div class="flex flex-wrap gap-0.5">
				<PaletteTile
					icon="lucide-minus"
					title="Straight"
					:active="geometry === 'straight'"
					testid="geometry-straight"
					@click="style('geometry', 'straight')"
				/>
				<PaletteTile
					icon="lucide-corner-down-right"
					title="Elbow"
					:active="geometry === 'elbow'"
					testid="geometry-elbow"
					@click="style('geometry', 'elbow')"
				/>
				<PaletteTile
					icon="lucide-spline"
					title="Curved"
					:active="geometry === 'curved'"
					testid="geometry-curved"
					@click="style('geometry', 'curved')"
				/>
			</div>
			<div v-if="lineOnly" class="mt-1 flex items-center gap-1 text-xs text-ink-gray-6">
				<span class="w-9">Start</span>
				<PaletteTile
					label="None"
					title="No start arrowhead"
					:active="startHead === 'none'"
					testid="start-none"
					@click="style('heads', { start: 'none' })"
				/>
				<PaletteTile
					label="Arrow"
					title="Arrowhead at the start"
					:active="startHead === 'arrow'"
					testid="start-arrow"
					@click="style('heads', { start: 'arrow' })"
				/>
				<PaletteTile
					label="Dot"
					title="Dot at the start"
					:active="startHead === 'dot'"
					testid="start-dot"
					@click="style('heads', { start: 'dot' })"
				/>
			</div>
			<div v-if="lineOnly" class="mt-1 flex items-center gap-1 text-xs text-ink-gray-6">
				<span class="w-9">End</span>
				<PaletteTile
					label="None"
					title="No end arrowhead"
					:active="endHead === 'none'"
					testid="end-none"
					@click="style('heads', { end: 'none' })"
				/>
				<PaletteTile
					label="Arrow"
					title="Arrowhead at the end"
					:active="endHead === 'arrow'"
					testid="end-arrow"
					@click="style('heads', { end: 'arrow' })"
				/>
				<PaletteTile
					label="Dot"
					title="Dot at the end"
					:active="endHead === 'dot'"
					testid="end-dot"
					@click="style('heads', { end: 'dot' })"
				/>
			</div>
		</BarMenu>

		<BarMenu v-if="has('table')" label="Table" icon="lucide-table" wide>
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">
				Table{{ cell ? ` · row ${cell.row + 1}, column ${cell.col + 1}` : "" }}
			</h3>
			<div class="flex flex-wrap gap-0.5">
				<PaletteTile
					icon="lucide-between-horizontal-start"
					title="Add row above"
					testid="row-above"
					@click="table('rowAbove')"
				/>
				<PaletteTile
					icon="lucide-between-horizontal-end"
					title="Add row below"
					testid="row-below"
					@click="table('rowBelow')"
				/>
				<PaletteTile
					icon="lucide-between-vertical-start"
					title="Add column left"
					testid="col-left"
					@click="table('colLeft')"
				/>
				<PaletteTile
					icon="lucide-between-vertical-end"
					title="Add column right"
					testid="col-right"
					@click="table('colRight')"
				/>
				<PaletteTile
					icon="lucide-rows-3"
					title="Delete row"
					testid="row-delete"
					@click="table('removeRow')"
				/>
				<PaletteTile
					icon="lucide-columns-3"
					title="Delete column"
					testid="col-delete"
					@click="table('removeColumn')"
				/>
			</div>
			<p class="mb-1 mt-2 text-xs text-ink-gray-5">
				{{ cell ? "Chosen cell" : "All cells (click a cell to choose one)" }}
			</p>
			<div class="mb-1 flex flex-wrap items-center gap-0.5">
				<PaletteTile
					icon="lucide-bold"
					title="Bold cell text"
					testid="cell-bold"
					@click="table('text', { target: 'bold', value: true })"
				/>
				<PaletteTile
					icon="lucide-italic"
					title="Italic cell text"
					testid="cell-italic"
					@click="table('text', { target: 'italic', value: true })"
				/>
				<PaletteTile
					icon="lucide-underline"
					title="Underline cell text"
					testid="cell-underline"
					@click="table('text', { target: 'underline', value: true })"
				/>
				<PaletteTile
					icon="lucide-align-left"
					title="Cell text left"
					testid="cell-left"
					@click="table('text', { target: 'textAlign', value: 'left' })"
				/>
				<PaletteTile
					icon="lucide-align-center"
					title="Cell text centre"
					testid="cell-center"
					@click="table('text', { target: 'textAlign', value: 'center' })"
				/>
				<PaletteTile
					icon="lucide-align-right"
					title="Cell text right"
					testid="cell-right"
					@click="table('text', { target: 'textAlign', value: 'right' })"
				/>
			</div>
			<p class="mb-1 text-xs text-ink-gray-5">Cell fill</p>
			<ColorSwatches
				name="cellFill"
				:model-value="cellFill"
				:recent="state.recentColors"
				allow-none
				none-label="No fill"
				@pick="(c) => table('fill', { value: c, recent: true })"
			/>
			<p class="mb-1 mt-2 text-xs text-ink-gray-5">Cell text colour</p>
			<ColorSwatches
				name="cellText"
				:model-value="undefined"
				:recent="state.recentColors"
				@pick="(c) => table('text', { target: 'textColor', value: c, recent: true })"
			/>
		</BarMenu>

		<BarMenu v-if="has('fill')" label="Fill" icon="lucide-paint-bucket" :swatch="fill" wide>
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">Fill</h3>
			<ColorSwatches
				name="fill"
				:model-value="fill"
				:recent="state.recentColors"
				allow-none
				none-label="No fill"
				@pick="(c) => style('fill', c, { recent: true })"
			/>
		</BarMenu>

		<BarMenu v-if="has('border')" label="Border" icon="lucide-square" :swatch="stroke" wide>
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">
				{{ lineOnly ? "Line colour" : "Border" }}
			</h3>
			<ColorSwatches
				name="stroke"
				:model-value="stroke"
				:recent="state.recentColors"
				@pick="(c) => style('stroke', c, { recent: true })"
			/>
			<div class="mt-1.5 flex flex-wrap items-center gap-1">
				<Dropdown :options="widthOptions">
					<button
						type="button"
						class="whitespace-nowrap rounded border border-outline-gray-2 px-2 py-0.5 text-xs text-ink-gray-8 hover:bg-surface-gray-2"
						data-testid="stroke-width"
					>
						{{ strokeWidth === undefined ? "Mixed" : `${strokeWidth} px` }}
					</button>
				</Dropdown>
				<PaletteTile
					label="Solid"
					title="Solid line"
					:active="dash === 'solid'"
					testid="dash-solid"
					@click="style('dash', 'solid')"
				/>
				<PaletteTile
					label="Dashed"
					title="Dashed line"
					:active="dash === 'dashed'"
					testid="dash-dashed"
					@click="style('dash', 'dashed')"
				/>
				<PaletteTile
					label="Dotted"
					title="Dotted line"
					:active="dash === 'dotted'"
					testid="dash-dotted"
					@click="style('dash', 'dotted')"
				/>
			</div>
		</BarMenu>

		<BarMenu
			v-if="has('text') && textual.length"
			label="Text"
			icon="lucide-type"
			:swatch="textColor"
			wide
		>
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">Text</h3>
			<div class="mb-1 flex flex-wrap items-center gap-0.5">
				<FontSizeField
					:model-value="textSize === undefined ? null : textSize"
					@update:model-value="(size) => style('textSize', size)"
				/>
				<PaletteTile
					icon="lucide-bold"
					title="Bold"
					:active="allRuns('b')"
					testid="bold"
					@click="style('bold', !allRuns('b'))"
				/>
				<PaletteTile
					icon="lucide-italic"
					title="Italic"
					:active="allRuns('i')"
					testid="italic"
					@click="style('italic', !allRuns('i'))"
				/>
				<PaletteTile
					icon="lucide-underline"
					title="Underline"
					:active="allRuns('u')"
					testid="underline"
					@click="style('underline', !allRuns('u'))"
				/>
				<PaletteTile
					icon="lucide-align-left"
					title="Text left"
					:active="textAlign === 'left'"
					testid="text-left"
					@click="style('textAlign', 'left')"
				/>
				<PaletteTile
					icon="lucide-align-center"
					title="Text centre"
					:active="textAlign === 'center'"
					testid="text-center"
					@click="style('textAlign', 'center')"
				/>
				<PaletteTile
					icon="lucide-align-right"
					title="Text right"
					:active="textAlign === 'right'"
					testid="text-right"
					@click="style('textAlign', 'right')"
				/>
			</div>
			<ColorSwatches
				name="textColor"
				:model-value="textColor"
				:recent="state.recentColors"
				@pick="(c) => style('textColor', c, { recent: true })"
			/>
		</BarMenu>

		<BarMenu v-if="has('sketch')" label="Hand-drawn style" icon="lucide-pencil-ruler">
			<h3 class="mb-1 text-xs font-medium text-ink-gray-6">Outline style</h3>
			<div class="flex flex-col gap-1" data-testid="sketch-options">
				<button
					v-for="[label, value] in [
						['Same as the board', null],
						['Hand-drawn', true],
						['Clean', false],
					]"
					:key="label"
					type="button"
					class="rounded-md border border-outline-gray-2 px-2 py-1 text-left text-xs text-ink-gray-8 hover:bg-surface-gray-2"
					:class="sketchValue === value ? 'bg-surface-gray-3 font-semibold' : ''"
					:data-testid="`sketch-${value === null ? 'board' : value ? 'on' : 'off'}`"
					@click="style('sketch', value)"
				>
					{{ label }}
				</button>
			</div>
		</BarMenu>

		<BarMenu v-if="has('opacity')" label="Transparency" icon="lucide-blend">
			<label
				class="mb-1 flex items-center justify-between text-xs font-medium text-ink-gray-6"
				for="oqiva-opacity"
			>
				<span>Opacity</span>
				<span data-testid="opacity-value">{{
					opacity === undefined ? "Mixed" : `${percent(opacity)}%`
				}}</span>
			</label>
			<input
				id="oqiva-opacity"
				type="range"
				min="10"
				max="100"
				step="5"
				class="w-full accent-gray-700"
				:value="percent(opacity)"
				data-testid="opacity"
				@input="
					style('opacity', Number($event.target.value) / 100, { coalesce: 'opacity' })
				"
			/>
		</BarMenu>

		<BarMenu v-if="has('radius')" label="Corner radius" icon="lucide-square-round-corner">
			<label
				class="mb-1 flex items-center justify-between text-xs font-medium text-ink-gray-6"
				for="oqiva-radius"
			>
				<span>Corner radius</span>
				<span data-testid="radius-value">{{
					radius === undefined ? "Mixed" : radius
				}}</span>
			</label>
			<input
				id="oqiva-radius"
				type="range"
				min="0"
				max="60"
				step="2"
				class="w-full accent-gray-700"
				:value="radius ?? 0"
				data-testid="radius"
				@input="style('radius', Number($event.target.value), { coalesce: 'radius' })"
			/>
		</BarMenu>

		<div v-if="items.length === 1" aria-label="Format painter">
			<PaletteTile
				icon="lucide-paintbrush-vertical"
				title="Copy this format, then click another object"
				:active="Boolean(state.painter)"
				testid="painter"
				@click="run({ name: 'painter' })"
			/>
		</div>
	</div>
</template>
