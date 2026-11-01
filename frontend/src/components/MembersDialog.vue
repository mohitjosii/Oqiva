<script setup>
import { Avatar, Badge, Button, Dialog, FormControl, Select, toast } from "frappe-ui"
import { computed, ref, watch } from "vue"
import { api } from "@/data/api"
import { refreshWorkspaces, session } from "@/data/session"
import { messageFor } from "@/utils/errors"
import { ROLE_DESCRIPTIONS, workspacePowers } from "@/utils/roles"

const props = defineProps({
	modelValue: { type: Boolean, required: true },
	workspace: { type: Object, required: true },
})
const emit = defineEmits(["update:modelValue"])

const open = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
})
const members = ref([])
const loading = ref(false)
const email = ref("")
const inviteRole = ref("Member")
const busy = ref(false)
const powers = computed(() => workspacePowers(props.workspace))
const isOwner = computed(() => props.workspace.role === "Owner")

const roleOptions = computed(() =>
	["Admin", "Member", "Guest"].map((role) => ({
		label: role,
		value: role,
		description: ROLE_DESCRIPTIONS[role],
	})),
)
const inviteRoleOptions = computed(() =>
	roleOptions.value.filter((o) => o.value !== "Admin" || isOwner.value),
)

function editable(member) {
	if (!powers.value.canManageMembers || member.user === session.user?.name) return false
	if (member.role === "Owner") return false
	return member.role !== "Admin" || isOwner.value
}

async function load() {
	loading.value = true
	try {
		members.value = await api("workspace.list_members", { workspace: props.workspace.name })
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		loading.value = false
	}
}

watch(open, (isOpen) => {
	if (isOpen) {
		email.value = ""
		inviteRole.value = "Member"
		load()
	}
})

async function act(work, success) {
	busy.value = true
	try {
		const result = await work()
		if (success) toast.success(typeof success === "function" ? success(result) : success)
		await load()
		await refreshWorkspaces()
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		busy.value = false
	}
}

const changeRole = (member, role) =>
	role !== member.role &&
	act(
		() =>
			api("workspace.change_member_role", {
				workspace: props.workspace.name,
				user: member.user,
				role,
			}),
		"Role updated",
	)
const remove = (member) =>
	act(
		() =>
			api("workspace.remove_member", { workspace: props.workspace.name, user: member.user }),
		`${member.full_name} removed`,
	)

function invite() {
	if (!email.value.trim()) return
	return act(
		() =>
			api("workspace.invite_member", {
				workspace: props.workspace.name,
				email: email.value,
				role: inviteRole.value,
			}),
		(result) => {
			email.value = ""
			if (result.status === "added") return "Added to the workspace"
			return result.email_sent
				? "Invite sent. They join when they sign up with this email."
				: "Invite saved. This site can't send email, so tell them to sign up with this address."
		},
	)
}
</script>

<template>
	<Dialog
		v-model="open"
		:options="{ title: `Members of ${workspace.workspace_name}`, size: 'xl' }"
	>
		<template #body-content>
			<form
				v-if="powers.canManageMembers"
				class="mb-5 flex items-end gap-2"
				@submit.prevent="invite"
			>
				<FormControl
					v-model="email"
					class="flex-1"
					type="email"
					label="Invite by email"
					placeholder="name@company.com"
				/>
				<Select v-model="inviteRole" class="w-32" :options="inviteRoleOptions" />
				<Button
					type="submit"
					variant="solid"
					label="Invite"
					:loading="busy"
					:disabled="!email.trim()"
				/>
			</form>

			<p v-if="loading && !members.length" class="py-6 text-center text-sm text-ink-gray-5">
				Loading members…
			</p>
			<ul v-else class="divide-y divide-outline-gray-1" aria-label="Members">
				<li
					v-for="member in members"
					:key="member.user"
					class="flex items-center gap-3 py-2.5"
				>
					<Avatar :label="member.full_name" :image="member.user_image" size="lg" />
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium text-ink-gray-9">
							{{ member.full_name }}
							<span v-if="member.user === session.user?.name" class="text-ink-gray-5"
								>(you)</span
							>
						</p>
						<p class="truncate text-xs text-ink-gray-5">{{ member.user }}</p>
					</div>
					<Select
						v-if="editable(member)"
						class="w-32"
						:model-value="member.role"
						:options="roleOptions"
						:aria-label="`Role of ${member.full_name}`"
						@update:model-value="(role) => changeRole(member, role)"
					/>
					<Badge
						v-else
						:label="member.role"
						:theme="member.role === 'Owner' ? 'blue' : 'gray'"
					/>
					<Button
						v-if="editable(member)"
						icon="user-x"
						variant="ghost"
						size="sm"
						:title="`Remove ${member.full_name}`"
						@click="remove(member)"
					/>
				</li>
			</ul>
		</template>
	</Dialog>
</template>
