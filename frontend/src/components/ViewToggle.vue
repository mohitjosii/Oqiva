<script setup>
import { Button } from "frappe-ui"
import { preferences } from "@/data/preferences"
</script>

<template>
	<div
		class="flex items-center gap-0.5 rounded-md bg-surface-gray-2 p-0.5"
		role="group"
		aria-label="Board layout"
	>
		<Button
			icon="grid"
			size="sm"
			title="Grid"
			:variant="preferences.boardView === 'grid' ? 'subtle' : 'ghost'"
			:aria-pressed="preferences.boardView === 'grid'"
			@click="preferences.boardView = 'grid'"
		/>
		<Button
			icon="list"
			size="sm"
			title="List"
			:variant="preferences.boardView === 'list' ? 'subtle' : 'ghost'"
			:aria-pressed="preferences.boardView === 'list'"
			@click="preferences.boardView = 'list'"
		/>
	</div>
</template>
