<script setup>
import { Button, FormControl, toast } from "frappe-ui"
import { computed, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { api } from "@/data/api"
import { preferences } from "@/data/preferences"
import { findWorkspace, homeWorkspace, refreshWorkspaces, session } from "@/data/session"
import { messageFor } from "@/utils/errors"

const router = useRouter()
const route = useRoute()
const logo = "/assets/oqiva/images/oqiva-logo.svg" // served by Frappe, not bundled
const personal = computed(() => findWorkspace(session.personalWorkspace))
const name = ref(personal.value?.workspace_name || "")
const busy = ref(false)

// Where the person was going before the welcome page got in the way (a shared link, say).
const next = computed(() => {
	const wanted = String(route.query.next || "")
	return wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : null
})

function finish() {
	preferences.welcomed = true
	api("boot.mark_welcomed").catch(() => {}) // the next device will not ask again; this one already will not
	if (next.value) router.replace(next.value)
	else router.replace({ name: "dashboard", params: { workspace: homeWorkspace() } })
}

async function save() {
	busy.value = true
	try {
		const trimmed = name.value.trim()
		if (trimmed && personal.value && trimmed !== personal.value.workspace_name) {
			await api("workspace.rename_workspace", {
				workspace: personal.value.name,
				workspace_name: trimmed,
			})
			await refreshWorkspaces()
		}
		finish()
	} catch (error) {
		toast.error(messageFor(error))
		busy.value = false
	}
}
</script>

<template>
	<div class="flex min-h-screen items-center justify-center bg-surface-gray-1 p-6">
		<form
			class="w-full max-w-md rounded-xl border border-outline-gray-2 bg-surface-white p-8 shadow-sm"
			@submit.prevent="save"
		>
			<img :src="logo" alt="" class="h-10 w-10" />
			<h1 class="mt-5 text-2xl font-semibold text-ink-gray-9">
				Welcome to Oqiva, {{ session.user.full_name.split(" ")[0] }}
			</h1>
			<p class="mt-2 text-sm text-ink-gray-6">
				Boards, flows and ideas in one shared space. Name your workspace to get started. You
				can change it later.
			</p>
			<FormControl
				v-model="name"
				class="mt-6"
				label="Workspace name"
				maxlength="120"
				autofocus
			/>
			<div class="mt-6 flex items-center justify-between">
				<Button variant="ghost" label="Skip for now" type="button" @click="finish" />
				<Button variant="solid" label="Continue" type="submit" :loading="busy" />
			</div>
		</form>
	</div>
</template>
