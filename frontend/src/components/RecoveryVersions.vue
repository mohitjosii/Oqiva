<script setup>
// On the screen for a board whose stored content cannot be opened: the versions kept for it, so an
// editor can put one back. (A board that opens is restored from the history panel instead.)
import { Button, toast } from "frappe-ui"
import { onMounted, ref } from "vue"
import { api } from "@/data/api"
import { messageFor } from "@/utils/errors"

const props = defineProps({ board: { type: String, required: true } })
const emit = defineEmits(["restored"])

const versions = ref([])
const loading = ref(true)
const working = ref(null)

onMounted(async () => {
	try {
		versions.value = (await api("version.list_versions", { board: props.board })).versions
	} catch {
		versions.value = []
	} finally {
		loading.value = false
	}
})

async function restore(number) {
	working.value = number
	try {
		await api("version.restore_unopenable", { board: props.board, version_number: number })
		toast.success(`Restored version ${number}.`)
		emit("restored")
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		working.value = null
	}
}
const when = (value) => new Date(String(value).replace(" ", "T")).toLocaleString()
</script>

<template>
	<div v-if="!loading && versions.length" class="mt-5 text-left" data-testid="recovery-versions">
		<h3 class="text-sm font-medium text-ink-gray-9">Put an earlier version back</h3>
		<ul class="mt-2 max-h-56 space-y-1 overflow-y-auto">
			<li
				v-for="v in versions"
				:key="v.version_number"
				class="flex items-center gap-2 rounded-lg border border-outline-gray-2 px-2 py-1.5"
			>
				<span class="min-w-0 flex-1 truncate text-sm text-ink-gray-8">
					{{ v.label || `Version ${v.version_number}` }}
					<span class="block text-xs text-ink-gray-5">{{ when(v.created) }}</span>
				</span>
				<Button
					size="sm"
					variant="subtle"
					label="Restore"
					:loading="working === v.version_number"
					@click="restore(v.version_number)"
				/>
			</li>
		</ul>
	</div>
</template>
