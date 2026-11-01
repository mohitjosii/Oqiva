<script setup>
import { Dialog, FeatherIcon, FormControl } from "frappe-ui"
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { api } from "@/data/api"
import { colorValue } from "@/utils/colors"
import { messageFor } from "@/utils/errors"

const props = defineProps({ modelValue: { type: Boolean, required: true } })
const emit = defineEmits(["update:modelValue"])

const router = useRouter()
const open = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
})
const text = ref("")
const results = ref({ boards: [], projects: [] })
const loading = ref(false)
const failure = ref("")
const active = ref(0)
const MIN = 2
let timer = null
let latest = 0

const rows = computed(() => [
	...results.value.boards.map((b) => ({
		kind: "board",
		key: b.name,
		title: b.title,
		hint: b.description,
		row: b,
	})),
	...results.value.projects.map((p) => ({
		kind: "project",
		key: p.name,
		title: p.project_name,
		hint: p.description,
		row: p,
	})),
])
const searched = computed(() => text.value.trim().length >= MIN)

async function search() {
	const ticket = ++latest
	failure.value = ""
	loading.value = true
	try {
		const found = await api("search.query", { text: text.value })
		if (ticket === latest) {
			results.value = found
			active.value = 0
		}
	} catch (error) {
		if (ticket === latest) failure.value = messageFor(error)
	} finally {
		if (ticket === latest) loading.value = false
	}
}

watch(text, (value) => {
	clearTimeout(timer)
	if (value.trim().length < MIN) {
		latest++
		results.value = { boards: [], projects: [] }
		loading.value = false
		return
	}
	timer = setTimeout(search, 250)
})
watch(open, async (isOpen) => {
	if (isOpen) {
		text.value = ""
		await nextTick()
	}
})
onBeforeUnmount(() => clearTimeout(timer))

function go(item) {
	if (!item) return
	open.value = false
	if (item.kind === "board") router.push({ name: "board", params: { board: item.row.name } })
	else
		router.push({
			name: "project",
			params: { workspace: item.row.workspace, project: item.row.name },
		})
}

function onKey(event) {
	if (event.key === "ArrowDown") active.value = Math.min(active.value + 1, rows.value.length - 1)
	else if (event.key === "ArrowUp") active.value = Math.max(active.value - 1, 0)
	else if (event.key === "Enter") go(rows.value[active.value])
	else return
	event.preventDefault()
}
</script>

<template>
	<Dialog v-model="open" :options="{ size: 'xl', position: 'top', paddingTop: '12vh' }">
		<template #body>
			<div class="p-3" @keydown="onKey">
				<FormControl
					v-model="text"
					type="search"
					placeholder="Search boards and projects"
					autofocus
					aria-label="Search"
				/>
				<div class="mt-2 max-h-80 overflow-y-auto" aria-live="polite">
					<p v-if="failure" class="px-2 py-6 text-center text-sm text-ink-red-3">
						{{ failure }}
					</p>
					<p v-else-if="!searched" class="px-2 py-6 text-center text-sm text-ink-gray-5">
						Type at least {{ MIN }} characters.
					</p>
					<p
						v-else-if="loading && !rows.length"
						class="px-2 py-6 text-center text-sm text-ink-gray-5"
					>
						Searching…
					</p>
					<p
						v-else-if="!rows.length"
						class="px-2 py-6 text-center text-sm text-ink-gray-5"
					>
						No boards or projects match "{{ text.trim() }}".
					</p>
					<ul v-else role="listbox" aria-label="Results">
						<li
							v-for="(item, index) in rows"
							:key="`${item.kind}:${item.key}`"
							role="option"
							:aria-selected="index === active"
							class="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2"
							:class="index === active ? 'bg-surface-gray-2' : ''"
							@mouseenter="active = index"
							@click="go(item)"
						>
							<FeatherIcon
								:name="item.kind === 'board' ? 'layout' : 'folder'"
								class="h-4 w-4 shrink-0"
								:style="
									item.kind === 'project'
										? { color: colorValue(item.row.color) }
										: {}
								"
								aria-hidden="true"
							/>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium text-ink-gray-9">{{
									item.title
								}}</span>
								<span
									v-if="item.hint"
									class="block truncate text-xs text-ink-gray-5"
									>{{ item.hint }}</span
								>
							</span>
							<span class="shrink-0 text-xs capitalize text-ink-gray-5">{{
								item.kind
							}}</span>
						</li>
					</ul>
				</div>
			</div>
		</template>
	</Dialog>
</template>
