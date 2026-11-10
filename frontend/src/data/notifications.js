import { reactive } from "vue"
import { api } from "@/data/api"
import { getSocket } from "@/data/socket"

// The person's Oqiva notifications. The count is kept current by the live link (Frappe tells the
// page when a new one is written), so nothing polls.
export const notifications = reactive({ items: [], unread: 0, hasMore: false, loading: false })

const PAGE = 20

export async function loadNotifications({ more = false } = {}) {
	notifications.loading = true
	try {
		const start = more ? notifications.items.length : 0
		const page = await api("notification.list_notifications", { limit: PAGE, start })
		notifications.items = more ? [...notifications.items, ...page.items] : page.items
		notifications.hasMore = page.has_more
		notifications.unread = page.unread
	} finally {
		notifications.loading = false
	}
}

export async function refreshUnread() {
	try {
		notifications.unread = (await api("notification.unread_count")).unread
	} catch {
		// the count stays as it was
	}
}

export async function markRead(item) {
	if (item.read) return
	item.read = true
	notifications.unread = Math.max(0, notifications.unread - 1)
	try {
		notifications.unread = (await api("notification.mark_read", { name: item.name })).unread
	} catch {
		item.read = false
		await refreshUnread()
	}
}

export async function markAllRead() {
	notifications.items.forEach((item) => (item.read = true))
	notifications.unread = 0
	try {
		await api("notification.mark_all_read")
	} catch {
		await loadNotifications()
	}
}

let started = false
// Starts listening for new notifications (once per page).
export function startNotifications() {
	if (started) return
	started = true
	refreshUnread()
	const socket = getSocket()
	let timer = null
	socket?.on("notification", () => {
		clearTimeout(timer)
		timer = setTimeout(() => {
			refreshUnread()
			if (notifications.items.length) loadNotifications()
		}, 300)
	})
}
