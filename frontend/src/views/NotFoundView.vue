<script setup>
import { Button } from "frappe-ui"
import { homeWorkspace } from "@/data/session"
</script>

<template>
	<div class="flex h-screen flex-col items-center justify-center gap-2 p-6 text-center">
		<p class="text-5xl font-semibold text-ink-gray-4">404</p>
		<h1 class="text-lg font-semibold text-ink-gray-9">This page doesn't exist</h1>
		<p class="max-w-sm text-sm text-ink-gray-6">
			The link may be wrong, or the board may have been deleted or moved.
		</p>
		<Button
			class="mt-3"
			variant="solid"
			label="Go to your workspace"
			:route="{ name: 'dashboard', params: { workspace: homeWorkspace() } }"
		/>
	</div>
</template>
