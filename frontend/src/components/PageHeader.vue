<script setup>
defineProps({
	title: { type: String, required: true },
	subtitle: { type: String, default: "" },
})
</script>

<template>
	<header class="flex flex-wrap items-start justify-between gap-3 pb-5">
		<div class="min-w-0">
			<h1 class="flex items-center gap-2 truncate text-xl font-semibold text-ink-gray-9">
				<slot name="title-prefix" />
				<span class="truncate">{{ title }}</span>
			</h1>
			<p v-if="subtitle" class="mt-1 max-w-2xl text-sm text-ink-gray-6">{{ subtitle }}</p>
		</div>
		<div class="flex shrink-0 items-center gap-2"><slot name="actions" /></div>
	</header>
</template>
