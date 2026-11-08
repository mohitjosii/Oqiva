<script setup>
// One icon button in the right palette. frappe-ui's Button drops aria-label, so the name
// goes in `title`, which screen readers also announce.
import { Button } from "frappe-ui"

defineProps({
	icon: { type: String, default: null }, // a lucide-… class
	label: { type: String, default: null },
	title: { type: String, required: true },
	active: { type: Boolean, default: false },
	disabled: { type: Boolean, default: false },
	testid: { type: String, default: null },
})
defineEmits(["click"])
</script>

<template>
	<Button
		:icon="label ? null : icon"
		:icon-left="label ? icon : null"
		:label="label"
		size="sm"
		:variant="active ? 'subtle' : 'ghost'"
		:title="title"
		:disabled="disabled"
		:aria-pressed="active"
		:data-testid="testid ? `tile-${testid}` : null"
		@click="$emit('click')"
	/>
</template>
