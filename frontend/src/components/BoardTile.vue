<script setup>
import { Button, Dropdown, FeatherIcon } from "frappe-ui"
import { computed } from "vue"
import { menuFor } from "@/composables/useBoardActions"
import { timeAgo } from "@/utils/time"

const props = defineProps({
	board: { type: Object, required: true },
	scope: { type: String, default: "all" },
	layout: { type: String, default: "grid" },
	retentionDaysLeft: { type: Number, default: null },
})
const emit = defineEmits(["action"])

const options = computed(() =>
	menuFor(props.board, props.scope).map((item) => ({
		label: item.label,
		icon: item.icon,
		theme: item.theme,
		onClick: () => emit("action", item.type, props.board),
	})),
)
const trashed = computed(() => props.scope === "trash")
const edited = computed(() =>
	trashed.value
		? `Deleted ${timeAgo(props.board.trashed_on)}`
		: `Edited ${timeAgo(props.board.modified)}`,
)
const target = computed(() =>
	trashed.value ? null : { name: "board", params: { board: props.board.name } },
)
</script>

<template>
	<article
		class="board-tile group relative rounded-lg border border-outline-gray-2 bg-surface-white transition-colors hover:border-outline-gray-3"
		:class="layout === 'list' ? 'flex items-center gap-3 p-2.5' : ''"
	>
		<component
			:is="target ? 'router-link' : 'div'"
			:to="target"
			class="block min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-4"
			:class="layout === 'list' ? 'flex flex-1 items-center gap-3' : 'rounded-lg'"
			:aria-label="target ? `Open ${board.title}` : undefined"
		>
			<div
				class="flex items-center justify-center overflow-hidden bg-surface-gray-2"
				:class="
					layout === 'list'
						? 'h-12 w-20 shrink-0 rounded-md'
						: 'aspect-[16/10] rounded-t-lg'
				"
			>
				<img
					v-if="board.thumbnail"
					:src="board.thumbnail"
					alt=""
					class="h-full w-full object-cover"
					loading="lazy"
				/>
				<FeatherIcon
					v-else
					name="layout"
					class="h-7 w-7 text-ink-gray-4"
					aria-hidden="true"
				/>
			</div>
			<div class="min-w-0" :class="layout === 'list' ? 'flex-1' : 'px-3 py-2.5'">
				<div class="flex items-center gap-1.5">
					<h3 class="truncate text-base font-medium text-ink-gray-9">
						{{ board.title }}
					</h3>
					<FeatherIcon
						v-if="board.is_favorite"
						name="star"
						class="h-3.5 w-3.5 shrink-0 text-ink-amber-3"
						aria-label="Favorite"
					/>
				</div>
				<p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-ink-gray-5">
					<span v-if="board.project_name" class="inline-flex min-w-0 items-center gap-1">
						<FeatherIcon name="folder" class="h-3 w-3 shrink-0" aria-hidden="true" />
						<span class="truncate">{{ board.project_name }}</span>
						<span aria-hidden="true">·</span>
					</span>
					<span class="shrink-0">{{ edited }}</span>
					<span v-if="trashed && retentionDaysLeft !== null" class="shrink-0"
						>· {{ retentionDaysLeft }} days left</span
					>
				</p>
			</div>
		</component>

		<div
			class="tile-actions flex items-center gap-1"
			:class="layout === 'list' ? '' : 'absolute right-2 top-2'"
		>
			<Button
				v-if="!trashed"
				icon="star"
				size="sm"
				variant="subtle"
				:title="board.is_favorite ? 'Remove from favorites' : 'Add to favorites'"
				:aria-pressed="board.is_favorite"
				@click.prevent="emit('action', 'favorite', board)"
			/>
			<Dropdown v-if="options.length" :options="options" placement="right">
				<template #default="{ open }">
					<Button
						icon="more-horizontal"
						size="sm"
						variant="subtle"
						:title="`Actions for ${board.title}`"
						:data-open="open"
					/>
				</template>
			</Dropdown>
		</div>
	</article>
</template>
