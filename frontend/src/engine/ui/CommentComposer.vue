<script setup>
// A box to write a comment in. Typing @ offers the people on the board; picking one writes their
// address in. Ctrl+Enter (or the button) sends it.
import { Button } from "frappe-ui"
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { insertMention, mentionQuery, placeSuggestions, suggestPeople } from "../comments/model"

const props = defineProps({
	modelValue: { type: String, default: "" },
	label: { type: String, required: true },
	placeholder: { type: String, default: "Write a comment…" },
	submitLabel: { type: String, default: "Comment" },
	loadPeople: { type: Function, required: true },
	autofocus: { type: Boolean, default: false },
})
const emit = defineEmits(["update:modelValue", "submit", "cancel"])

const text = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
})
const box = ref(null)
const people = ref(null) // loaded the first time someone types @
const busy = ref(false)
const query = computed(() => mentionQuery(text.value))
const suggestions = computed(() =>
	query.value !== null && people.value ? suggestPeople(people.value, query.value) : [],
)

// The list is drawn on the page itself, not inside the scrolling comment panel, so the panel's
// edge cannot cut it off. It follows the box while the panel scrolls or the window changes.
const place = ref(null)
function reposition() {
	if (!box.value || !suggestions.value.length) {
		place.value = null
		return
	}
	place.value = placeSuggestions(
		box.value.getBoundingClientRect(),
		{ width: window.innerWidth, height: window.innerHeight },
		suggestions.value.length,
	)
}
const listStyle = computed(() =>
	place.value
		? {
				top: `${place.value.top}px`,
				left: `${place.value.left}px`,
				width: `${place.value.width}px`,
				maxHeight: `${place.value.maxHeight}px`,
			}
		: { visibility: "hidden" },
)
watch(suggestions, () => nextTick(reposition), { flush: "post" })
onMounted(() => {
	window.addEventListener("scroll", reposition, true)
	window.addEventListener("resize", reposition)
})
onBeforeUnmount(() => {
	window.removeEventListener("scroll", reposition, true)
	window.removeEventListener("resize", reposition)
})

async function typed() {
	if (query.value !== null && people.value === null) {
		try {
			people.value = await props.loadPeople()
		} catch {
			people.value = []
		}
	}
}

function pick(person) {
	text.value = insertMention(text.value, person)
	nextTick(() => box.value?.focus())
}

async function submit() {
	const value = text.value.trim()
	if (!value || busy.value) return
	busy.value = true
	try {
		await emit("submit", value)
	} finally {
		busy.value = false
	}
}

defineExpose({ focus: () => box.value?.focus() })
</script>

<template>
	<form class="flex flex-col gap-1.5" @submit.prevent="submit">
		<div class="relative">
			<textarea
				ref="box"
				v-model="text"
				rows="3"
				maxlength="5000"
				class="w-full resize-y rounded border border-outline-gray-2 bg-surface-white px-2 py-1.5 text-sm text-ink-gray-9 focus:outline-none focus:ring-2 focus:ring-outline-gray-4"
				:placeholder="placeholder"
				:aria-label="label"
				:autofocus="autofocus"
				@input="typed"
				@keydown.ctrl.enter.prevent="submit"
				@keydown.meta.enter.prevent="submit"
				@keydown.esc.stop.prevent="emit('cancel')"
			/>
			<Teleport to="body">
				<ul
					v-if="suggestions.length"
					class="fixed z-[60] overflow-y-auto rounded border border-outline-gray-2 bg-surface-white shadow-lg"
					:style="listStyle"
					role="listbox"
					aria-label="People to mention"
					data-testid="mention-list"
				>
					<li v-for="person in suggestions" :key="person.user" role="option">
						<button
							type="button"
							class="flex w-full flex-col px-2 py-1 text-left text-sm hover:bg-surface-gray-2"
							@mousedown.prevent="pick(person)"
						>
							<span class="text-ink-gray-9">{{ person.full_name }}</span>
							<span class="text-xs text-ink-gray-5">{{ person.email }}</span>
						</button>
					</li>
				</ul>
			</Teleport>
		</div>
		<div class="flex items-center justify-end gap-1">
			<Button size="sm" variant="ghost" label="Cancel" @click="emit('cancel')" />
			<Button
				size="sm"
				variant="solid"
				type="submit"
				:label="submitLabel"
				:loading="busy"
				:disabled="!text.trim()"
				data-testid="comment-submit"
			/>
		</div>
	</form>
</template>
