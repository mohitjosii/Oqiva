<script setup>
// Who can open a board: people shared by name or email, and (further down) links.
import { Avatar, Button, Dialog, FormControl, Select, toast } from "frappe-ui"
import { computed, ref, watch } from "vue"
import { api } from "@/data/api"
import { session } from "@/data/session"
import { messageFor } from "@/utils/errors"
import { SHARE_LEVELS } from "@/utils/sharing"
import ShareLinks from "./ShareLinks.vue"

const props = defineProps({
	modelValue: { type: Boolean, required: true },
	board: { type: Object, required: true }, // {name, title}
})
const emit = defineEmits(["update:modelValue"])

const open = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
})
const people = ref([])
const invites = ref([])
const loading = ref(false)
const busy = ref(false)
const person = ref("")
const level = ref("edit")
const levelOptions = SHARE_LEVELS.map(({ value, label }) => ({ value, label }))

async function load() {
	loading.value = true
	try {
		const shown = await api("share.list_shares", { board: props.board.name })
		people.value = shown.people
		invites.value = shown.invites
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		loading.value = false
	}
}

watch(open, (isOpen) => {
	if (isOpen) {
		person.value = ""
		level.value = "edit"
		load()
	}
})

async function act(work, success) {
	busy.value = true
	try {
		const result = await work()
		if (success) toast.success(typeof success === "function" ? success(result) : success)
		await load()
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		busy.value = false
	}
}

function add() {
	if (!person.value.trim()) return
	return act(
		() =>
			api("share.add_person", {
				board: props.board.name,
				person: person.value,
				level: level.value,
			}),
		(result) => {
			person.value = ""
			if (result.status === "shared") return "Shared"
			return result.email_sent
				? "Invite sent. They get access when they sign up with this email."
				: "Invite saved. This site can't send email, so tell them to sign up with this address."
		},
	)
}

const change = (entry, next) =>
	next !== entry.level &&
	act(
		() => api("share.change_level", { board: props.board.name, user: entry.user, level: next }),
		"Access updated",
	)
const remove = (entry) =>
	act(
		() => api("share.remove_person", { board: props.board.name, user: entry.user }),
		`${entry.full_name} removed`,
	)
const cancel = (invite) =>
	act(
		() => api("share.cancel_invite", { board: props.board.name, email: invite.email }),
		"Invite withdrawn",
	)
</script>

<template>
	<Dialog v-model="open" :options="{ title: `Share “${board.title}”`, size: 'xl' }">
		<template #body-content>
			<form class="mb-5 flex items-end gap-2" data-testid="share-form" @submit.prevent="add">
				<FormControl
					v-model="person"
					class="flex-1"
					type="text"
					label="Add people"
					placeholder="Email address"
					autocomplete="off"
				/>
				<Select
					v-model="level"
					class="w-36"
					:options="levelOptions"
					aria-label="Access for the new person"
				/>
				<Button
					type="submit"
					variant="solid"
					label="Share"
					:loading="busy"
					:disabled="!person.trim()"
				/>
			</form>

			<p v-if="loading && !people.length" class="py-4 text-center text-sm text-ink-gray-5">
				Loading…
			</p>
			<p
				v-else-if="!people.length && !invites.length"
				class="py-3 text-sm text-ink-gray-5"
				data-testid="share-empty"
			>
				Nobody has been given access to this board by name yet. People in the workspace can
				already open it.
			</p>
			<ul
				v-if="people.length"
				class="divide-y divide-outline-gray-1"
				aria-label="People with access"
				data-testid="share-people"
			>
				<li
					v-for="entry in people"
					:key="entry.user"
					class="flex items-center gap-3 py-2.5"
				>
					<Avatar :label="entry.full_name" :image="entry.user_image" size="lg" />
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium text-ink-gray-9">
							{{ entry.full_name }}
							<span v-if="entry.user === session.user?.name" class="text-ink-gray-5"
								>(you)</span
							>
						</p>
						<p class="truncate text-xs text-ink-gray-5">{{ entry.user }}</p>
					</div>
					<Select
						v-if="entry.can_change"
						class="w-36"
						:model-value="entry.level"
						:options="levelOptions"
						:aria-label="`Access of ${entry.full_name}`"
						@update:model-value="(next) => change(entry, next)"
					/>
					<span v-else class="text-sm text-ink-gray-6">{{
						levelOptions.find((o) => o.value === entry.level)?.label
					}}</span>
					<Button
						v-if="entry.can_change"
						icon="user-x"
						variant="ghost"
						size="sm"
						:title="`Remove ${entry.full_name}`"
						@click="remove(entry)"
					/>
				</li>
			</ul>

			<template v-if="invites.length">
				<h3 class="mb-1 mt-5 text-xs font-medium text-ink-gray-6">Waiting to sign up</h3>
				<ul class="divide-y divide-outline-gray-1" aria-label="Invites waiting">
					<li
						v-for="invite in invites"
						:key="invite.email"
						class="flex items-center gap-3 py-2"
					>
						<span class="min-w-0 flex-1 truncate text-sm text-ink-gray-8">{{
							invite.email
						}}</span>
						<span class="text-xs text-ink-gray-5">{{
							levelOptions.find((o) => o.value === invite.access)?.label
						}}</span>
						<Button
							icon="x"
							variant="ghost"
							size="sm"
							:title="`Withdraw the invite to ${invite.email}`"
							@click="cancel(invite)"
						/>
					</li>
				</ul>
			</template>

			<ShareLinks :board="board" :open="open" class="mt-6" />
		</template>
	</Dialog>
</template>
