<script setup>
import { computed } from "vue"
import BoardTile from "@/components/BoardTile.vue"
import { preferences } from "@/data/preferences"
import { session } from "@/data/session"
import { daysLeft } from "@/utils/time"

const props = defineProps({
	boards: { type: Array, required: true },
	scope: { type: String, default: "all" },
})
defineEmits(["action"])

const layout = computed(() => preferences.boardView)
const retention = computed(() => session.limits.trash_retention_days || 30)
const left = (board) =>
	props.scope === "trash" ? daysLeft(board.trashed_on, retention.value) : null
</script>

<template>
	<ul
		:class="
			layout === 'grid'
				? 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4'
				: 'flex flex-col gap-2'
		"
	>
		<li v-for="board in boards" :key="board.name" class="min-w-0">
			<BoardTile
				:board="board"
				:scope="scope"
				:layout="layout"
				:retention-days-left="left(board)"
				@action="(type, item) => $emit('action', type, item)"
			/>
		</li>
	</ul>
</template>
