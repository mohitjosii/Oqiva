<script setup>
// One row per notification: who did what, on which board, and when.
import { Avatar } from "frappe-ui"
import { timeAgo } from "@/engine/comments/model"

defineProps({ items: { type: Array, required: true } })
const emit = defineEmits(["open"])
</script>

<template>
	<ul
		class="divide-y divide-outline-gray-1"
		aria-label="Notifications"
		data-testid="notification-list"
	>
		<li v-for="item in items" :key="item.name">
			<button
				type="button"
				class="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-outline-gray-4"
				:class="item.board ? '' : 'cursor-default'"
				data-testid="notification"
				@click="emit('open', item)"
			>
				<Avatar :label="item.from_name || '?'" size="md" />
				<span class="min-w-0 flex-1">
					<span
						class="block text-sm text-ink-gray-9"
						:class="item.read ? '' : 'font-semibold'"
						>{{ item.subject }}</span
					>
					<span
						v-if="item.detail"
						class="mt-0.5 block truncate text-xs text-ink-gray-6"
						>{{ item.detail }}</span
					>
					<span class="mt-0.5 block text-xs text-ink-gray-5">{{
						timeAgo(item.creation)
					}}</span>
				</span>
				<span
					v-if="!item.read"
					class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600"
					role="img"
					aria-label="Unread"
				/>
			</button>
		</li>
	</ul>
</template>
