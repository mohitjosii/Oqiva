<script setup>
import { Dialog, FormControl, Select } from "frappe-ui"
import { computed, ref, watch } from "vue"
import { api } from "@/data/api"
import { projectsState } from "@/data/projects"

const props = defineProps({ actions: { type: Object, required: true } })
const { dialog } = props.actions

const title = ref("")
const description = ref("")
const project = ref("")
const confirmation = ref("")
const busy = ref(false)

const show = (type) =>
	computed({
		get: () => dialog.type === type,
		set: (open) => !open && props.actions.close(),
	})
const showEdit = show("edit")
const showMove = show("move")
const showPurge = show("purge")

watch(
	() => dialog.board,
	(board) => {
		title.value = board?.title || ""
		description.value = board?.description || ""
		project.value = board?.project || ""
		confirmation.value = ""
	},
)

const projectOptions = computed(() => [
	{ label: "No project (workspace root)", value: "" },
	...projectsState.items.map((item) => ({ label: item.project_name, value: item.name })),
])

async function run(work, success) {
	busy.value = true
	try {
		await props.actions.submit(work, success)
	} finally {
		busy.value = false
	}
}

const saveEdit = () =>
	run(
		() =>
			api("board.update_board", {
				board: dialog.board.name,
				title: title.value,
				description: description.value,
			}),
		"Board updated",
	)
const saveMove = () =>
	run(
		() => api("board.move_board", { board: dialog.board.name, project: project.value || null }),
		"Board moved",
	)
const confirmPurge = () =>
	run(
		() =>
			api("board.purge_board", {
				board: dialog.board.name,
				confirm_title: confirmation.value,
			}),
		"Board deleted",
	)

const canPurge = computed(() => confirmation.value.trim() === dialog.board?.title)
</script>

<template>
	<Dialog
		v-model="showEdit"
		:options="{
			title: 'Rename or describe board',
			size: 'md',
			actions: [
				{
					label: 'Save',
					variant: 'solid',
					loading: busy,
					disabled: !title.trim(),
					onClick: saveEdit,
				},
			],
		}"
	>
		<template #body-content>
			<form class="flex flex-col gap-4" @submit.prevent="saveEdit">
				<FormControl v-model="title" label="Name" maxlength="120" autofocus />
				<FormControl v-model="description" type="textarea" label="Description" :rows="3" />
			</form>
		</template>
	</Dialog>

	<Dialog
		v-model="showMove"
		:options="{
			title: 'Move to project',
			size: 'sm',
			actions: [{ label: 'Move', variant: 'solid', loading: busy, onClick: saveMove }],
		}"
	>
		<template #body-content>
			<Select v-model="project" :options="projectOptions" />
		</template>
	</Dialog>

	<Dialog
		v-model="showPurge"
		:options="{
			title: 'Delete permanently?',
			size: 'md',
			actions: [
				{
					label: 'Delete forever',
					variant: 'solid',
					theme: 'red',
					loading: busy,
					disabled: !canPurge,
					onClick: confirmPurge,
				},
			],
		}"
	>
		<template #body-content>
			<p class="mb-3 text-sm text-ink-gray-7">
				This removes the board, its shares and its favorites, and it can't be undone. Type
				<strong class="text-ink-gray-9">{{ dialog.board?.title }}</strong> to confirm.
			</p>
			<FormControl
				v-model="confirmation"
				placeholder="Board name"
				@keydown.enter.prevent="canPurge && confirmPurge()"
			/>
		</template>
	</Dialog>
</template>
