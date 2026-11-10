<script setup>
// What opens when someone follows a share link. A signed-in person is given the link's access
// and sent to the board. A visitor who is not signed in either sees the board to look at (if the
// link allows it) or is asked to sign in and brought back here.
import { Button, LoadingIndicator } from "frappe-ui"
import { computed, onMounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { api } from "@/data/api"
import BoardEditor from "@/engine/BoardEditor.vue"
import { parseDocument } from "@/engine/model/schema"
import { isGuest } from "@/data/session"

const route = useRoute()
const router = useRouter()
const token = computed(() => String(route.params.token || ""))
const state = ref("loading") // loading | missing | viewing
const shared = ref(null)

const fileUrl = (src) =>
	`/api/method/oqiva.api.share.link_file?token=${encodeURIComponent(token.value)}&src=${encodeURIComponent(src)}`

// A visitor's pictures come through the link, not through the file system's own check.
function forVisitor(document) {
	const { document: parsed } = parseDocument(document)
	return {
		...parsed,
		objects: parsed.objects.map((o) =>
			o.kind === "image" ? { ...o, src: fileUrl(o.src) } : o,
		),
	}
}

const host = computed(() =>
	shared.value
		? {
				document: forVisitor(shared.value.document),
				revision: 0,
				capabilities: shared.value.capabilities,
				limits: { max_objects_per_board: 3000 },
				api: { save: async () => ({}), getRevision: async () => ({}) },
			}
		: null,
)

function signIn() {
	window.location.href = `/login?redirect-to=${encodeURIComponent(window.location.pathname)}`
}

onMounted(async () => {
	try {
		const result = await api("share.redeem_link", { token: token.value })
		if (result.login_required) return signIn()
		if (result.anonymous) {
			shared.value = await api("share.view_shared", { token: token.value })
			state.value = "viewing"
			return
		}
		router.replace({ name: "board", params: { board: result.board } })
	} catch {
		state.value = "missing" // the same page for every kind of failure
	}
})
</script>

<template>
	<div class="flex h-screen flex-col bg-surface-gray-1">
		<div
			v-if="state === 'loading'"
			class="flex flex-1 items-center justify-center"
			role="status"
		>
			<LoadingIndicator class="h-6 w-6 text-ink-gray-5" />
			<span class="sr-only">Opening the link</span>
		</div>
		<div v-else-if="state === 'missing'" class="flex flex-1 items-center justify-center p-6">
			<div
				class="max-w-md rounded-xl border border-outline-gray-2 bg-surface-white p-8 text-center"
				data-testid="link-missing"
			>
				<p class="text-lg font-semibold text-ink-gray-9">This link doesn't work</p>
				<p class="mt-1 text-sm text-ink-gray-6">
					It may have been ended, it may have expired, or it may have been copied wrongly.
					Ask the person who sent it for a new one.
				</p>
				<Button
					v-if="!isGuest()"
					class="mt-4"
					variant="solid"
					label="Go to Oqiva"
					@click="router.push('/')"
				/>
			</div>
		</div>
		<template v-else-if="state === 'viewing' && host">
			<header
				class="flex items-center gap-2 border-b border-outline-gray-2 bg-surface-white px-3 py-2"
			>
				<span
					class="truncate text-sm font-medium text-ink-gray-9"
					data-testid="shared-title"
					>{{ shared.title }}</span
				>
				<span class="text-xs text-ink-gray-5">View only</span>
				<div class="flex-1" />
				<Button label="Sign in" variant="subtle" @click="signIn" />
			</header>
			<main class="relative min-h-0 flex-1" data-testid="shared-board">
				<BoardEditor :host="host" />
			</main>
		</template>
	</div>
</template>
