<script setup>
// The curated colours plus the ones used lately. There is no free hex entry in v1, so every
// colour in a board comes from a short list.
import { BASICS, SWATCHES } from "../interaction/palette"

defineProps({
	modelValue: { type: String, default: undefined }, // the shared colour; undefined when mixed
	recent: { type: Array, default: () => [] },
	allowNone: { type: Boolean, default: false },
	noneLabel: { type: String, default: "No colour" },
	name: { type: String, required: true }, // which property, for test ids
})
defineEmits(["pick"])

const same = (a, b) =>
	typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase()
</script>

<template>
	<div class="flex flex-col gap-1.5" :data-testid="`swatches-${name}`">
		<div class="flex flex-wrap items-center gap-1">
			<button
				v-if="allowNone"
				type="button"
				class="relative h-5 w-5 overflow-hidden rounded-full border border-outline-gray-3 bg-surface-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
				:class="modelValue === null ? 'ring-2 ring-outline-gray-5 ring-offset-1' : ''"
				:title="noneLabel"
				:aria-label="noneLabel"
				:data-testid="`swatch-${name}-none`"
				@click="$emit('pick', null)"
			>
				<span class="absolute left-0 top-1/2 h-px w-full -rotate-45 bg-red-500" />
			</button>
			<button
				v-for="[label, hex] in BASICS"
				:key="hex"
				type="button"
				class="h-5 w-5 rounded-full border border-outline-gray-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
				:class="same(modelValue, hex) ? 'ring-2 ring-outline-gray-5 ring-offset-1' : ''"
				:style="{ backgroundColor: hex }"
				:title="label"
				:aria-label="label"
				:data-testid="`swatch-${name}-${hex}`"
				@click="$emit('pick', hex)"
			/>
		</div>
		<div class="grid grid-cols-9 gap-1">
			<template v-for="tone in 3" :key="tone">
				<button
					v-for="[label, tones] in SWATCHES"
					:key="`${label}-${tone}`"
					type="button"
					class="h-4 w-4 rounded-sm border border-outline-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
					:class="
						same(modelValue, tones[tone - 1])
							? 'ring-2 ring-outline-gray-5 ring-offset-1'
							: ''
					"
					:style="{ backgroundColor: tones[tone - 1] }"
					:title="`${label} ${['light', 'medium', 'deep'][tone - 1]}`"
					:aria-label="`${label} ${['light', 'medium', 'deep'][tone - 1]}`"
					:data-testid="`swatch-${name}-${tones[tone - 1]}`"
					@click="$emit('pick', tones[tone - 1])"
				/>
			</template>
		</div>
		<div
			v-if="recent.length"
			class="flex flex-wrap items-center gap-1"
			:data-testid="`recent-${name}`"
		>
			<span class="mr-1 text-[10px] uppercase tracking-wide text-ink-gray-5">Recent</span>
			<button
				v-for="hex in recent"
				:key="hex"
				type="button"
				class="h-4 w-4 rounded-full border border-outline-gray-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
				:style="{ backgroundColor: hex }"
				:title="`Recent colour ${hex}`"
				:aria-label="`Recent colour ${hex}`"
				@click="$emit('pick', hex)"
			/>
		</div>
	</div>
</template>
