<script setup>
// The outline of a mind map: its nodes as an indented, editable list. It is only a different view
// of the same tree, so there is nothing to keep in step: every edit here is the same step as on
// the map, and the map and the list both redraw from the store.
import { Button } from "frappe-ui"
import { computed, nextTick, reactive, watch } from "vue"
import { applyChange } from "../modes/mindmap/storeOps"
import { toOutline } from "../modes/mindmap/outline"
import { demote, promote, setText } from "../modes/mindmap/tree"

const props = defineProps({
	store: { type: Object, required: true },
	controller: { type: Object, required: true },
})

const state = computed(() => props.store.state)
// The map of the selected node; with nothing selected, the first map on the board.
const map = computed(() => {
	const [node] = props.store.selectedNodes()
	return (node && props.store.getMap(node.mapId)) || props.store.maps.value[0] || null
})
const rows = computed(() =>
	map.value ? toOutline(props.store.nodesOfMap(map.value.id), map.value.rootId) : [],
)
const editable = computed(() => !state.value.readonly)
const selected = computed(() => new Set(state.value.selection))

watch(
	() => state.value.outlineOpen,
	(open) => {
		if (open) {
			state.value.commentsOpen = false
			state.value.libraryOpen = false
		}
	},
	{ immediate: true },
)

// Puts the cursor in a row, waiting a moment if the row has not been drawn yet (a node just made).
function focusRow(id, tries = 20) {
	nextTick(() => {
		const input = document.querySelector(`[data-outline-id="${id}"]`)
		if (input) input.focus()
		else if (tries) setTimeout(() => focusRow(id, tries - 1), 30)
	})
}

// What is being typed in a row. The input shows this while the row is being edited, because the
// store still holds the old text until Enter or a click away (the field would be reset otherwise).
const drafts = reactive({})
const shown = (row) => (row.id in drafts ? drafts[row.id] : row.text)

function commit(row, event) {
	const text = event.target.value
	delete drafts[row.id]
	state.value.nodeDraft = null
	if (text === row.text || !map.value) return
	applyChange(
		props.store,
		map.value.id,
		setText(props.store.nodesOfMap(map.value.id), row.id, text),
		{
			label: "Edit node",
			select: row.id,
			selectUndo: [row.id],
		},
	)
}
function typing(row, event) {
	drafts[row.id] = event.target.value
	state.value.nodeDraft = { id: row.id, text: event.target.value }
}

async function key(row, event, index) {
	if (!editable.value) return
	const id = row.id
	props.store.select([id])
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault()
		commit(row, event)
		// the new node is selected; the outline edits it, not the map
		const ok = await props.controller.mapCommand({
			name: row.depth ? "mm.sibling" : "mm.child",
			noEdit: true,
		})
		if (ok) focusRow(props.store.state.selection[0])
	} else if (event.key === "Tab") {
		event.preventDefault()
		commit(row, event)
		const nodes = props.store.nodesOfMap(map.value.id)
		applyChange(
			props.store,
			map.value.id,
			event.shiftKey ? promote(nodes, id) : demote(nodes, id),
			{
				label: event.shiftKey ? "Promote node" : "Demote node",
				select: id,
				selectUndo: [id],
			},
		)
		focusRow(id)
	} else if (event.key === "ArrowUp" && rows.value[index - 1]) {
		event.preventDefault()
		focusRow(rows.value[index - 1].id)
	} else if (event.key === "ArrowDown" && rows.value[index + 1]) {
		event.preventDefault()
		focusRow(rows.value[index + 1].id)
	} else if (event.key === "Backspace" && !event.target.value && row.depth) {
		event.preventDefault()
		const before = rows.value[index - 1]
		await props.controller.mapCommand({ name: "mm.delete" })
		if (before) focusRow(before.id)
	} else if (event.key === "Escape") {
		event.target.blur()
	}
}
const close = () => (state.value.outlineOpen = false)
</script>

<template>
	<aside
		v-if="state.outlineOpen && map"
		class="absolute bottom-24 left-4 top-14 z-10 flex w-80 flex-col overflow-hidden rounded-xl border border-outline-gray-2 bg-surface-white shadow-lg"
		aria-label="Mind map outline"
		data-testid="outline-panel"
		data-print="hide"
		@pointerdown.stop
		@dblclick.stop
		@wheel.stop
		@contextmenu.stop
	>
		<header class="flex items-center gap-1 border-b border-outline-gray-2 px-3 py-2">
			<h2 class="flex-1 text-sm font-medium text-ink-gray-9">Outline</h2>
			<Button icon="x" variant="ghost" size="sm" title="Close the outline" @click="close" />
		</header>
		<ul class="min-h-0 flex-1 overflow-y-auto p-2" role="tree">
			<li
				v-for="(row, index) in rows"
				:key="row.id"
				role="treeitem"
				:aria-level="row.depth + 1"
				:style="{ paddingLeft: `${row.depth * 16}px` }"
				class="flex items-center gap-1"
			>
				<span
					class="mr-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
					:class="row.collapsed ? 'bg-ink-gray-7' : 'bg-ink-gray-4'"
					:title="row.collapsed ? 'Collapsed' : ''"
					aria-hidden="true"
				/>
				<input
					type="text"
					:value="shown(row)"
					:readonly="!editable"
					class="min-w-0 flex-1 rounded px-1.5 py-1 text-sm text-ink-gray-9 focus:bg-surface-gray-2 focus:outline-none"
					:class="[
						selected.has(row.id) ? 'bg-surface-gray-2 font-medium' : '',
						row.depth === 0 ? 'font-semibold' : '',
					]"
					:placeholder="row.depth === 0 ? 'Central idea' : 'New node'"
					:aria-label="`Node ${row.text || 'untitled'}`"
					:data-outline-id="row.id"
					data-testid="outline-row"
					@focus="props.store.select([row.id])"
					@input="typing(row, $event)"
					@change="commit(row, $event)"
					@keydown.stop="key(row, $event, index)"
				/>
			</li>
		</ul>
		<footer class="border-t border-outline-gray-2 px-3 py-1.5 text-xs text-ink-gray-5">
			Enter adds a sibling · Tab indents · Shift+Tab outdents
		</footer>
	</aside>
</template>
