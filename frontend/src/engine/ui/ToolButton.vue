<script setup>
// One button of the bottom toolbar: an icon, with a small caret when it opens a menu. A fixed
// size, so the buttons never crowd or overlap whatever their icons are.
import { FeatherIcon } from "frappe-ui"

defineProps({
	icon: { type: String, default: null }, // a feather icon name, or a lucide-… class
	label: { type: String, default: null }, // text instead of an icon (the zoom level)
	title: { type: String, required: true },
	active: { type: Boolean, default: false },
	disabled: { type: Boolean, default: false },
	caret: { type: Boolean, default: false },
	pressed: { type: Boolean, default: undefined },
})
</script>

<template>
	<button
		type="button"
		class="inline-flex h-8 shrink-0 items-center justify-center gap-0.5 rounded-md text-ink-gray-7 transition-colors hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5 disabled:pointer-events-none disabled:opacity-40"
		:class="[
			active ? 'bg-surface-gray-3 text-ink-gray-9' : '',
			label ? 'min-w-[3.5rem] px-2 text-sm' : caret ? 'w-11' : 'w-8',
		]"
		:title="title"
		:aria-label="title"
		:aria-pressed="pressed ?? (active || undefined)"
		:disabled="disabled"
	>
		<span v-if="label" class="tabular-nums">{{ label }}</span>
		<span
			v-else-if="icon && icon.startsWith('lucide-')"
			:class="icon"
			class="block h-[18px] w-[18px]"
			aria-hidden="true"
		/>
		<FeatherIcon v-else :name="icon" class="h-[18px] w-[18px]" aria-hidden="true" />
		<FeatherIcon
			v-if="caret"
			name="chevron-down"
			class="h-3 w-3 text-ink-gray-5"
			aria-hidden="true"
		/>
	</button>
</template>
