<script setup>
import { Button } from "frappe-ui"
import TemplatePreview from "@/components/TemplatePreview.vue"

defineProps({
	template: { type: Object, required: true },
	canUse: { type: Boolean, default: true },
	busy: { type: Boolean, default: false },
	disabled: { type: Boolean, default: false },
})
defineEmits(["use"])
</script>

<template>
	<article
		class="flex h-full flex-col overflow-hidden rounded-lg border border-outline-gray-2 bg-surface-white transition-colors hover:border-outline-gray-3"
		:aria-labelledby="`template-${template.slug}`"
	>
		<div class="aspect-[16/10] border-b border-outline-gray-2 bg-surface-gray-1 p-3">
			<TemplatePreview :preview="template.preview" :label="`Preview of ${template.name}`" />
		</div>
		<div class="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
			<div class="flex items-start justify-between gap-2">
				<h2
					:id="`template-${template.slug}`"
					class="min-w-0 truncate text-base font-semibold text-ink-gray-9"
				>
					{{ template.name }}
				</h2>
				<span
					class="shrink-0 rounded-full bg-surface-gray-2 px-2 py-0.5 text-xs text-ink-gray-6"
					>{{ template.category }}</span
				>
			</div>
			<p v-if="template.description" class="line-clamp-2 text-sm text-ink-gray-6">
				{{ template.description }}
			</p>
			<div class="mt-auto pt-2">
				<Button
					v-if="canUse"
					variant="subtle"
					class="w-full"
					label="Use template"
					:aria-label="`Use template ${template.name}`"
					:loading="busy"
					:disabled="disabled"
					@click="$emit('use', template)"
				/>
			</div>
		</div>
	</article>
</template>
