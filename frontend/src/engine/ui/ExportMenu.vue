<script setup>
import { useSmallScreen } from "./useSmallScreen"
// The Export button at the top right of the board: the whole board or just the selection, as
// a picture, SVG or PDF, or sent to the printer.
import { Button, Dropdown } from "frappe-ui"
import { computed } from "vue"

const small = useSmallScreen()
const props = defineProps({ store: { type: Object, required: true } })
const emit = defineEmits(["export"])

const state = computed(() => props.store.state)
const hasSelection = computed(() => state.value.selection.length > 0)

const formats = (scope) => [
	{ label: "PNG", icon: "image", onClick: () => emit("export", { format: "png", scope }) },
	{
		label: "PNG, double size",
		icon: "image",
		onClick: () => emit("export", { format: "png", scope, scale: 2 }),
	},
	{ label: "JPEG", icon: "image", onClick: () => emit("export", { format: "jpeg", scope }) },
	{ label: "SVG", icon: "code", onClick: () => emit("export", { format: "svg", scope }) },
	{ label: "PDF", icon: "file-text", onClick: () => emit("export", { format: "pdf", scope }) },
]

const options = computed(() => [
	{ group: "Export the whole board", items: formats("board") },
	...(hasSelection.value ? [{ group: "Export the selection", items: formats("selection") }] : []),
	{
		group: "Keep or move this board",
		items: [
			{
				label: "Board file (.oqiva.json)",
				icon: "file",
				onClick: () => emit("export", { format: "json", scope: "board" }),
			},
		],
	},
	{
		group: "Paper",
		items: [
			{
				label: "Print…",
				icon: "printer",
				onClick: () => emit("export", { format: "print", scope: "board" }),
			},
		],
	},
])
</script>

<template>
	<div
		class="absolute right-4 top-3 z-10"
		data-print="hide"
		@pointerdown.stop
		@dblclick.stop
		@wheel.stop
	>
		<Dropdown :options="options" placement="right">
			<Button
				:label="small ? undefined : 'Export'"
				icon-left="download"
				variant="subtle"
				:loading="state.exporting"
				:disabled="state.exporting"
				title="Export or print this board"
				aria-label="Export or print this board"
				data-testid="export-button"
			/>
		</Dropdown>
	</div>
</template>
