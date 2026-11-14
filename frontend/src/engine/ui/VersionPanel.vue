<script setup>
// The history of the board: saved versions, newest first. Anyone who can see the board sees the
// list; people who can edit can also look at an old version, restore it, name it and pin it.
import { Button } from "frappe-ui"
import { computed, nextTick, ref, watch } from "vue"
import { timeAgo } from "../comments/model"

const props = defineProps({
	store: { type: Object, required: true },
	versions: { type: Object, required: true }, // the host's port: list, save, label, pin
	canEdit: { type: Boolean, default: false },
})
const emit = defineEmits(["preview", "restore"])

const state = computed(() => props.store.state)
const items = ref([])
const retentionDays = ref(0) // automatic versions older than this are deleted; 0 until the list loads
const loading = ref(false)
const error = ref("")
const busy = ref(null) // the version number being worked on
const nameDraft = ref("")
const saving = ref(false)
const confirming = ref(null)
const renaming = ref(null)
const renameDraft = ref("")

async function refresh() {
	loading.value = true
	error.value = ""
	try {
		const listed = await props.versions.list()
		items.value = listed.versions
		retentionDays.value = listed.retention_days || 0
	} catch (e) {
		error.value = e?.message || "The history could not be loaded."
	} finally {
		loading.value = false
	}
}
watch(
	() => state.value.versionsOpen,
	(open) => open && refresh(),
	{ immediate: true },
)
defineExpose({ refresh })

const label = (v) =>
	v.kind === "Named"
		? v.label || "Named version"
		: v.kind === "Pre-restore"
			? v.label || "Before a restore"
			: "Automatic version"
const plural = (n) => `${n} ${n === 1 ? "object" : "objects"}`
const kindWord = (v) => (v.kind === "Pre-restore" ? "Before a restore" : v.kind)
const sizeWord = (bytes) =>
	bytes >= 1024 * 1024
		? `${(bytes / 1024 / 1024).toFixed(1)} MB`
		: `${Math.max(1, Math.round(bytes / 1024))} KB`

async function work(number, task) {
	busy.value = number
	try {
		await task()
		await refresh()
	} catch (e) {
		error.value = e?.message || "That did not work."
	} finally {
		busy.value = null
	}
}

async function saveNamed() {
	const name = nameDraft.value.trim()
	if (!name || saving.value) return
	saving.value = true
	error.value = ""
	try {
		await props.versions.save(name)
		nameDraft.value = ""
		await refresh()
	} catch (e) {
		error.value = e?.message || "The version could not be saved."
	} finally {
		saving.value = false
	}
}
const togglePin = (v) =>
	work(v.version_number, () => props.versions.pin(v.version_number, !v.pinned))
function startRename(v) {
	renaming.value = v.version_number
	renameDraft.value = v.label || ""
	nextTick(() => document.querySelector('[data-testid="version-rename"]')?.focus())
}
async function finishRename(v) {
	const name = renameDraft.value.trim()
	renaming.value = null
	if (name && name !== v.label)
		await work(v.version_number, () => props.versions.label(v.version_number, name))
}
function restore(v) {
	confirming.value = null
	emit("restore", v.version_number)
}
const close = () => (state.value.versionsOpen = false)
</script>

<template>
	<aside
		v-if="state.versionsOpen"
		class="absolute bottom-40 right-4 top-14 z-10 flex w-80 flex-col overflow-hidden rounded-xl border border-outline-gray-2 bg-surface-white shadow-lg"
		aria-label="Version history"
		data-testid="version-panel"
		data-print="hide"
		@pointerdown.stop
		@dblclick.stop
		@wheel.stop
		@contextmenu.stop
	>
		<header class="flex items-center gap-1 border-b border-outline-gray-2 px-3 py-2">
			<h2 class="flex-1 text-sm font-medium text-ink-gray-9">Version history</h2>
			<Button icon="x" variant="ghost" size="sm" title="Close the history" @click="close" />
		</header>

		<form
			v-if="canEdit"
			class="flex gap-1 border-b border-outline-gray-2 p-2"
			@submit.prevent="saveNamed"
		>
			<input
				v-model="nameDraft"
				type="text"
				maxlength="120"
				class="min-w-0 flex-1 rounded-md border border-outline-gray-2 bg-surface-white px-2 py-1.5 text-sm text-ink-gray-9 placeholder:text-ink-gray-4 focus:border-outline-gray-4 focus:outline-none"
				placeholder="Name this version"
				aria-label="Name this version"
				data-testid="version-name"
				@keydown.stop
			/>
			<Button
				type="submit"
				variant="subtle"
				label="Save"
				:loading="saving"
				:disabled="!nameDraft.trim()"
				data-testid="version-save"
			/>
		</form>

		<p
			v-if="retentionDays"
			class="px-3 pt-2 text-xs text-ink-gray-6"
			data-testid="versions-retention"
		>
			Automatic versions are deleted after {{ retentionDays }}
			{{ retentionDays === 1 ? "day" : "days" }}. Name or pin a version to keep it.
		</p>

		<p v-if="error" class="px-3 pt-2 text-xs text-red-600" role="alert">{{ error }}</p>

		<div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
			<p
				v-if="loading && !items.length"
				class="py-6 text-center text-sm text-ink-gray-5"
				role="status"
			>
				Loading the history…
			</p>
			<p
				v-else-if="!items.length"
				class="py-6 text-center text-sm text-ink-gray-5"
				data-testid="versions-empty"
			>
				No versions yet. One is kept automatically as you work.
			</p>
			<article
				v-for="v in items"
				:key="v.version_number"
				class="rounded-lg border border-outline-gray-2 p-2"
				data-testid="version-item"
				:data-version="v.version_number"
			>
				<div class="flex items-start gap-1.5">
					<div class="min-w-0 flex-1">
						<input
							v-if="renaming === v.version_number"
							v-model="renameDraft"
							type="text"
							maxlength="120"
							class="w-full rounded border border-outline-gray-3 px-1.5 py-0.5 text-sm"
							aria-label="Version name"
							data-testid="version-rename"
							@keydown.stop
							@keydown.enter.prevent="finishRename(v)"
							@keydown.esc.prevent="renaming = null"
							@blur="finishRename(v)"
						/>
						<p
							v-else
							class="truncate text-sm font-medium text-ink-gray-9"
							:title="label(v)"
						>
							{{ label(v) }}
						</p>
						<p class="text-xs text-ink-gray-5">
							{{ timeAgo(v.created) }} · {{ v.by.full_name }}
						</p>
						<p class="text-xs text-ink-gray-5">
							Version {{ v.version_number }} · {{ plural(v.object_count) }} ·
							{{ sizeWord(v.size_bytes) }}
						</p>
					</div>
					<span
						v-if="v.pinned"
						class="lucide-pin mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-gray-6"
						title="Pinned"
						role="img"
						aria-label="Pinned"
					/>
					<span
						class="rounded-full bg-surface-gray-3 px-1.5 text-[10px] text-ink-gray-7"
						>{{ kindWord(v) }}</span
					>
				</div>

				<div v-if="canEdit" class="mt-1.5 flex flex-wrap items-center gap-1">
					<template v-if="confirming === v.version_number">
						<span class="text-xs text-ink-gray-7">Restore this version?</span>
						<Button
							size="sm"
							variant="solid"
							label="Restore"
							data-testid="version-confirm"
							@click="restore(v)"
						/>
						<Button
							size="sm"
							variant="ghost"
							label="Cancel"
							@click="confirming = null"
						/>
					</template>
					<template v-else>
						<Button
							size="sm"
							variant="subtle"
							label="Preview"
							:disabled="busy === v.version_number"
							data-testid="version-preview"
							@click="emit('preview', v.version_number)"
						/>
						<Button
							size="sm"
							variant="subtle"
							label="Restore"
							data-testid="version-restore"
							@click="confirming = v.version_number"
						/>
						<Button
							size="sm"
							variant="ghost"
							:label="v.pinned ? 'Unpin' : 'Pin'"
							:disabled="busy === v.version_number"
							data-testid="version-pin"
							@click="togglePin(v)"
						/>
						<Button
							size="sm"
							variant="ghost"
							label="Rename"
							data-testid="version-rename-button"
							@click="startRename(v)"
						/>
					</template>
				</div>
			</article>
		</div>
		<footer class="border-t border-outline-gray-2 px-3 py-1.5 text-xs text-ink-gray-5">
			Restoring keeps the board as it is now, and Undo brings it back.
		</footer>
	</aside>
</template>
