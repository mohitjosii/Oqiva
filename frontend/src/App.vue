<script setup>
import { FrappeUIProvider, Button, LoadingIndicator } from "frappe-ui"
import { onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { session } from "@/data/session"

const router = useRouter()
const ready = ref(false)

function reload() {
	window.location.reload()
}

onMounted(() => router.isReady().then(() => (ready.value = true)))
</script>

<template>
	<FrappeUIProvider>
		<div v-if="!ready" class="flex h-screen items-center justify-center" role="status">
			<LoadingIndicator class="h-6 w-6 text-ink-gray-5" />
			<span class="sr-only">Loading Oqiva</span>
		</div>
		<div v-else-if="session.error" class="flex h-screen items-center justify-center p-6">
			<div
				class="w-full max-w-md rounded-lg border border-outline-gray-2 bg-surface-white p-6 text-center"
			>
				<p class="text-lg font-semibold text-ink-gray-9">Oqiva couldn't start</p>
				<p class="mt-1 text-sm text-ink-gray-6">{{ session.error.message }}</p>
				<Button class="mt-4" variant="solid" label="Try again" @click="reload" />
			</div>
		</div>
		<router-view v-else />
		<Dialogs />
	</FrappeUIProvider>
</template>
