import { reactive, watch } from "vue"
import { readStored, writeStored } from "@/utils/storage"

const KEY = "oqiva.preferences"
const DEFAULTS = { sidebarCollapsed: false, boardView: "grid", theme: "light", welcomed: false }

export const preferences = reactive({ ...DEFAULTS, ...readStored(KEY, {}) })

watch(preferences, (value) => writeStored(KEY, { ...value }), { deep: true })

export function applyTheme(theme = preferences.theme) {
	const resolved =
		theme === "system"
			? window.matchMedia?.("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light"
			: theme
	document.documentElement.setAttribute("data-theme", resolved)
}

export function toggleTheme() {
	preferences.theme = preferences.theme === "dark" ? "light" : "dark"
	applyTheme()
}
