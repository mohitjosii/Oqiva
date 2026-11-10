<script setup>
// One group of the selection bar at the top of the board: an icon button that opens a small menu
// holding that group's controls. A coloured dot on the button shows the current colour, if any.
import { Popover } from "frappe-ui"

defineProps({
	label: { type: String, required: true },
	icon: { type: String, required: true }, // a lucide-… class
	swatch: { type: String, default: null }, // the current colour of this group
	wide: { type: Boolean, default: false },
})
</script>

<template>
	<Popover placement="bottom-start">
		<template #target="{ togglePopover, isOpen }">
			<button
				type="button"
				class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-gray-7 transition-colors hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
				:class="isOpen ? 'bg-surface-gray-3 text-ink-gray-9' : ''"
				:title="label"
				:aria-label="label"
				:aria-expanded="isOpen"
				:data-testid="`menu-${label}`"
				@click="togglePopover()"
			>
				<span :class="icon" class="block h-[18px] w-[18px]" aria-hidden="true" />
				<span
					v-if="swatch"
					class="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border border-outline-gray-3"
					:style="{ backgroundColor: swatch }"
					aria-hidden="true"
				/>
			</button>
		</template>
		<template #body-main>
			<div
				class="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-3 text-sm"
				:class="wide ? 'w-72' : 'w-60'"
				:data-testid="`menu-body-${label}`"
				@pointerdown.stop
				@dblclick.stop
				@wheel.stop
			>
				<slot />
			</div>
		</template>
	</Popover>
</template>
