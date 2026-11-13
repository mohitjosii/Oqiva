<script setup>
// A text size the person types (8 to 200), with a small list of common sizes beside it. Enter or
// leaving the field applies it; Escape puts back what was there. An empty value in a "mixed"
// selection shows a dash, and a number outside the range is pulled to the nearest limit.
import { Dropdown } from "frappe-ui"
import { computed, ref, watch } from "vue"

const props = defineProps({
	modelValue: { type: Number, default: null }, // null or undefined: mixed, or not set
	presets: { type: Array, default: () => [12, 14, 16, 18, 20, 24, 32, 48, 64] },
	min: { type: Number, default: 8 },
	max: { type: Number, default: 200 },
	testid: { type: String, default: "text-size" },
	label: { type: String, default: "Text size" },
})
const emit = defineEmits(["update:modelValue"])

const draft = ref("")
watch(
	() => props.modelValue,
	(value) => (draft.value = typeof value === "number" ? String(value) : ""),
	{ immediate: true },
)

function apply(value) {
	const number = Number(value)
	if (value === "" || !Number.isFinite(number)) {
		draft.value = typeof props.modelValue === "number" ? String(props.modelValue) : ""
		return
	}
	const size = Math.min(props.max, Math.max(props.min, Math.round(number)))
	draft.value = String(size)
	if (size !== props.modelValue) emit("update:modelValue", size)
}

// Enter applies the number and hands the keyboard back to the board, so its shortcuts work again.
function applyAndLeave(event, value) {
	apply(value)
	event.target.blur()
}

const options = computed(() =>
	props.presets.map((size) => ({
		label: `${size}`,
		icon: size === props.modelValue ? "check" : null,
		onClick: () => apply(size),
	})),
)
</script>

<template>
	<span class="inline-flex items-center rounded border border-outline-gray-2 bg-surface-white">
		<input
			v-model="draft"
			type="number"
			inputmode="numeric"
			:min="min"
			:max="max"
			:placeholder="modelValue === null || modelValue === undefined ? '–' : ''"
			:aria-label="label"
			class="w-12 rounded-l bg-transparent px-1.5 py-0.5 text-center text-xs text-ink-gray-9 [appearance:textfield] focus:outline-none focus:ring-1 focus:ring-outline-gray-5 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			:data-testid="testid"
			@mousedown.stop
			@keydown.stop
			@keydown.enter.prevent="applyAndLeave($event, draft)"
			@keydown.esc.prevent="draft = typeof modelValue === 'number' ? String(modelValue) : ''"
			@change="apply(draft)"
		/>
		<Dropdown :options="options">
			<button
				type="button"
				class="flex h-5 w-5 items-center justify-center rounded-r text-ink-gray-6 hover:bg-surface-gray-2"
				:aria-label="`${label} presets`"
				:data-testid="`${testid}-presets`"
			>
				<span class="lucide-chevron-down block h-3.5 w-3.5" aria-hidden="true" />
			</button>
		</Dropdown>
	</span>
</template>
