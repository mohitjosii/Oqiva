<script setup>
import { Avatar, Dropdown, FeatherIcon } from "frappe-ui"
import { computed } from "vue"
import { useRouter } from "vue-router"
import { session } from "@/data/session"
import { workspacePowers } from "@/utils/roles"

const props = defineProps({
	workspace: { type: Object, required: true },
	collapsed: { type: Boolean, default: false },
})
const emit = defineEmits(["create", "rename", "members", "delete", "leave"])
const router = useRouter()
const powers = computed(() => workspacePowers(props.workspace))

const options = computed(() => [
	{
		group: "Workspaces",
		items: session.workspaces.map((item) => ({
			label: item.workspace_name,
			icon: item.name === props.workspace.name ? "check" : "briefcase",
			onClick: () => router.push({ name: "dashboard", params: { workspace: item.name } }),
		})),
	},
	{
		group: "This workspace",
		hideLabel: true,
		items: [
			{ label: "Members", icon: "users", onClick: () => emit("members") },
			{
				label: "Rename",
				icon: "edit-2",
				condition: () => powers.value.canRename,
				onClick: () => emit("rename"),
			},
			{
				label: "Leave workspace",
				icon: "log-out",
				condition: () => powers.value.canLeave,
				onClick: () => emit("leave"),
			},
			{
				label: "Delete workspace",
				icon: "trash-2",
				theme: "red",
				condition: () => powers.value.canDelete,
				onClick: () => emit("delete"),
			},
		],
	},
	{
		group: "New",
		hideLabel: true,
		items: [{ label: "Create workspace", icon: "plus", onClick: () => emit("create") }],
	},
])
</script>

<template>
	<Dropdown :options="options" placement="left">
		<template #default="{ open }">
			<button
				type="button"
				class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-4"
				:class="open ? 'bg-surface-gray-2' : ''"
				:aria-label="`Workspace: ${workspace.workspace_name}. Switch workspace`"
			>
				<Avatar :label="workspace.workspace_name" shape="square" size="lg" />
				<span v-if="!collapsed" class="min-w-0 flex-1">
					<span class="block truncate text-sm font-semibold text-ink-gray-9">{{
						workspace.workspace_name
					}}</span>
					<span class="block truncate text-xs text-ink-gray-5"
						>{{ workspace.role }} · {{ workspace.member_count }}
						{{ workspace.member_count === 1 ? "member" : "members" }}</span
					>
				</span>
				<FeatherIcon
					v-if="!collapsed"
					name="chevron-down"
					class="h-4 w-4 shrink-0 text-ink-gray-5"
					aria-hidden="true"
				/>
			</button>
		</template>
	</Dropdown>
</template>
