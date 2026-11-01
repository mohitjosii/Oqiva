<script setup>
import { Button, FeatherIcon } from "frappe-ui"

defineProps({ error: { type: Object, required: true } })
defineEmits(["retry"])
</script>

<template>
	<div
		role="alert"
		class="flex flex-col items-center rounded-lg border border-outline-red-1 bg-surface-red-1 px-6 py-10 text-center"
	>
		<FeatherIcon name="alert-circle" class="h-6 w-6 text-ink-red-3" />
		<p class="mt-3 text-sm font-medium text-ink-gray-9">{{ error.message }}</p>
		<Button
			v-if="!error.isNotFound && !error.isForbidden"
			class="mt-4"
			label="Try again"
			@click="$emit('retry')"
		/>
	</div>
</template>
