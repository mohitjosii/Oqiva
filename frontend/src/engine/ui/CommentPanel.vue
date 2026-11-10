<script setup>
// The comments of a board: new comment, open and resolved threads, replies, edit, delete.
import { Avatar, Button, toast } from "frappe-ui"
import { computed, nextTick, ref, watch } from "vue"
import { centerOn } from "../interaction/view"
import { mentionParts, pinPosition, threadCounts, timeAgo, visibleThreads } from "../comments/model"
import CommentComposer from "./CommentComposer.vue"

const props = defineProps({
	store: { type: Object, required: true },
	comments: { type: Object, required: true }, // createComments()
})

const state = computed(() => props.store.state)
const filter = ref("open")
const counts = computed(() => threadCounts(state.value.comments))
const shown = computed(() => visibleThreads(state.value.comments, filter.value))
const byId = computed(() => new Map(props.store.objects.value.map((o) => [o.id, o])))
const canComment = computed(() => state.value.canComment)

const draftText = ref("")
const replyingTo = ref(null)
const replyText = ref("")
const editing = ref(null)
const editText = ref("")

// The shape library and the comments share the left edge: opening one puts the other away.
watch(
	() => state.value.commentsOpen,
	(open) => {
		if (open) state.value.libraryOpen = false
	},
)

// A draft started from the board opens the panel on the right tab.
watch(
	() => state.value.commentDraft,
	(draft) => {
		if (draft) {
			draftText.value = ""
			filter.value = "open"
		}
	},
)
watch(
	() => state.value.openThread,
	async (name) => {
		if (!name) return
		const thread = state.value.comments.find((t) => t.name === name)
		if (thread) filter.value = thread.resolved ? "resolved" : "open"
		await nextTick()
		document.querySelector(`[data-thread="${name}"]`)?.scrollIntoView({ block: "nearest" })
	},
)

const mentionText = (content) => mentionParts(content)
const who = (draft) => (draft.anchor_type === "shape" ? "this shape" : "this place")

async function send() {
	if (await props.comments.add(draftText.value)) draftText.value = ""
}
async function sendReply(thread) {
	if (await props.comments.reply(thread, replyText.value)) {
		replyText.value = ""
		replyingTo.value = null
	}
}
function startEdit(comment) {
	editing.value = comment.name
	editText.value = comment.content
}
async function saveEdit(comment) {
	if (await props.comments.edit(comment, editText.value)) editing.value = null
}
function show(thread) {
	state.value.openThread = thread.name
	const spot = pinPosition(thread, byId.value)
	if (spot) centerOn(props.store, spot)
}
// Arms the comment tool; the next click on a shape or a place on the board starts the comment.
function arm() {
	props.store.state.tool = "comment"
	toast.info("Click a shape, or any place on the board, to comment on it.")
}
const close = () => (state.value.commentsOpen = false)
const toggle = () => (state.value.commentsOpen = !state.value.commentsOpen)
</script>

<template>
	<div data-print="hide" @pointerdown.stop @dblclick.stop @wheel.stop @contextmenu.stop>
		<button
			type="button"
			class="absolute left-4 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-outline-gray-2 bg-surface-white px-2.5 py-1.5 text-sm text-ink-gray-8 shadow-sm hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
			:aria-expanded="state.commentsOpen"
			title="Comments (C to add one)"
			data-testid="comments-toggle"
			@click="toggle"
		>
			<span class="lucide-message-square h-4 w-4" aria-hidden="true" />
			Comments
			<span
				v-if="counts.open"
				class="rounded-full bg-blue-600 px-1.5 text-xs text-white"
				data-testid="comments-count"
				>{{ counts.open }}</span
			>
		</button>

		<aside
			v-if="state.commentsOpen"
			class="absolute bottom-24 left-4 top-14 z-10 flex w-80 flex-col overflow-hidden rounded-xl border border-outline-gray-2 bg-surface-white shadow-lg"
			aria-label="Comments"
			data-testid="comment-panel"
		>
			<header class="flex items-center gap-1 border-b border-outline-gray-2 px-3 py-2">
				<div class="flex flex-1 gap-1" role="tablist">
					<button
						v-for="tab in ['open', 'resolved']"
						:key="tab"
						type="button"
						role="tab"
						:aria-selected="filter === tab"
						class="rounded px-2 py-1 text-sm capitalize"
						:class="
							filter === tab
								? 'bg-surface-gray-3 text-ink-gray-9'
								: 'text-ink-gray-6 hover:bg-surface-gray-2'
						"
						:data-testid="`comments-tab-${tab}`"
						@click="filter = tab"
					>
						{{ tab }} ({{ counts[tab] }})
					</button>
				</div>
				<Button icon="x" variant="ghost" size="sm" title="Close comments" @click="close" />
			</header>

			<div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
				<section
					v-if="state.commentDraft"
					class="rounded-lg border border-blue-300 bg-blue-50/40 p-2"
					data-testid="comment-draft"
				>
					<p class="mb-1 text-xs text-ink-gray-6">
						New comment on {{ who(state.commentDraft) }}
					</p>
					<CommentComposer
						v-model="draftText"
						label="New comment"
						autofocus
						:load-people="comments.people"
						@submit="send"
						@cancel="state.commentDraft = null"
					/>
				</section>

				<div
					v-if="!shown.length && !state.commentDraft"
					class="py-6 text-center text-sm text-ink-gray-5"
					data-testid="comments-empty"
				>
					<p>
						{{
							filter === "open"
								? canComment
									? "No open comments yet."
									: "No open comments."
								: "Nothing resolved yet."
						}}
					</p>
					<Button
						v-if="filter === 'open' && canComment"
						class="mt-3"
						variant="subtle"
						icon-left="message-square"
						label="Add a comment"
						data-testid="comment-arm"
						@click="arm"
					/>
				</div>

				<article
					v-for="thread in shown"
					:key="thread.name"
					class="rounded-lg border p-2"
					:class="
						state.openThread === thread.name
							? 'border-blue-400 bg-blue-50/30'
							: 'border-outline-gray-2'
					"
					:data-thread="thread.name"
					data-testid="comment-thread"
				>
					<div
						v-for="(comment, index) in [thread, ...thread.replies]"
						:key="comment.name"
						:class="index ? 'mt-2 border-t border-outline-gray-1 pt-2' : ''"
					>
						<div class="flex items-center gap-2">
							<Avatar
								:label="comment.author.full_name"
								:image="comment.author.user_image"
								size="sm"
							/>
							<span
								class="min-w-0 flex-1 truncate text-sm font-medium text-ink-gray-9"
								>{{ comment.author.full_name }}</span
							>
							<span class="text-xs text-ink-gray-5"
								>{{ timeAgo(comment.creation)
								}}<template v-if="comment.edited"> · edited</template></span
							>
						</div>
						<template v-if="editing === comment.name">
							<CommentComposer
								v-model="editText"
								label="Edit comment"
								submit-label="Save"
								:load-people="comments.people"
								class="mt-1"
								@submit="saveEdit(comment)"
								@cancel="editing = null"
							/>
						</template>
						<p
							v-else
							class="mt-1 whitespace-pre-wrap break-words text-sm text-ink-gray-8"
							data-testid="comment-text"
						>
							<template v-for="(part, i) in mentionText(comment.content)" :key="i"
								><strong v-if="part.mention" class="font-semibold text-blue-700">{{
									part.text
								}}</strong
								><template v-else>{{ part.text }}</template></template
							>
						</p>
						<div
							v-if="
								editing !== comment.name && (comment.can_edit || comment.can_delete)
							"
							class="mt-1 flex gap-2 text-xs text-ink-gray-5"
						>
							<button
								v-if="comment.can_edit"
								type="button"
								class="hover:text-ink-gray-9"
								@click="startEdit(comment)"
							>
								Edit
							</button>
							<button
								v-if="comment.can_delete"
								type="button"
								class="hover:text-ink-gray-9"
								data-testid="comment-delete"
								@click="comments.remove(comment)"
							>
								Delete
							</button>
						</div>
					</div>

					<p
						v-if="thread.object_missing"
						class="mt-2 rounded bg-surface-amber-1 px-2 py-1 text-xs text-ink-gray-7"
						data-testid="comment-missing"
					>
						The shape this is about is no longer on the board.
					</p>
					<div class="mt-2 flex items-center gap-2 text-xs">
						<button
							v-if="!thread.object_missing"
							type="button"
							class="text-blue-700 hover:underline"
							@click="show(thread)"
						>
							Show on board
						</button>
						<span class="flex-1" />
						<button
							v-if="canComment"
							type="button"
							class="text-ink-gray-6 hover:text-ink-gray-9"
							data-testid="comment-resolve"
							@click="comments.resolve(thread, !thread.resolved)"
						>
							{{ thread.resolved ? "Reopen" : "Resolve" }}
						</button>
						<button
							v-if="canComment && replyingTo !== thread.name"
							type="button"
							class="text-ink-gray-6 hover:text-ink-gray-9"
							data-testid="comment-reply"
							@click="replyingTo = thread.name"
						>
							Reply
						</button>
					</div>
					<CommentComposer
						v-if="replyingTo === thread.name"
						v-model="replyText"
						label="Reply"
						submit-label="Reply"
						placeholder="Reply…"
						autofocus
						:load-people="comments.people"
						class="mt-2"
						@submit="sendReply(thread)"
						@cancel="replyingTo = null"
					/>
				</article>
			</div>
		</aside>
	</div>
</template>
