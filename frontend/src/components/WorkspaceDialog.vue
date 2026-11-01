<script setup>
import { Dialog, FormControl, toast } from "frappe-ui"
import { computed, ref, watch } from "vue"
import { api } from "@/data/api"
import { refreshWorkspaces } from "@/data/session"
import { messageFor } from "@/utils/errors"

const props = defineProps({
	modelValue: { type: Boolean, required: true },
	workspace: { type: Object, default: null }, // present when renaming
})
const emit = defineEmits(["update:modelValue", "saved"])

const open = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
})
const name = ref("")
const busy = ref(false)
const renaming = computed(() => Boolean(props.workspace))

watch(open, (isOpen) => {
	if (isOpen) name.value = props.workspace?.workspace_name || ""
})

async function save() {
	if (!name.value.trim() || busy.value) return
	busy.value = true
	try {
		const result = renaming.value
			? await api("workspace.rename_workspace", {
					workspace: props.workspace.name,
					workspace_name: name.value,
				})
			: await api("workspace.create_workspace", { workspace_name: name.value })
		await refreshWorkspaces()
		toast.success(renaming.value ? "Workspace renamed" : "Workspace created")
		open.value = false
		emit("saved", result.name)
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<Dialog
		v-model="open"
		:options="{
			title: renaming ? 'Rename workspace' : 'Create workspace',
			size: 'sm',
			actions: [
				{
					label: renaming ? 'Save' : 'Create',
					variant: 'solid',
					loading: busy,
					disabled: !name.trim(),
					onClick: save,
				},
			],
		}"
	>
		<template #body-content>
			<form @submit.prevent="save">
				<FormControl
					v-model="name"
					label="Workspace name"
					maxlength="120"
					placeholder="Acme design team"
					autofocus
				/>
			</form>
		</template>
	</Dialog>
</template>
