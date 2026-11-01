<script setup>
import { Badge, Button, FeatherIcon } from "frappe-ui"
import { computed, onMounted } from "vue"
import { useRoute, useRouter } from "vue-router"
import ErrorState from "@/components/ErrorState.vue"
import { useAsync } from "@/composables/useAsync"
import { api } from "@/data/api"
import { findWorkspace, homeWorkspace } from "@/data/session"
import { timeAgo } from "@/utils/time"

// The canvas editor arrives in Phase 3. Until then this page opens a board, records
// the visit, and shows what the editor will be given.
const route = useRoute()
const router = useRouter()
const board = useAsync(() => api("board.open_board", { board: route.params.board }))
onMounted(board.run)

const back = computed(() => {
	const data = board.data.value
	const workspace =
		data?.workspace && findWorkspace(data.workspace) ? data.workspace : homeWorkspace()
	return data?.project
		? { name: "project", params: { workspace, project: data.project } }
		: { name: "dashboard", params: { workspace } }
})
// Back returns to wherever the user came from inside the app. The computed route is the
// fallback for a board opened from a link, and for a click before the board has loaded.
function goBack() {
	if (window.history.state?.back) router.back()
	else router.push(back.value)
}

const access = computed(() => {
	const caps = board.data.value?.capabilities
	if (!caps) return ""
	if (caps.can_edit) return "Can edit"
	return caps.can_comment ? "Can comment" : "View only"
})
</script>

<template>
	<div class="flex min-h-screen flex-col bg-surface-gray-1">
		<header
			class="flex items-center gap-3 border-b border-outline-gray-2 bg-surface-white px-4 py-2.5"
		>
			<Button icon="chevron-left" variant="ghost" title="Back to workspace" @click="goBack" />
			<h1 class="min-w-0 flex-1 truncate text-base font-semibold text-ink-gray-9">
				{{ board.data.value?.title || "Board" }}
			</h1>
			<Badge
				v-if="access"
				:label="access"
				:theme="access === 'Can edit' ? 'green' : 'gray'"
			/>
		</header>

		<main class="flex flex-1 items-center justify-center p-6">
			<ErrorState v-if="board.error.value" :error="board.error.value" @retry="board.run" />
			<p v-else-if="!board.data.value" class="text-sm text-ink-gray-5" role="status">
				Opening board…
			</p>
			<div
				v-else
				class="w-full max-w-lg rounded-xl border border-dashed border-outline-gray-3 bg-surface-white p-8 text-center"
			>
				<FeatherIcon
					name="edit-3"
					class="mx-auto h-8 w-8 text-ink-gray-4"
					aria-hidden="true"
				/>
				<h2 class="mt-3 text-lg font-semibold text-ink-gray-9">
					The canvas editor is coming next
				</h2>
				<p class="mt-1 text-sm text-ink-gray-6">
					This board is saved and ready. Drawing opens up in the next release. It was
					edited
					{{ timeAgo(board.data.value.modified) }} in
					{{ board.data.value.workspace_name }}.
				</p>
				<Button class="mt-5" variant="subtle" label="Back to workspace" @click="goBack" />
			</div>
		</main>
	</div>
</template>
