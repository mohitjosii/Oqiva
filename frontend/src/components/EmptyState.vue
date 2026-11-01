<script setup>
import { FeatherIcon } from "frappe-ui"

defineProps({
	icon: { type: String, default: "layout" },
	title: { type: String, required: true },
	description: { type: String, default: "" },
})
</script>

<template>
	<div
		class="flex flex-col items-center justify-center rounded-lg border border-dashed border-outline-gray-3 px-6 py-14 text-center"
	>
		<div class="flex h-12 w-12 items-center justify-center rounded-full bg-surface-gray-2">
			<FeatherIcon :name="icon" class="h-5 w-5 text-ink-gray-5" />
		</div>
		<h3 class="mt-4 text-base font-semibold text-ink-gray-9">{{ title }}</h3>
		<p v-if="description" class="mt-1 max-w-sm text-sm text-ink-gray-6">{{ description }}</p>
		<div v-if="$slots.default" class="mt-5 flex gap-2"><slot /></div>
	</div>
</template>
