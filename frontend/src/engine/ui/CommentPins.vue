<script setup>
// The round markers on the board, one per thread, at the shape or place the thread is about.
// They follow their shapes (and go with them when the shape is removed). The place a new comment
// is about to go is shown dashed.
import { computed } from "vue"
import { draftPosition, pinPosition } from "../comments/model"
import { toScreen } from "../geometry/viewport"

const props = defineProps({ store: { type: Object, required: true } })

const state = computed(() => props.store.state)
const byId = computed(() => new Map(props.store.objects.value.map((o) => [o.id, o])))
const inView = (p) =>
	p.x > -30 &&
	p.y > -30 &&
	p.x < state.value.size.width + 30 &&
	p.y < state.value.size.height + 30

const pins = computed(() => {
	const out = []
	for (const thread of state.value.comments) {
		const spot = pinPosition(thread, byId.value)
		if (!spot) continue
		const screen = toScreen(state.value.viewport, spot)
		if (inView(screen)) out.push({ thread, ...screen })
	}
	return out
})
const draft = computed(() => {
	const spot = state.value.commentDraft && draftPosition(state.value.commentDraft, byId.value)
	return spot ? toScreen(state.value.viewport, spot) : null
})

function open(thread) {
	state.value.openThread = thread.name
	state.value.commentsOpen = true
}
const label = (t) =>
	`${t.resolved ? "Resolved comment" : "Comment"} by ${t.author.full_name}, ${t.replies.length} replies`
</script>

<template>
	<div
		class="pointer-events-none absolute inset-0 overflow-hidden"
		data-testid="comment-pins"
		data-print="hide"
	>
		<button
			v-for="pin in pins"
			:key="pin.thread.name"
			type="button"
			class="pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-bl-none border-2 border-white text-xs font-semibold text-white shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
			:class="[
				pin.thread.resolved ? 'bg-gray-400' : 'bg-blue-600',
				state.openThread === pin.thread.name ? 'ring-2 ring-blue-300' : '',
			]"
			:style="{ left: `${pin.x}px`, top: `${pin.y}px` }"
			:title="label(pin.thread)"
			:aria-label="label(pin.thread)"
			data-testid="comment-pin"
			@pointerdown.stop
			@dblclick.stop
			@click="open(pin.thread)"
		>
			{{ pin.thread.replies.length + 1 }}
		</button>
		<span
			v-if="draft"
			class="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-bl-none border-2 border-dashed border-blue-600 bg-white/80 text-sm text-blue-700"
			:style="{ left: `${draft.x}px`, top: `${draft.y}px` }"
			aria-hidden="true"
			data-testid="comment-draft-pin"
			>+</span
		>
	</div>
</template>
