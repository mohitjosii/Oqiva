<script setup>
// A small link mark on every object that has a link, at its top-right corner. Click it to open the
// address (in a new tab) or the board (through the page, which knows how to go there).
import { computed } from "vue"
import { corners } from "../geometry/bounds"
import { toScreen } from "../geometry/viewport"

const props = defineProps({
	store: { type: Object, required: true },
	links: { type: Object, default: null }, // {openBoard(name)}
})

const state = computed(() => props.store.state)
const inView = (p) =>
	p.x > -30 &&
	p.y > -30 &&
	p.x < state.value.size.width + 30 &&
	p.y < state.value.size.height + 30
const badges = computed(() =>
	props.store.objects.value
		.filter((o) => o.link)
		.map((o) => ({ object: o, ...toScreen(state.value.viewport, corners(o)[1]) }))
		.filter(inView),
)

function open(object) {
	const link = object.link
	if (link.url) window.open(link.url, "_blank", "noopener,noreferrer")
	else if (link.board) props.links?.openBoard?.(link.board)
}
const label = (object) =>
	object.link.url
		? `Open ${object.link.url}`
		: `Open the board ${object.link.title || object.link.board}`
</script>

<template>
	<div
		class="pointer-events-none absolute inset-0 overflow-hidden"
		data-testid="link-badges"
		data-print="hide"
	>
		<button
			v-for="badge in badges"
			:key="badge.object.id"
			type="button"
			class="pointer-events-auto absolute flex h-6 w-6 -translate-y-1/2 translate-x-1 items-center justify-center rounded-full border border-outline-gray-3 bg-surface-white text-blue-700 shadow-sm hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
			:style="{ left: `${badge.x}px`, top: `${badge.y}px` }"
			:title="label(badge.object)"
			:aria-label="label(badge.object)"
			data-testid="link-badge"
			@pointerdown.stop
			@dblclick.stop
			@click="open(badge.object)"
		>
			<span class="lucide-link block h-3.5 w-3.5" aria-hidden="true" />
		</button>
	</div>
</template>
