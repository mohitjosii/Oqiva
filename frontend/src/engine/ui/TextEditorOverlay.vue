<script setup>
// Edits an object's text in place. A Tiptap editor is laid exactly over the shape (same
// position, rotation and zoom), with a small formatting bar above it. Typing is a live
// gesture, so the whole edit is one undo step, and a shape grows to keep its text inside.
import StarterKit from "@tiptap/starter-kit"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import { Editor, EditorContent } from "@tiptap/vue-3"
import { Button, Dropdown } from "frappe-ui"
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue"
import { objectBounds } from "../geometry/bounds"
import { toScreen } from "../geometry/viewport"
import { themeOf } from "../model/themes"
import { textArea } from "../model/shapes"
import { autoHeight } from "../text/fit"
import { emptyText } from "../model/factories"
import { CELL_PADDING, cellRect, growRow, setCellText, withTable } from "../store/tableOps"
import { fromProseMirror, isEmptyText, toProseMirror } from "../text/richText"

const props = defineProps({
	store: { type: Object, required: true },
	measure: { type: Function, required: true },
})

const SIZES = [12, 14, 16, 18, 20, 24, 32, 48, 64]
const SWATCHES = [
	["Default", null],
	["Black", "#111827"],
	["Red", "#DC2626"],
	["Orange", "#EA580C"],
	["Green", "#16A34A"],
	["Blue", "#2563EB"],
	["Violet", "#7C3AED"],
]

const editor = shallowRef(null)
const tick = ref(0) // bumps on every editor transaction so active states re-read
const session = reactive({
	id: null,
	cell: null,
	base: { align: "center", size: 16, color: "#111111" },
})
let gesture = null

const state = computed(() => props.store.state)
const object = computed(() => (session.id ? props.store.getObject(session.id) : null))
const scale = computed(() => state.value.viewport.scale)

const frameStyle = computed(() => {
	const o = object.value
	if (!o) return {}
	const p = toScreen(state.value.viewport, o)
	return {
		left: `${p.x}px`,
		top: `${p.y}px`,
		width: `${o.w * scale.value}px`,
		height: `${o.h * scale.value}px`,
		transform: `rotate(${o.rotation || 0}deg)`,
		transformOrigin: "center",
	}
})

// Where the text goes: the shape's text area, or the chosen cell of a table.
const areaOf = (o) => {
	if (!session.cell) return textArea(o)
	const rect = cellRect(o.table, session.cell.row, session.cell.col)
	return {
		x: rect.x + CELL_PADDING.x,
		y: rect.y + CELL_PADDING.y,
		w: Math.max(10, rect.w - CELL_PADDING.x * 2),
		h: Math.max(10, rect.h - CELL_PADDING.y * 2),
	}
}

const areaStyle = computed(() => {
	const o = object.value
	if (!o) return {}
	const area = areaOf(o)
	return {
		left: `${area.x * scale.value}px`,
		top: `${area.y * scale.value}px`,
		width: `${area.w * scale.value}px`,
		height: `${area.h * scale.value}px`,
		fontSize: `${session.base.size * scale.value}px`,
		lineHeight: 1.3,
		textAlign: session.base.align,
		color: session.base.color,
		justifyContent: o.kind === "text" && !session.cell ? "flex-start" : "center",
		fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
	}
})

const toolbarStyle = computed(() => {
	const o = object.value
	if (!o) return {}
	const box = objectBounds(o)
	const top = toScreen(state.value.viewport, { x: box.x, y: box.y })
	const middle = top.x + (box.w * scale.value) / 2
	const half = 190
	return {
		left: `${Math.min(Math.max(middle, half), Math.max(half, state.value.size.width - half))}px`,
		top: `${Math.max(8, top.y - 50)}px`,
		transform: "translateX(-50%)",
	}
})

const active = (name) => (void tick.value, editor.value?.isActive(name) ?? false)
const markColor = computed(
	() => (void tick.value, editor.value?.getAttributes("textStyle")?.color || null),
)

function currentText() {
	return fromProseMirror(editor.value.getJSON(), session.base)
}

// Pushes what has been typed into the board, growing the shape if the text needs room.
function syncCell(text) {
	const current = props.store.getObject(session.id)
	if (!current?.table) return
	const { row, col } = session.cell
	const table = growRow(
		setCellText(current.table, row, col, isEmptyText(text) ? null : text),
		row,
		props.measure,
	)
	gesture.set([{ id: session.id, patch: withTable(table) }])
}

function sync() {
	if (!editor.value || !gesture) return
	const text = currentText()
	if (session.cell) return syncCell(text)
	const current = props.store.getObject(session.id)
	if (!current) return
	const height = autoHeight({ ...current, text }, props.measure, text)
	gesture.set([{ id: session.id, patch: { text, ...(height ? { h: height } : {}) } }])
}

function begin(id) {
	if (props.store.getConnector(id)) return // a line's label has its own editor
	const target = props.store.getObject(id)
	if (!target || state.value.readonly) {
		state.value.editingId = null
		return
	}
	const theme = themeOf(props.store.theme.value.preset)
	const cell = target.kind === "table" ? state.value.editingCell || { row: 0, col: 0 } : null
	if (target.kind === "table" && !cell) return
	session.id = id
	session.cell = cell
	const source = cell ? target.table.cells[cell.row]?.[cell.col] : target.text
	session.base = {
		align: source?.align || (target.kind === "text" || cell ? "left" : "center"),
		size: source?.size || 16,
		color: source?.color || theme.text,
	}
	if (cell) state.value.tableCell = { id, ...cell }
	gesture = props.store.beginGesture([id])
	editor.value = new Editor({
		extensions: [
			StarterKit.configure({
				heading: false,
				bulletList: false,
				orderedList: false,
				listItem: false,
				listKeymap: false,
				blockquote: false,
				codeBlock: false,
				code: false,
				horizontalRule: false,
				strike: false,
				link: false,
				dropcursor: false,
				gapcursor: false,
			}),
			TextStyle,
			Color,
		],
		content: toProseMirror(
			cell ? (target.table.cells[cell.row]?.[cell.col] ?? null) : target.text,
		),
		onUpdate: sync,
		onTransaction: () => tick.value++,
	})
	nextTick(() => editor.value?.commands.focus("end"))
}

function finish() {
	const ended = editor.value
	if (!ended || !gesture) return
	const target = props.store.getObject(session.id)
	let text = currentText()
	const empty = isEmptyText(text)
	if (session.cell) {
		syncCell(text)
		gesture.commit("Edit cell")
	} else if (target?.kind === "text" && empty) {
		// An empty text box is not worth keeping. If it was only just created, forget it entirely.
		gesture.cancel()
		if (state.value.editingNew) props.store.discardLastStep()
		else props.store.removeObjects([session.id], { label: "Delete empty text box" })
	} else if (target) {
		if (empty) text = null
		const height = autoHeight({ ...target, text }, props.measure, text)
		gesture.set([{ id: session.id, patch: { text, ...(height ? { h: height } : {}) } }])
		gesture.commit("Edit text")
	}
	gesture = null
	ended.destroy()
	editor.value = null
	session.id = null
	session.cell = null
	state.value.editingNew = false
}

watch(
	() => [state.value.editingId, state.value.editingCell?.row, state.value.editingCell?.col],
	([id]) => {
		if (session.id) finish()
		if (id) begin(id)
		else state.value.editingCell = null
	},
	{ immediate: true },
)
onBeforeUnmount(() => session.id && finish())

const stop = () => (state.value.editingId = null)

// Tab and Shift+Tab walk through a table's cells, left to right and top to bottom.
function nextCell(backwards) {
	const o = object.value
	if (!session.cell || !o?.table) return
	const cols = o.table.colW.length
	const rows = o.table.rowH.length
	const at = session.cell.row * cols + session.cell.col + (backwards ? -1 : 1)
	const wrapped = (at + rows * cols) % (rows * cols)
	state.value.editingCell = { row: Math.floor(wrapped / cols), col: wrapped % cols }
}
const toggle = (command) => editor.value.chain().focus()[command]().run()
const setColor = (color) =>
	color
		? editor.value.chain().focus().setColor(color).run()
		: editor.value.chain().focus().unsetColor().run()

function setBase(patch) {
	Object.assign(session.base, patch)
	sync()
	editor.value?.commands.focus()
}

const sizeOptions = computed(() =>
	SIZES.map((size) => ({
		label: `${size}`,
		icon: size === session.base.size ? "check" : null,
		onClick: () => setBase({ size }),
	})),
)
</script>

<template>
	<div
		v-if="object && editor"
		class="pointer-events-none absolute inset-0"
		data-testid="text-editor"
	>
		<div
			class="pointer-events-auto absolute z-20 flex items-center gap-0.5 rounded-lg border border-outline-gray-2 bg-surface-white p-1 shadow-lg"
			:style="toolbarStyle"
			role="toolbar"
			aria-label="Text formatting"
			@mousedown.prevent
			@pointerdown.stop
			@dblclick.stop
		>
			<Button
				icon="bold"
				size="sm"
				:variant="active('bold') ? 'subtle' : 'ghost'"
				title="Bold"
				:aria-pressed="active('bold')"
				@click="toggle('toggleBold')"
			/>
			<Button
				icon="italic"
				size="sm"
				:variant="active('italic') ? 'subtle' : 'ghost'"
				title="Italic"
				:aria-pressed="active('italic')"
				@click="toggle('toggleItalic')"
			/>
			<Button
				icon="underline"
				size="sm"
				:variant="active('underline') ? 'subtle' : 'ghost'"
				title="Underline"
				:aria-pressed="active('underline')"
				@click="toggle('toggleUnderline')"
			/>
			<span class="mx-1 h-5 w-px bg-outline-gray-2" aria-hidden="true" />
			<button
				v-for="[name, value] in SWATCHES"
				:key="name"
				type="button"
				class="h-5 w-5 rounded-full border border-outline-gray-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
				:class="
					(markColor || null) === value ? 'ring-2 ring-outline-gray-5 ring-offset-1' : ''
				"
				:style="{ backgroundColor: value || session.base.color }"
				:title="`${name} text`"
				:aria-label="`${name} text`"
				@click="setColor(value)"
			/>
			<span class="mx-1 h-5 w-px bg-outline-gray-2" aria-hidden="true" />
			<Dropdown :options="sizeOptions">
				<Button
					size="sm"
					variant="ghost"
					:label="`${session.base.size}`"
					iconRight="chevron-down"
				/>
			</Dropdown>
			<Button
				icon="align-left"
				size="sm"
				:variant="session.base.align === 'left' ? 'subtle' : 'ghost'"
				title="Align left"
				:aria-pressed="session.base.align === 'left'"
				@click="setBase({ align: 'left' })"
			/>
			<Button
				icon="align-center"
				size="sm"
				:variant="session.base.align === 'center' ? 'subtle' : 'ghost'"
				title="Align centre"
				:aria-pressed="session.base.align === 'center'"
				@click="setBase({ align: 'center' })"
			/>
			<Button
				icon="align-right"
				size="sm"
				:variant="session.base.align === 'right' ? 'subtle' : 'ghost'"
				title="Align right"
				:aria-pressed="session.base.align === 'right'"
				@click="setBase({ align: 'right' })"
			/>
		</div>
		<div
			class="pointer-events-auto absolute"
			:style="frameStyle"
			@pointerdown.stop
			@pointerup.stop
			@dblclick.stop
			@contextmenu.stop
		>
			<div
				class="oqiva-text-editor absolute flex flex-col overflow-visible"
				:style="areaStyle"
				@keydown.esc.stop.prevent="stop"
				@keydown.tab.stop.prevent="nextCell($event.shiftKey)"
			>
				<EditorContent :editor="editor" />
			</div>
		</div>
	</div>
</template>
