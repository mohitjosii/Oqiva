<script setup>
import { Button, LoadingIndicator } from "frappe-ui"
import { onMounted } from "vue"
import { useRouter } from "vue-router"
import NotificationList from "@/components/NotificationList.vue"
import PageHeader from "@/components/PageHeader.vue"
import { loadNotifications, markAllRead, markRead, notifications } from "@/data/notifications"

const router = useRouter()
onMounted(() => loadNotifications())

async function open(item) {
	await markRead(item)
	if (item.board) router.push({ name: "board", params: { board: item.board } })
}
</script>

<template>
	<div class="mx-auto max-w-3xl p-6">
		<PageHeader title="Notifications" subtitle="Shares, mentions and replies on your boards.">
			<template #actions>
				<Button
					label="Mark all read"
					variant="subtle"
					:disabled="!notifications.unread"
					data-testid="mark-all-read"
					@click="markAllRead"
				/>
			</template>
		</PageHeader>
		<div
			v-if="notifications.loading && !notifications.items.length"
			class="flex justify-center py-10"
			role="status"
		>
			<LoadingIndicator class="h-5 w-5 text-ink-gray-5" />
		</div>
		<p
			v-else-if="!notifications.items.length"
			class="py-10 text-center text-sm text-ink-gray-5"
			data-testid="notifications-empty"
		>
			You have no notifications yet.
		</p>
		<div
			v-else
			class="overflow-hidden rounded-lg border border-outline-gray-2 bg-surface-white"
		>
			<NotificationList :items="notifications.items" @open="open" />
		</div>
		<div v-if="notifications.hasMore" class="mt-3 text-center">
			<Button
				label="Show more"
				variant="subtle"
				:loading="notifications.loading"
				@click="loadNotifications({ more: true })"
			/>
		</div>
	</div>
</template>
