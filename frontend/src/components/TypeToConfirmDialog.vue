<script setup>
import { Dialog, FormControl } from "frappe-ui"
import { computed, ref, watch } from "vue"

const props = defineProps({
	modelValue: { type: Boolean, required: true },
	title: { type: String, required: true },
	message: { type: String, required: true },
	phrase: { type: String, required: true },
	confirmLabel: { type: String, default: "Delete" },
	busy: { type: Boolean, default: false },
})
const emit = defineEmits(["update:modelValue", "confirm"])

const open = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
})
const typed = ref("")
const matches = computed(() => typed.value.trim() === props.phrase)

watch(open, (isOpen) => isOpen && (typed.value = ""))
const confirm = () => matches.value && emit("confirm")
</script>

<template>
	<Dialog
		v-model="open"
		:options="{
			title,
			size: 'md',
			actions: [
				{
					label: confirmLabel,
					variant: 'solid',
					theme: 'red',
					loading: busy,
					disabled: !matches,
					onClick: confirm,
				},
			],
		}"
	>
		<template #body-content>
			<p class="mb-3 text-sm text-ink-gray-7">
				{{ message }} Type <strong class="text-ink-gray-9">{{ phrase }}</strong> to confirm.
			</p>
			<FormControl v-model="typed" :placeholder="phrase" @keydown.enter.prevent="confirm" />
		</template>
	</Dialog>
</template>
