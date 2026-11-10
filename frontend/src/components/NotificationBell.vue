<script setup>
// The bell: how many are unread, and the latest few. Everything else is on the notifications page.
import { Button, Popover } from "frappe-ui"
import { watch } from "vue"
import { useRouter } from "vue-router"
import { homeWorkspace } from "@/data/session"
import { loadNotifications, markAllRead, markRead, notifications } from "@/data/notifications"
import NotificationList from "./NotificationList.vue"

const router = useRouter()
const SHOWN = 6

async function opened() {
	await loadNotifications()
}

// The list is kept ready, so opening the bell shows it at once: it loads now and again whenever the
// unread count changes (a new notification arrived, or some were read).
watch(
	() => notifications.unread,
	() => loadNotifications(),
	{ immediate: true },
)

function seeAll(close) {
	close()
	router.push({ name: "notifications", params: { workspace: homeWorkspace() } })
}

async function open(item, close) {
	await markRead(item)
	if (!item.board) return
	close()
	router.push({ name: "board", params: { board: item.board } })
}
</script>

<template>
	<Popover placement="bottom-end" @open="opened">
		<template #target="{ togglePopover }">
			<span class="relative inline-flex">
				<Button
					icon="bell"
					variant="ghost"
					title="Notifications"
					data-testid="bell"
					@click="togglePopover()"
				/>
				<span
					v-if="notifications.unread"
					class="pointer-events-none absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-blue-600 px-1 text-center text-[10px] font-semibold leading-4 text-white"
					data-testid="bell-count"
					>{{ notifications.unread > 99 ? "99+" : notifications.unread }}</span
				>
			</span>
		</template>
		<template #body-main="{ close }">
			<div class="w-80" data-testid="bell-panel">
				<div
					class="flex items-center justify-between border-b border-outline-gray-2 px-3 py-2"
				>
					<span class="text-sm font-medium text-ink-gray-9">Notifications</span>
					<button
						v-if="notifications.unread"
						type="button"
						class="text-xs text-blue-700 hover:underline"
						@click="markAllRead"
					>
						Mark all read
					</button>
				</div>
				<p
					v-if="!notifications.items.length"
					class="px-3 py-6 text-center text-sm text-ink-gray-5"
				>
					Nothing yet.
				</p>
				<NotificationList
					:items="notifications.items.slice(0, SHOWN)"
					@open="(item) => open(item, close)"
				/>
				<div class="border-t border-outline-gray-2 px-3 py-2 text-center">
					<button
						type="button"
						class="text-xs text-blue-700 hover:underline"
						@click="seeAll(close)"
					>
						See all
					</button>
				</div>
			</div>
		</template>
	</Popover>
</template>
