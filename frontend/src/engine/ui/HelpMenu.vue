<script setup>
// A small "?" at the bottom left of the board: the shortcuts list, and the few tips that get a new person
// going. Phones have no keyboard, so it is left off there.
import { Dropdown } from "frappe-ui"
import { computed } from "vue"

const props = defineProps({ tipsOpen: { type: Boolean, default: false } })
const emit = defineEmits(["shortcuts", "tips"])

const options = computed(() => [
	{ label: "Quick tips", icon: "lightbulb", onClick: () => emit("tips") },
	{ label: "Keyboard shortcuts", icon: "command", onClick: () => emit("shortcuts") },
])
void props
</script>

<template>
	<div
		class="absolute bottom-4 left-4 z-10 hidden md:block"
		data-print="hide"
		@pointerdown.stop
		@dblclick.stop
	>
		<Dropdown :options="options" placement="top-start">
			<button
				type="button"
				class="flex h-9 w-9 items-center justify-center rounded-full border border-outline-gray-2 bg-surface-white text-ink-gray-7 shadow-lg hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
				title="Help: tips and shortcuts"
				aria-label="Help: tips and shortcuts"
				data-testid="help-button"
			>
				<span class="lucide-circle-help block h-5 w-5" aria-hidden="true" />
			</button>
		</Dropdown>
	</div>
</template>
