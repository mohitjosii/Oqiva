<script setup>
// Links to a board: make one (who may open it, for how long), copy it once, see the ones in
// force, end one.
import { Button, Select, toast } from "frappe-ui"
import { computed, ref, watch } from "vue"
import { api } from "@/data/api"
import { copyText } from "@/utils/clipboard"
import { messageFor } from "@/utils/errors"

const props = defineProps({
	board: { type: Object, required: true },
	open: { type: Boolean, default: false },
})

const links = ref([])
const busy = ref(false)
const access = ref("Viewer")
const expiry = ref("")
const anonymous = ref(false)
const made = ref(null) // {url} shown once, right after a link is made
const urlField = ref(null)

const accessOptions = [
	{ value: "Viewer", label: "Can view" },
	{ value: "Commenter", label: "Can comment" },
	{ value: "Editor", label: "Can edit" },
]
const expiryOptions = [
	{ value: "", label: "Never expires" },
	{ value: "1", label: "1 day" },
	{ value: "7", label: "7 days" },
	{ value: "30", label: "30 days" },
	{ value: "90", label: "90 days" },
]
const canBeAnonymous = computed(() => access.value === "Viewer")
watch(access, () => {
	if (!canBeAnonymous.value) anonymous.value = false
})

async function load() {
	try {
		links.value = await api("share.list_links", { board: props.board.name })
	} catch (error) {
		toast.error(messageFor(error))
	}
}

watch(
	() => props.open,
	(isOpen) => {
		if (isOpen) {
			made.value = null
			load()
		}
	},
	{ immediate: true },
)

async function create() {
	busy.value = true
	made.value = null // the old link must not be mistaken for the new one
	try {
		made.value = await api("share.create_link", {
			board: props.board.name,
			access: access.value,
			expires_in_days: expiry.value ? Number(expiry.value) : null,
			allow_anonymous: anonymous.value,
		})
		await load()
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		busy.value = false
	}
}

async function copy(url) {
	// the field in the dialog is used when the page has no clipboard (plain http on a private address)
	if (await copyText(url, urlField.value)) toast.success("Link copied")
	else {
		urlField.value?.select()
		toast.error("Could not copy. The link is selected: press Ctrl+C (or Cmd+C) to copy it.")
	}
}

async function revoke(link) {
	busy.value = true
	try {
		await api("share.revoke_link", { link: link.name })
		toast.success("Link ended. Everyone who used it has lost access.")
		await load()
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		busy.value = false
	}
}

const label = (value, options) => options.find((o) => o.value === value)?.label || value
const when = (value) => (value ? new Date(value.replace(" ", "T")).toLocaleDateString() : null)
</script>

<template>
	<section aria-label="Links" data-testid="share-links">
		<h3 class="mb-2 text-sm font-semibold text-ink-gray-9">Links</h3>
		<div class="flex flex-wrap items-end gap-2">
			<Select
				v-model="access"
				class="w-36"
				:options="accessOptions"
				aria-label="What the link allows"
			/>
			<Select v-model="expiry" class="w-40" :options="expiryOptions" aria-label="Expiry" />
			<Button
				variant="subtle"
				label="Create link"
				icon-left="link"
				:loading="busy"
				data-testid="create-link"
				@click="create"
			/>
		</div>
		<label
			class="mt-2 flex items-center gap-2 text-sm text-ink-gray-7"
			:class="canBeAnonymous ? '' : 'opacity-50'"
		>
			<input
				v-model="anonymous"
				type="checkbox"
				class="h-3.5 w-3.5 rounded-sm border-outline-gray-4"
				:disabled="!canBeAnonymous"
				data-testid="link-anonymous"
			/>
			Anyone with the link can look, even without an account
		</label>

		<div
			v-if="made"
			class="mt-3 rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-3"
			role="status"
			data-testid="new-link"
		>
			<p class="mb-1 text-xs text-ink-gray-6">
				Copy this link now. For safety it can't be shown again.
			</p>
			<div class="flex items-center gap-2">
				<input
					ref="urlField"
					class="min-w-0 flex-1 rounded border border-outline-gray-2 bg-surface-white px-2 py-1 text-sm text-ink-gray-9"
					:value="made.url"
					readonly
					aria-label="The new link"
					data-testid="new-link-url"
					@focus="$event.target.select()"
				/>
				<Button label="Copy" size="sm" variant="solid" @click="copy(made.url)" />
			</div>
		</div>

		<ul
			v-if="links.length"
			class="mt-3 divide-y divide-outline-gray-1"
			aria-label="Links in force"
			data-testid="link-list"
		>
			<li v-for="link in links" :key="link.name" class="flex items-center gap-3 py-2">
				<div class="min-w-0 flex-1">
					<p class="text-sm text-ink-gray-9">
						{{ label(link.access, accessOptions) }}
						<span v-if="link.allow_anonymous" class="text-ink-gray-5"
							>· no account needed</span
						>
					</p>
					<p class="truncate text-xs text-ink-gray-5">
						Starts …{{ link.token_hint }}
						<template v-if="link.expired"> · expired</template>
						<template v-else-if="link.expires_on">
							· until {{ when(link.expires_on) }}</template
						>
						<template v-if="link.last_used_on">
							· last used {{ when(link.last_used_on) }}</template
						>
					</p>
				</div>
				<Button
					v-if="link.can_revoke"
					label="End"
					size="sm"
					variant="ghost"
					:title="`End the link that starts …${link.token_hint}`"
					@click="revoke(link)"
				/>
			</li>
		</ul>
		<p v-else class="mt-3 text-sm text-ink-gray-5">No links yet.</p>
	</section>
</template>
