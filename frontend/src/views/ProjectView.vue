<script setup>
import { Badge, Button, Dropdown, confirmDialog, toast } from "frappe-ui"
import { computed, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import BoardActionDialogs from "@/components/BoardActionDialogs.vue"
import BoardGrid from "@/components/BoardGrid.vue"
import EmptyState from "@/components/EmptyState.vue"
import ErrorState from "@/components/ErrorState.vue"
import PageHeader from "@/components/PageHeader.vue"
import ProjectDialog from "@/components/ProjectDialog.vue"
import ViewToggle from "@/components/ViewToggle.vue"
import { useAsync } from "@/composables/useAsync"
import { useBoardActions } from "@/composables/useBoardActions"
import { useBoardList } from "@/composables/useBoardList"
import { api } from "@/data/api"
import { reloadProjects } from "@/data/projects"
import { findWorkspace } from "@/data/session"
import { colorValue } from "@/utils/colors"
import { messageFor } from "@/utils/errors"
import { workspacePowers } from "@/utils/roles"

const route = useRoute()
const router = useRouter()
const workspace = computed(() => findWorkspace(route.params.workspace))
const powers = computed(() => workspacePowers(workspace.value))
const showEdit = ref(false)
const creating = ref(false)

const project = useAsync(() => api("project.get_project", { project: route.params.project }))
const list = useBoardList(() => ({
	scope: "all",
	workspace: route.params.workspace,
	project: route.params.project,
	limit: 48,
}))
const actions = useBoardActions(list.load)

watch(
	() => route.params.project,
	() => {
		project.run()
		list.load()
	},
	{ immediate: true },
)

async function newBoard() {
	creating.value = true
	try {
		const board = await api("board.create_board", {
			workspace: route.params.workspace,
			project: route.params.project,
		})
		router.push({ name: "board", params: { board: board.name } })
	} catch (error) {
		toast.error(messageFor(error))
		creating.value = false
	}
}

async function afterProjectChange(message, leave = false) {
	toast.success(message)
	await reloadProjects()
	if (leave) router.replace({ name: "dashboard", params: { workspace: route.params.workspace } })
	else project.run()
}

async function archive() {
	try {
		await api("project.archive_project", {
			project: route.params.project,
			archived: !project.data.value.archived_on,
		})
		await afterProjectChange(
			project.data.value.archived_on ? "Project unarchived" : "Project archived",
		)
	} catch (error) {
		toast.error(messageFor(error))
	}
}

function trash() {
	confirmDialog({
		title: "Move project to Trash?",
		message: `"${project.data.value.project_name}" and its boards move to Trash together. Restoring the project brings them back.`,
		onConfirm: async ({ hideDialog }) => {
			hideDialog()
			try {
				await api("project.trash_project", { project: route.params.project })
				await afterProjectChange("Project moved to Trash", true)
			} catch (error) {
				toast.error(messageFor(error))
			}
		},
	})
}

const menu = computed(() => [
	{
		label: "Project settings",
		icon: "settings",
		condition: () => powers.value.canCreate,
		onClick: () => (showEdit.value = true),
	},
	{
		label: project.data.value?.archived_on ? "Unarchive" : "Archive",
		icon: "archive",
		condition: () => powers.value.canArchiveProjects,
		onClick: archive,
	},
	{
		label: "Move to Trash",
		icon: "trash-2",
		theme: "red",
		condition: () => powers.value.canArchiveProjects,
		onClick: trash,
	},
])
</script>

<template>
	<div>
		<ErrorState v-if="project.error.value" :error="project.error.value" @retry="project.run" />
		<template v-else-if="project.data.value">
			<PageHeader
				:title="project.data.value.project_name"
				:subtitle="project.data.value.description || ''"
			>
				<template #title-prefix>
					<span
						class="h-3 w-3 shrink-0 rounded-full"
						:style="{ backgroundColor: colorValue(project.data.value.color) }"
						aria-hidden="true"
					/>
				</template>
				<template #actions>
					<Badge v-if="project.data.value.archived_on" label="Archived" theme="orange" />
					<ViewToggle />
					<Dropdown v-if="powers.canCreate" :options="menu" placement="right">
						<Button icon="more-horizontal" variant="subtle" title="Project actions" />
					</Dropdown>
					<Button
						v-if="powers.canCreate"
						variant="solid"
						iconLeft="plus"
						label="New board"
						:loading="creating"
						@click="newBoard"
					/>
				</template>
			</PageHeader>

			<ErrorState v-if="list.error.value" :error="list.error.value" @retry="list.load" />
			<p
				v-else-if="list.loading.value && !list.boards.value.length"
				class="py-10 text-center text-sm text-ink-gray-5"
				role="status"
			>
				Loading…
			</p>
			<EmptyState
				v-else-if="!list.boards.value.length"
				icon="folder"
				title="No boards in this project"
				:description="
					powers.canCreate
						? 'Create a board here, or move an existing one in from its menu.'
						: 'Boards added here will show up for you if they are shared with you.'
				"
			>
				<Button
					v-if="powers.canCreate"
					variant="solid"
					iconLeft="plus"
					label="New board"
					:loading="creating"
					@click="newBoard"
				/>
			</EmptyState>
			<BoardGrid v-else :boards="list.boards.value" @action="actions.run" />

			<ProjectDialog
				v-model="showEdit"
				:workspace="route.params.workspace"
				:project="project.data.value"
				@saved="project.run"
			/>
		</template>
		<p v-else class="py-10 text-center text-sm text-ink-gray-5" role="status">Loading…</p>
		<BoardActionDialogs :actions="actions" />
	</div>
</template>
