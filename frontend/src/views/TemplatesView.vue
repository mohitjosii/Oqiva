<script setup>
import { Button, FormControl, toast } from "frappe-ui"
import { computed, onMounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import EmptyState from "@/components/EmptyState.vue"
import ErrorState from "@/components/ErrorState.vue"
import PageHeader from "@/components/PageHeader.vue"
import TemplateCard from "@/components/TemplateCard.vue"
import { useAsync } from "@/composables/useAsync"
import { createBoardFromTemplate, listTemplates } from "@/data/templates"
import { findWorkspace } from "@/data/session"
import { messageFor } from "@/utils/errors"
import { workspacePowers } from "@/utils/roles"
import { filterTemplates } from "@/utils/templates"

const route = useRoute()
const router = useRouter()

const catalogue = useAsync(listTemplates)
const query = ref("")
const category = ref(null)
const using = ref(null)

const powers = computed(() => workspacePowers(findWorkspace(route.params.workspace)))
const templates = computed(() => catalogue.data.value?.templates || [])
const categories = computed(() => catalogue.data.value?.categories || [])
const shown = computed(() =>
	filterTemplates(templates.value, { category: category.value, query: query.value }),
)
const filtered = computed(() => Boolean(category.value || query.value.trim()))
const summary = computed(() =>
	shown.value.length === 1 ? "1 template" : `${shown.value.length} templates`,
)

function clearFilters() {
	query.value = ""
	category.value = null
}

async function use(template) {
	if (using.value) return
	using.value = template.slug
	try {
		const board = await createBoardFromTemplate({
			workspace: route.params.workspace,
			template: template.slug,
		})
		router.push({ name: "board", params: { board: board.name } })
	} catch (error) {
		toast.error(messageFor(error))
	} finally {
		using.value = null
	}
}

onMounted(() => catalogue.run())
</script>

<template>
	<div>
		<PageHeader
			title="Templates"
			subtitle="Start a board from a ready-made layout. You can change everything afterwards."
		/>

		<ErrorState
			v-if="catalogue.error.value"
			:error="catalogue.error.value"
			@retry="catalogue.run"
		/>
		<p
			v-else-if="catalogue.loading.value && !catalogue.data.value"
			class="py-10 text-center text-sm text-ink-gray-5"
			role="status"
		>
			Loading templates…
		</p>
		<EmptyState
			v-else-if="!templates.length"
			icon="layout"
			title="No templates yet"
			description="Templates your team can start from will show up here."
		/>
		<template v-else>
			<div class="flex flex-wrap items-center gap-3 pb-4">
				<div class="w-full sm:w-72">
					<FormControl
						v-model="query"
						type="search"
						placeholder="Search templates"
						aria-label="Search templates"
					/>
				</div>
				<div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
					<button
						v-for="name in [null, ...categories]"
						:key="name ?? 'all'"
						type="button"
						class="rounded-full border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-4"
						:class="
							category === name
								? 'border-outline-gray-5 bg-surface-gray-7 text-ink-white'
								: 'border-outline-gray-2 bg-surface-white text-ink-gray-7 hover:bg-surface-gray-2'
						"
						:aria-pressed="category === name"
						@click="category = name"
					>
						{{ name ?? "All" }}
					</button>
				</div>
			</div>
			<p class="sr-only" role="status" aria-live="polite">{{ summary }}</p>

			<EmptyState
				v-if="!shown.length"
				icon="search"
				title="No templates match"
				description="Try a different search, or pick another category."
			>
				<Button v-if="filtered" label="Clear filters" @click="clearFilters" />
			</EmptyState>
			<ul
				v-else
				class="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4"
				aria-label="Templates"
			>
				<li v-for="template in shown" :key="template.slug" class="min-w-0">
					<TemplateCard
						:template="template"
						:can-use="powers.canCreate"
						:busy="using === template.slug"
						:disabled="Boolean(using) && using !== template.slug"
						@use="use"
					/>
				</li>
			</ul>
			<p v-if="!powers.canCreate" class="mt-4 text-sm text-ink-gray-6">
				Guests can look at templates. Ask a workspace admin if you need to create boards.
			</p>
		</template>
	</div>
</template>
