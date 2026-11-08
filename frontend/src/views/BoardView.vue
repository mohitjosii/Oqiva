<script setup>
import { Badge, Button, FeatherIcon, toast } from "frappe-ui"
import { computed, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import BoardTitle from "@/components/BoardTitle.vue"
import ErrorState from "@/components/ErrorState.vue"
import { useAsync } from "@/composables/useAsync"
import { api, upload } from "@/data/api"
import { findWorkspace, homeWorkspace } from "@/data/session"
import BoardEditor from "@/engine/BoardEditor.vue"
import { parseDocument } from "@/engine/model/schema"
import SaveIndicator from "@/engine/ui/SaveIndicator.vue"
import { messageFor } from "@/utils/errors"

const route = useRoute()
const router = useRouter()
const boardName = computed(() => route.params.board)

// The board to open is passed in rather than read from the route when the request is sent: by
// then the person may already have gone elsewhere, and the route would have no board in it.
const board = useAsync((name) => api("board.open_board", { board: name }))
const content = useAsync((name) => api("board.load_document", { board: name }))
const status = ref({ status: "saved", message: "" })

async function open(name) {
	if (!name) return
	status.value = { status: "saved", message: "" }
	board.data.value = null // never show the previous board's content while this one loads
	content.data.value = null
	await board.run(name)
	if (board.data.value && route.params.board === name) await content.run(name)
}

// Going straight from one board to another reuses this page, so follow the route.
watch(boardName, open, { immediate: true })

const RECOVERY = {
	corrupt: {
		title: "This board's content can't be read",
		text: "It is stored, but it isn't a board Oqiva understands. Nothing has been changed, and it is not opened so that it can't be overwritten with a blank board.",
	},
	too_new: {
		title: "This board needs a newer version of Oqiva",
		text: "It was saved by a newer version of the app. Update Oqiva to open it.",
	},
}

// What the editor is given, or the reason it cannot be opened.
const prepared = computed(() => {
	const loaded = content.data.value
	if (!loaded) return null
	if (loaded.recovery) return { recovery: loaded.recovery }
	try {
		const { document } = parseDocument(loaded.document)
		return {
			host: {
				document,
				revision: loaded.revision,
				capabilities: loaded.capabilities,
				limits: loaded.limits,
				api: {
					save: ({ document: json, baseRevision, saveId }) =>
						api("board.save_document", {
							board: boardName.value,
							document: json,
							base_revision: baseRevision,
							save_id: saveId,
						}),
					getRevision: () => api("board.get_revision", { board: boardName.value }),
				},
				images: {
					upload: (file) =>
						upload("board.upload_image", { board: boardName.value }, file),
				},
				thumbnails: {
					save: (blob) =>
						upload("board.save_thumbnail", { board: boardName.value }, blob),
				},
				exports: {
					prepare: (format, scope) =>
						api("export.prepare", { board: boardName.value, format, scope }),
				},
			},
		}
	} catch (error) {
		return { recovery: error.code === "too_new" ? "too_new" : "corrupt" }
	}
})

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

const caps = computed(() => board.data.value?.capabilities || {})
const readonly = computed(() => !caps.value.can_edit)
const access = computed(() => {
	if (caps.value.can_edit) return "Can edit"
	return caps.value.can_comment ? "Can comment" : "View only"
})

async function rename(title) {
	try {
		const updated = await api("board.update_board", { board: boardName.value, title })
		board.data.value = { ...board.data.value, title: updated.title }
	} catch (error) {
		toast.error(messageFor(error))
	}
}

const reload = () => window.location.reload()
const failed = computed(() => board.error.value || content.error.value)
</script>

<template>
	<div class="flex h-screen flex-col bg-surface-gray-1">
		<header
			class="flex items-center gap-2 border-b border-outline-gray-2 bg-surface-white px-3 py-2"
			data-print="hide"
		>
			<Button icon="chevron-left" variant="ghost" title="Back to workspace" @click="goBack" />
			<BoardTitle
				v-if="board.data.value"
				:title="board.data.value.title"
				:editable="Boolean(caps.can_rename)"
				@rename="rename"
			/>
			<div class="flex-1" />
			<SaveIndicator
				v-if="prepared?.host"
				:status="status.status"
				:message="status.message"
				:readonly="readonly"
			/>
			<Badge
				v-if="board.data.value"
				:label="access"
				:theme="caps.can_edit ? 'green' : 'gray'"
			/>
		</header>

		<div
			v-if="status.status === 'conflict'"
			class="flex items-center gap-3 border-b border-outline-amber-2 bg-surface-amber-1 px-4 py-2 text-sm text-ink-gray-8"
			role="alert"
		>
			<FeatherIcon
				name="alert-triangle"
				class="h-4 w-4 shrink-0 text-ink-amber-3"
				aria-hidden="true"
			/>
			<span class="flex-1"
				>This board was changed somewhere else. Saving has stopped so their work is not
				overwritten. Reload to see the latest version.</span
			>
			<Button label="Reload" size="sm" variant="solid" @click="reload" />
		</div>
		<div
			v-else-if="status.status === 'error'"
			class="flex items-center gap-3 border-b border-outline-red-1 bg-surface-red-1 px-4 py-2 text-sm text-ink-gray-8"
			role="alert"
		>
			<FeatherIcon
				name="alert-circle"
				class="h-4 w-4 shrink-0 text-ink-red-3"
				aria-hidden="true"
			/>
			<span class="flex-1">Your latest changes are not saved yet. {{ status.message }}</span>
		</div>

		<main class="relative min-h-0 flex-1">
			<div v-if="failed" class="flex h-full items-center justify-center p-6">
				<ErrorState :error="failed" @retry="() => open(boardName)" />
			</div>
			<BoardEditor
				v-else-if="prepared?.host"
				:key="boardName"
				:host="prepared.host"
				@status="status = $event"
			/>
			<div v-else-if="prepared?.recovery" class="flex h-full items-center justify-center p-6">
				<div
					class="max-w-md rounded-xl border border-outline-gray-2 bg-surface-white p-8 text-center"
				>
					<FeatherIcon
						name="alert-circle"
						class="mx-auto h-8 w-8 text-ink-gray-4"
						aria-hidden="true"
					/>
					<h2 class="mt-3 text-lg font-semibold text-ink-gray-9">
						{{ RECOVERY[prepared.recovery].title }}
					</h2>
					<p class="mt-2 text-sm text-ink-gray-6">
						{{ RECOVERY[prepared.recovery].text }}
					</p>
					<Button
						class="mt-5"
						variant="subtle"
						label="Back to workspace"
						@click="goBack"
					/>
				</div>
			</div>
			<p
				v-else
				class="flex h-full items-center justify-center text-sm text-ink-gray-5"
				role="status"
			>
				Opening board…
			</p>
		</main>
	</div>
</template>
