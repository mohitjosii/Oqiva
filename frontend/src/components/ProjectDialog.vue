<script setup>
import { Dialog, FormControl, toast } from "frappe-ui"
import { computed, ref, watch } from "vue"
import { api } from "@/data/api"
import { reloadProjects } from "@/data/projects"
import { PROJECT_COLORS } from "@/utils/colors"
import { messageFor } from "@/utils/errors"

const props = defineProps({
	modelValue: { type: Boolean, required: true },
	workspace: { type: String, required: true },
	project: { type: Object, default: null }, // present when editing
})
const emit = defineEmits(["update:modelValue", "saved"])

const open = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
})
const form = ref({ project_name: "", description: "", color: "blue" })
const busy = ref(false)
const editing = computed(() => Boolean(props.project))

watch(open, (isOpen) => {
	if (!isOpen) return
	form.value = {
		project_name: props.project?.project_name || "",
		description: props.project?.description || "",
		color: props.project?.color || "blue",
	}
})

async function save() {
	if (!form.value.project_name.trim() || busy.value) return
	busy.value = true
	try {
		const result = editing.value
			? await api("project.update_project", { project: props.project.name, ...form.value })
			: await api("project.create_project", { workspace: props.workspace, ...form.value })
		await reloadProjects()
		toast.success(editing.value ? "Project updated" : "Project created")
		open.value = false
		emit("saved", result)
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
			title: editing ? 'Project settings' : 'Create project',
			size: 'md',
			actions: [
				{
					label: editing ? 'Save' : 'Create',
					variant: 'solid',
					loading: busy,
					disabled: !form.project_name.trim(),
					onClick: save,
				},
			],
		}"
	>
		<template #body-content>
			<form class="flex flex-col gap-4" @submit.prevent="save">
				<FormControl v-model="form.project_name" label="Name" maxlength="120" autofocus />
				<FormControl
					v-model="form.description"
					type="textarea"
					label="Description"
					:rows="3"
				/>
				<fieldset>
					<legend class="mb-1.5 text-xs text-ink-gray-5">Colour</legend>
					<div class="flex flex-wrap gap-2">
						<button
							v-for="(value, name) in PROJECT_COLORS"
							:key="name"
							type="button"
							class="h-6 w-6 rounded-full ring-offset-2 ring-offset-surface-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
							:class="form.color === name ? 'ring-2 ring-outline-gray-5' : ''"
							:style="{ backgroundColor: value }"
							:aria-label="name"
							:aria-pressed="form.color === name"
							@click="form.color = name"
						/>
					</div>
				</fieldset>
			</form>
		</template>
	</Dialog>
</template>
