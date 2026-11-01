<script setup>
// Says whether the board is safe. "Saved" appears only after the server has confirmed it.
import { FeatherIcon } from "frappe-ui"
import { computed } from "vue"

const props = defineProps({
	status: { type: String, default: "saved" },
	message: { type: String, default: "" },
	readonly: { type: Boolean, default: false },
})

const COPY = {
	saved: { text: "Saved", icon: "check", tone: "text-ink-gray-5" },
	pending: { text: "Unsaved changes", icon: "edit-3", tone: "text-ink-gray-6" },
	saving: { text: "Saving…", icon: "loader", tone: "text-ink-gray-6" },
	offline: { text: "Offline. Changes are kept.", icon: "wifi-off", tone: "text-ink-amber-3" },
	error: { text: "Couldn't save", icon: "alert-triangle", tone: "text-ink-red-3" },
	conflict: { text: "Changed elsewhere", icon: "alert-triangle", tone: "text-ink-red-3" },
}
const shown = computed(() =>
	props.readonly && props.status === "saved"
		? { text: "View only", icon: "eye", tone: "text-ink-gray-5" }
		: COPY[props.status] || COPY.saved,
)
</script>

<template>
	<p
		class="flex items-center gap-1.5 text-sm"
		:class="shown.tone"
		role="status"
		aria-live="polite"
		:title="message || undefined"
		data-testid="save-status"
	>
		<FeatherIcon
			:name="shown.icon"
			class="h-3.5 w-3.5"
			:class="status === 'saving' ? 'animate-spin' : ''"
			aria-hidden="true"
		/>
		<span>{{ shown.text }}</span>
	</p>
</template>
