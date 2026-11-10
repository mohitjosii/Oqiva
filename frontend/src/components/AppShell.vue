<script setup>
import { Avatar, Button, Dropdown, FeatherIcon, call, confirmDialog, toast } from "frappe-ui"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import MembersDialog from "@/components/MembersDialog.vue"
import ProjectDialog from "@/components/ProjectDialog.vue"
import SearchDialog from "@/components/SearchDialog.vue"
import TypeToConfirmDialog from "@/components/TypeToConfirmDialog.vue"
import WorkspaceDialog from "@/components/WorkspaceDialog.vue"
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher.vue"
import { api } from "@/data/api"
import { preferences, toggleTheme } from "@/data/preferences"
import { loadProjects, projectsState } from "@/data/projects"
import { notifications } from "@/data/notifications"
import { findWorkspace, refreshWorkspaces, session } from "@/data/session"
import { colorValue } from "@/utils/colors"
import { messageFor } from "@/utils/errors"
import { workspacePowers } from "@/utils/roles"

const route = useRoute()
const router = useRouter()

const workspace = computed(() => findWorkspace(route.params.workspace))
const powers = computed(() => workspacePowers(workspace.value))
const collapsed = computed(() => preferences.sidebarCollapsed)

const dialogs = ref({
	create: false,
	rename: false,
	members: false,
	project: false,
	delete: false,
	search: false,
})
const busy = ref(false)
const creating = ref(false)

const nav = computed(() => {
	const params = { workspace: route.params.workspace }
	return [
		{ name: "dashboard", label: "Home", icon: "home" },
		{ name: "recent", label: "Recent", icon: "clock" },
		{ name: "favorites", label: "Favorites", icon: "star" },
		{ name: "shared", label: "Shared with me", icon: "share-2" },
		{ name: "templates", label: "Templates", icon: "layout" },
		{ name: "notifications", label: "Notifications", icon: "bell" },
		{ name: "archived", label: "Archive", icon: "archive" },
		{ name: "trash", label: "Trash", icon: "trash-2" },
	].map((item) => ({ ...item, to: { name: item.name, params } }))
})

watch(
	() => route.params.workspace,
	(name) => name && loadProjects(name),
	{ immediate: true },
)

function onKeydown(event) {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
		event.preventDefault()
		dialogs.value.search = true
	}
}
onMounted(() => window.addEventListener("keydown", onKeydown))
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown))

async function newBoard() {
	if (creating.value) return
	creating.value = true
	try {
		const board = await api("board.create_board", {
			workspace: route.params.workspace,
			project: route.params.project || null,
		})
		router.push({ name: "board", params: { board: board.name } })
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		creating.value = false
	}
}

// An exported board file (.oqiva.json) becomes a new board here. The server checks everything;
// the browser only refuses what is plainly too big to be one.
const importInput = ref(null)
const importing = ref(false)
const MAX_IMPORT_BYTES = 16 * 1024 * 1024
async function importBoard(event) {
	const file = event.target.files?.[0]
	event.target.value = "" // so choosing the same file again still counts
	if (!file || importing.value) return
	if (file.size > MAX_IMPORT_BYTES) return toast.error("That file is too large to be a board.")
	importing.value = true
	try {
		const board = await api("board.import_board", {
			workspace: route.params.workspace,
			project: route.params.project || null,
			content: await file.text(),
		})
		if (board.dropped_pictures)
			toast.warning(
				`${board.dropped_pictures === 1 ? "A picture was" : `${board.dropped_pictures} pictures were`} not imported, because pictures stay with the board they came from.`,
			)
		router.push({ name: "board", params: { board: board.name } })
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		importing.value = false
	}
}

function leave() {
	confirmDialog({
		title: "Leave workspace?",
		message: `You will lose access to everything in "${workspace.value.workspace_name}" unless someone invites you again.`,
		onConfirm: async ({ hideDialog }) => {
			hideDialog()
			try {
				await api("workspace.leave_workspace", { workspace: workspace.value.name })
				await refreshWorkspaces()
				router.replace({ name: "root" })
			} catch (error) {
				toast.error(messageFor(error))
			}
		},
	})
}

async function deleteWorkspace() {
	busy.value = true
	try {
		await api("workspace.delete_workspace", { workspace: workspace.value.name })
		dialogs.value.delete = false
		await refreshWorkspaces()
		toast.success("Workspace deleted")
		router.replace({ name: "root" })
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		busy.value = false
	}
}

async function logout() {
	try {
		await call("logout")
	} finally {
		window.location.href = "/login"
	}
}

const userMenu = computed(() => [
	{
		label: preferences.theme === "dark" ? "Light mode" : "Dark mode",
		icon: "moon",
		onClick: toggleTheme,
	},
	{
		label: "Open Desk",
		icon: "settings",
		condition: () => session.isAdmin,
		onClick: () => (window.location.href = "/app"),
	},
	{ label: "Log out", icon: "log-out", onClick: logout },
])
</script>

<template>
	<div v-if="workspace" class="flex h-screen bg-surface-gray-1 text-ink-gray-9">
		<aside
			class="flex shrink-0 flex-col border-r border-outline-gray-2 bg-surface-white transition-[width] duration-150 motion-reduce:transition-none"
			:class="collapsed ? 'w-14' : 'w-64'"
			aria-label="Sidebar"
		>
			<div class="p-2">
				<WorkspaceSwitcher
					:workspace="workspace"
					:collapsed="collapsed"
					@create="dialogs.create = true"
					@rename="dialogs.rename = true"
					@members="dialogs.members = true"
					@delete="dialogs.delete = true"
					@leave="leave"
				/>
			</div>

			<nav class="flex-1 overflow-y-auto px-2 pb-2" aria-label="Main">
				<ul class="flex flex-col gap-0.5">
					<li v-for="item in nav" :key="item.name">
						<router-link
							:to="item.to"
							class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-ink-gray-7 hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-4"
							exact-active-class="!bg-surface-gray-3 font-medium !text-ink-gray-9"
							:title="collapsed ? item.label : undefined"
						>
							<FeatherIcon
								:name="item.icon"
								class="h-4 w-4 shrink-0"
								aria-hidden="true"
							/>
							<span v-if="!collapsed">{{ item.label }}</span>
							<span
								v-if="
									item.name === 'notifications' &&
									notifications.unread &&
									!collapsed
								"
								class="ml-auto rounded-full bg-blue-600 px-1.5 text-xs text-white"
								data-testid="sidebar-unread"
								>{{
									notifications.unread > 99 ? "99+" : notifications.unread
								}}</span
							>
							<span v-else class="sr-only">{{ item.label }}</span>
						</router-link>
					</li>
				</ul>

				<div v-if="!collapsed" class="mt-5">
					<div class="flex items-center justify-between px-2.5 pb-1">
						<h2 class="text-xs font-medium uppercase tracking-wide text-ink-gray-5">
							Projects
						</h2>
						<Button
							v-if="powers.canCreate"
							icon="plus"
							size="sm"
							variant="ghost"
							title="New project"
							@click="dialogs.project = true"
						/>
					</div>
					<p
						v-if="!projectsState.items.length && !projectsState.loading"
						class="px-2.5 text-xs text-ink-gray-5"
					>
						No projects yet.
					</p>
					<ul class="flex flex-col gap-0.5">
						<li v-for="project in projectsState.items" :key="project.name">
							<router-link
								:to="{
									name: 'project',
									params: { workspace: workspace.name, project: project.name },
								}"
								class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-ink-gray-7 hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-4"
								exact-active-class="!bg-surface-gray-3 font-medium !text-ink-gray-9"
							>
								<span
									class="h-2.5 w-2.5 shrink-0 rounded-full"
									:style="{ backgroundColor: colorValue(project.color) }"
									aria-hidden="true"
								/>
								<span class="truncate">{{ project.project_name }}</span>
							</router-link>
						</li>
					</ul>
				</div>
			</nav>

			<div
				class="flex items-center gap-1 border-t border-outline-gray-2 p-2"
				:class="collapsed ? 'flex-col' : ''"
			>
				<Dropdown :options="userMenu" placement="left">
					<template #default>
						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-4"
							:aria-label="`Account menu for ${session.user.full_name}`"
						>
							<Avatar
								:label="session.user.full_name"
								:image="session.user.user_image"
								size="lg"
							/>
							<span v-if="!collapsed" class="truncate text-sm text-ink-gray-8">{{
								session.user.full_name
							}}</span>
						</button>
					</template>
				</Dropdown>
				<Button
					:icon="collapsed ? 'chevrons-right' : 'chevrons-left'"
					size="sm"
					variant="ghost"
					:title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
					@click="preferences.sidebarCollapsed = !collapsed"
				/>
			</div>
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<header
				class="flex items-center justify-end gap-2 border-b border-outline-gray-2 bg-surface-white px-6 py-2.5"
			>
				<button
					type="button"
					class="flex w-64 items-center gap-2 rounded-md border border-outline-gray-2 bg-surface-gray-1 px-2.5 py-1.5 text-sm text-ink-gray-5 hover:border-outline-gray-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-4"
					@click="dialogs.search = true"
				>
					<FeatherIcon name="search" class="h-4 w-4" aria-hidden="true" />
					<span class="flex-1 text-left">Search</span>
					<kbd class="rounded border border-outline-gray-2 px-1 text-xs">Ctrl K</kbd>
				</button>
				<Button
					v-if="powers.canCreate"
					variant="subtle"
					iconLeft="layout"
					label="From template"
					@click="
						router.push({
							name: 'templates',
							params: { workspace: route.params.workspace },
						})
					"
				/>
				<Button
					v-if="powers.canCreate"
					variant="subtle"
					iconLeft="upload"
					label="Import"
					title="Make a board from an exported .oqiva.json file"
					:loading="importing"
					data-testid="import-board"
					@click="importInput.click()"
				/>
				<input
					ref="importInput"
					type="file"
					accept=".json,application/json"
					class="hidden"
					aria-label="Choose a board file"
					data-testid="import-input"
					@change="importBoard"
				/>
				<Button
					v-if="powers.canCreate"
					variant="solid"
					iconLeft="plus"
					label="New board"
					:loading="creating"
					@click="newBoard"
				/>
			</header>
			<main class="min-h-0 flex-1 overflow-y-auto px-6 py-6">
				<router-view :key="route.fullPath" />
			</main>
		</div>

		<SearchDialog v-model="dialogs.search" />
		<WorkspaceDialog
			v-model="dialogs.create"
			@saved="(name) => router.push({ name: 'dashboard', params: { workspace: name } })"
		/>
		<WorkspaceDialog v-model="dialogs.rename" :workspace="workspace" />
		<MembersDialog v-model="dialogs.members" :workspace="workspace" />
		<ProjectDialog
			v-model="dialogs.project"
			:workspace="workspace.name"
			@saved="
				(project) =>
					router.push({
						name: 'project',
						params: { workspace: workspace.name, project: project.name },
					})
			"
		/>
		<TypeToConfirmDialog
			v-model="dialogs.delete"
			title="Delete workspace?"
			message="Every project and board in it becomes unreachable for all members."
			:phrase="workspace.workspace_name"
			confirm-label="Delete workspace"
			:busy="busy"
			@confirm="deleteWorkspace"
		/>
	</div>
</template>
