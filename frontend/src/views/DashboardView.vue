<script setup>
import { Button } from "frappe-ui"
import { computed, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import BoardActionDialogs from "@/components/BoardActionDialogs.vue"
import BoardGrid from "@/components/BoardGrid.vue"
import EmptyState from "@/components/EmptyState.vue"
import ErrorState from "@/components/ErrorState.vue"
import PageHeader from "@/components/PageHeader.vue"
import ProjectDialog from "@/components/ProjectDialog.vue"
import ViewToggle from "@/components/ViewToggle.vue"
import { useBoardActions } from "@/composables/useBoardActions"
import { useBoardList } from "@/composables/useBoardList"
import { api } from "@/data/api"
import { projectsState } from "@/data/projects"
import { findWorkspace, session } from "@/data/session"
import { colorValue } from "@/utils/colors"
import { messageFor } from "@/utils/errors"
import { workspacePowers } from "@/utils/roles"
import { toast } from "frappe-ui"

const route = useRoute()
const router = useRouter()
const workspace = computed(() => findWorkspace(route.params.workspace))
const powers = computed(() => workspacePowers(workspace.value))
const firstName = computed(() => session.user.full_name.split(" ")[0])
const showProject = ref(false)
const creating = ref(false)

const { boards, loading, error, load } = useBoardList(() => ({
	scope: "all",
	workspace: route.params.workspace,
	limit: 12,
}))
const actions = useBoardActions(load)
watch(() => route.params.workspace, load, { immediate: true })

const firstRun = computed(
	() => !loading.value && !error.value && !boards.value.length && !projectsState.items.length,
)

async function newBoard() {
	creating.value = true
	try {
		const board = await api("board.create_board", { workspace: route.params.workspace })
		router.push({ name: "board", params: { board: board.name } })
	} catch (caught) {
		toast.error(messageFor(caught))
		creating.value = false
	}
}
</script>

<template>
	<div>
		<PageHeader
			:title="`Welcome back, ${firstName}`"
			:subtitle="`You are in ${workspace.workspace_name}.`"
		>
			<template #actions>
				<Button
					v-if="powers.canCreate"
					variant="subtle"
					iconLeft="folder-plus"
					label="New project"
					@click="showProject = true"
				/>
			</template>
		</PageHeader>

		<ErrorState v-if="error" :error="error" @retry="load" />

		<EmptyState
			v-else-if="firstRun"
			icon="layout"
			:title="powers.canCreate ? 'Create your first board' : 'Nothing here yet'"
			:description="
				powers.canCreate
					? 'A board is a canvas for diagrams, flows and ideas. Start blank, or group boards into projects.'
					: 'Boards other people share with you appear under Shared with me.'
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
			<Button
				v-if="powers.canCreate"
				variant="subtle"
				iconLeft="folder-plus"
				label="New project"
				@click="showProject = true"
			/>
		</EmptyState>

		<template v-else>
			<section
				v-if="projectsState.items.length"
				class="mb-8"
				aria-labelledby="projects-heading"
			>
				<h2 id="projects-heading" class="mb-3 text-sm font-semibold text-ink-gray-7">
					Projects
				</h2>
				<ul class="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
					<li v-for="project in projectsState.items" :key="project.name">
						<router-link
							:to="{
								name: 'project',
								params: { workspace: workspace.name, project: project.name },
							}"
							class="flex items-center gap-3 rounded-lg border border-outline-gray-2 bg-surface-white px-3.5 py-3 hover:border-outline-gray-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-4"
						>
							<span
								class="h-8 w-1.5 shrink-0 rounded-full"
								:style="{ backgroundColor: colorValue(project.color) }"
								aria-hidden="true"
							/>
							<span class="min-w-0">
								<span class="block truncate text-sm font-medium text-ink-gray-9">{{
									project.project_name
								}}</span>
								<span class="block text-xs text-ink-gray-5"
									>{{ project.board_count }}
									{{ project.board_count === 1 ? "board" : "boards" }}</span
								>
							</span>
						</router-link>
					</li>
				</ul>
			</section>

			<section aria-labelledby="recent-heading">
				<div class="mb-3 flex items-center justify-between">
					<h2 id="recent-heading" class="text-sm font-semibold text-ink-gray-7">
						Recently edited
					</h2>
					<ViewToggle />
				</div>
				<p
					v-if="loading && !boards.length"
					class="py-8 text-center text-sm text-ink-gray-5"
					role="status"
				>
					Loading…
				</p>
				<BoardGrid v-else :boards="boards" @action="actions.run" />
			</section>
		</template>

		<ProjectDialog
			v-model="showProject"
			:workspace="workspace.name"
			@saved="
				(p) =>
					router.push({
						name: 'project',
						params: { workspace: workspace.name, project: p.name },
					})
			"
		/>
		<BoardActionDialogs :actions="actions" />
	</div>
</template>
