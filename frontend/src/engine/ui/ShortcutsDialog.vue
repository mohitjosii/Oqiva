<script setup>
import { Dialog } from "frappe-ui"
import { computed } from "vue"
import { SHORTCUTS } from "../interaction/keymap"

const props = defineProps({ modelValue: { type: Boolean, required: true } })
const emit = defineEmits(["update:modelValue"])
const open = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
})

const groups = computed(() => {
	const byGroup = new Map()
	for (const shortcut of SHORTCUTS) {
		if (!byGroup.has(shortcut.group)) byGroup.set(shortcut.group, [])
		byGroup.get(shortcut.group).push(shortcut)
	}
	return [...byGroup]
})
</script>

<template>
	<Dialog v-model="open" :options="{ title: 'Keyboard shortcuts', size: 'lg' }">
		<template #body-content>
			<div class="grid max-h-[60vh] gap-5 overflow-y-auto pr-1 sm:grid-cols-2">
				<section v-for="[group, items] in groups" :key="group">
					<h3 class="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-gray-5">
						{{ group }}
					</h3>
					<ul class="flex flex-col gap-1.5">
						<li
							v-for="item in items"
							:key="item.label"
							class="flex items-center justify-between gap-3 text-sm"
						>
							<span class="text-ink-gray-7">{{ item.label }}</span>
							<span class="flex shrink-0 gap-1">
								<kbd
									v-for="key in item.keys"
									:key="key"
									class="rounded border border-outline-gray-2 bg-surface-gray-1 px-1.5 py-0.5 text-xs text-ink-gray-8"
									>{{ key }}</kbd
								>
							</span>
						</li>
					</ul>
				</section>
			</div>
		</template>
	</Dialog>
</template>
