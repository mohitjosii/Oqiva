<script setup>
import { Button } from "frappe-ui"
import { computed, watch } from "vue"
import { useRoute } from "vue-router"
import BoardActionDialogs from "@/components/BoardActionDialogs.vue"
import BoardGrid from "@/components/BoardGrid.vue"
import EmptyState from "@/components/EmptyState.vue"
import ErrorState from "@/components/ErrorState.vue"
import PageHeader from "@/components/PageHeader.vue"
import ViewToggle from "@/components/ViewToggle.vue"
import { useBoardActions } from "@/composables/useBoardActions"
import { useBoardList } from "@/composables/useBoardList"
import { session } from "@/data/session"

const props = defineProps({ scope: { type: String, required: true } })
const route = useRoute()

const COPY = {
	recent: {
		title: "Recent",
		subtitle: "Boards you opened lately.",
		icon: "clock",
		empty: "Nothing opened yet",
		hint: "Boards you open show up here, newest first.",
	},
	favorites: {
		title: "Favorites",
		subtitle: "Boards you starred.",
		icon: "star",
		empty: "No favorites yet",
		hint: "Star a board from its menu to keep it close.",
	},
	shared: {
		title: "Shared with me",
		subtitle: "Boards other people shared with you.",
		icon: "share-2",
		empty: "Nothing shared with you",
		hint: "When someone shares a board with you, it appears here.",
	},
	archived: {
		title: "Archive",
		subtitle: "Boards you put away. They are hidden from the other lists.",
		icon: "archive",
		empty: "The archive is empty",
		hint: "Archive a board from its menu to tidy up without deleting it.",
	},
	trash: {
		title: "Trash",
		icon: "trash-2",
		empty: "Trash is empty",
		hint: "Boards you delete wait here until they are removed for good.",
	},
}
const copy = computed(() => COPY[props.scope])
const subtitle = computed(
	() =>
		copy.value.subtitle ||
		`Boards stay here for ${session.limits.trash_retention_days || 30} days, then they are deleted for good.`,
)

const { boards, hasMore, loading, error, load, loadMore } = useBoardList(() => ({
	scope: props.scope,
	workspace: route.params.workspace,
	limit: 24,
}))
const actions = useBoardActions(load)
watch(() => [props.scope, route.params.workspace], load, { immediate: true })
</script>

<template>
	<div>
		<PageHeader :title="copy.title" :subtitle="subtitle">
			<template #actions><ViewToggle /></template>
		</PageHeader>

		<ErrorState v-if="error" :error="error" @retry="load" />
		<p
			v-else-if="loading && !boards.length"
			class="py-10 text-center text-sm text-ink-gray-5"
			role="status"
		>
			Loading…
		</p>
		<EmptyState
			v-else-if="!boards.length"
			:icon="copy.icon"
			:title="copy.empty"
			:description="copy.hint"
		/>
		<template v-else>
			<BoardGrid :boards="boards" :scope="scope" @action="actions.run" />
			<div v-if="hasMore" class="mt-6 flex justify-center">
				<Button label="Load more" :loading="loading" @click="loadMore" />
			</div>
		</template>

		<BoardActionDialogs :actions="actions" />
	</div>
</template>
