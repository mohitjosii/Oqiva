<script setup>
// Pick an icon or an emoji to put on the board. Click one to add it beside the selection or near
// the middle of the screen.
import { computed, ref } from "vue"
import { iconData, searchEmoji, searchIcons } from "../model/icons"

const emit = defineEmits(["pick"])
const tab = ref("icons")
const query = ref("")
const icons = computed(() => searchIcons(query.value))
const emoji = computed(() => searchEmoji(query.value))
</script>

<template>
	<div class="w-72" data-testid="icon-picker" @keydown.stop>
		<div class="flex gap-1 p-2" role="tablist">
			<button
				v-for="name in ['icons', 'emoji']"
				:key="name"
				type="button"
				role="tab"
				:aria-selected="tab === name"
				class="rounded px-2 py-1 text-sm capitalize"
				:class="
					tab === name
						? 'bg-surface-gray-3 text-ink-gray-9'
						: 'text-ink-gray-6 hover:bg-surface-gray-2'
				"
				:data-testid="`picker-tab-${name}`"
				@click="tab = name"
			>
				{{ name }}
			</button>
		</div>
		<div class="px-2 pb-2">
			<input
				v-model="query"
				type="search"
				class="w-full rounded-md border border-outline-gray-2 bg-surface-white px-2 py-1.5 text-sm text-ink-gray-9 placeholder:text-ink-gray-4 focus:border-outline-gray-4 focus:outline-none"
				:placeholder="tab === 'icons' ? 'Search icons' : 'Search emoji'"
				:aria-label="tab === 'icons' ? 'Search icons' : 'Search emoji'"
				data-testid="picker-search"
			/>
		</div>
		<div class="grid max-h-64 grid-cols-7 gap-1 overflow-y-auto px-2 pb-2">
			<template v-if="tab === 'icons'">
				<button
					v-for="icon in icons"
					:key="icon.name"
					type="button"
					class="flex h-9 w-9 items-center justify-center rounded-md text-ink-gray-8 hover:bg-surface-gray-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
					:title="icon.label"
					:aria-label="icon.label"
					:data-icon="icon.name"
					@click="emit('pick', { icon: icon.name })"
				>
					<svg
						viewBox="0 0 24 24"
						width="20"
						height="20"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<component
							:is="tag"
							v-for="([tag, attrs], i) in iconData(icon.name).shapes"
							:key="i"
							v-bind="attrs"
						/>
					</svg>
				</button>
			</template>
			<template v-else>
				<button
					v-for="e in emoji"
					:key="e.char"
					type="button"
					class="flex h-9 w-9 items-center justify-center rounded-md text-xl hover:bg-surface-gray-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
					:title="e.name"
					:aria-label="e.name"
					:data-emoji="e.char"
					@click="emit('pick', { emoji: e.char })"
				>
					{{ e.char }}
				</button>
			</template>
		</div>
		<p
			v-if="(tab === 'icons' ? icons : emoji).length === 0"
			class="px-3 pb-3 text-center text-sm text-ink-gray-5"
		>
			Nothing matches "{{ query }}".
		</p>
	</div>
</template>
