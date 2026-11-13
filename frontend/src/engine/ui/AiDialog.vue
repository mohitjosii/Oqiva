<script setup>
// "Create with AI": describe a diagram, choose what kind, and it is drawn on the board. The server asks
// the provider in the background; this dialog waits (and can be cancelled) and then hands the described
// diagram to the editor, which draws it as one undoable step. Only the typed description leaves the board.
import { Button, Dialog, LoadingIndicator } from "frappe-ui"
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import { requestDiagram } from "../ai/request"

const props = defineProps({
	modelValue: { type: Boolean, required: true },
	ai: { type: Object, required: true }, // the port: status, generate, result, onResult
})
const emit = defineEmits(["update:modelValue", "generated"])
const open = computed({
	get: () => props.modelValue,
	set: (value) => {
		if (!value) cancel()
		emit("update:modelValue", value)
	},
})

const KINDS = [
	{ id: "flowchart", label: "Flowchart", hint: "Steps and decisions" },
	{ id: "architecture", label: "Architecture", hint: "Systems and how they connect" },
	{ id: "mindmap", label: "Mind map", hint: "A topic and its branches" },
]
const EXAMPLES = {
	flowchart: ["How a support ticket is handled", "User sign-up with email confirmation"],
	architecture: [
		"A web app with an API, a queue and a database",
		"Three-tier web shop on the cloud",
	],
	mindmap: ["Plan for launching a new product", "Ways to onboard a new teammate"],
}
const MAX = 2000
const MIN = 3

const availability = ref("loading") // loading | on | off | failed
const prompt = ref("")
const kind = ref("flowchart")
const phase = ref("form") // form | working | error
const message = ref("")
const input = ref(null)
let controller = null

const ready = computed(() => prompt.value.trim().length >= MIN && prompt.value.length <= MAX)

async function checkStatus() {
	availability.value = "loading"
	try {
		availability.value = (await props.ai.status()).available ? "on" : "off"
	} catch {
		availability.value = "failed"
	}
}

watch(
	() => props.modelValue,
	(opened) => {
		if (!opened) return
		phase.value = "form"
		message.value = ""
		checkStatus().then(() => nextTick(() => input.value?.focus()))
	},
	{ immediate: true },
)

async function submit() {
	if (!ready.value || phase.value === "working") return
	phase.value = "working"
	message.value = ""
	controller = new AbortController()
	try {
		const made = await requestDiagram(
			props.ai,
			{ prompt: prompt.value.trim(), kind: kind.value },
			{ signal: controller.signal },
		)
		emit("generated", made)
		prompt.value = ""
		emit("update:modelValue", false)
	} catch (error) {
		if (error?.code === "AI_CANCELLED") return
		message.value = error?.message || "Something went wrong. Please try again."
		// a switched-off or failing feature is explained on its own screen, not as a retry
		phase.value = "error"
	} finally {
		controller = null
	}
}

function cancel() {
	controller?.abort()
	controller = null
	if (phase.value === "working") phase.value = "form"
}
onBeforeUnmount(() => controller?.abort())

function onKey(event) {
	if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
		event.preventDefault()
		submit()
	}
}
</script>

<template>
	<Dialog v-model="open" :options="{ title: 'Create with AI', size: 'lg' }">
		<template #body-content>
			<div class="flex flex-col gap-4" data-testid="ai-dialog">
				<div
					v-if="availability === 'loading'"
					class="flex items-center gap-2 py-6 text-sm text-ink-gray-6"
					role="status"
				>
					<LoadingIndicator class="h-4 w-4" /> Checking…
				</div>

				<div
					v-else-if="availability === 'off'"
					class="rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-4 text-sm text-ink-gray-7"
					data-testid="ai-off"
				>
					<p class="font-medium text-ink-gray-8">AI diagrams are not turned on here</p>
					<p class="mt-1">
						Oqiva can draw a flowchart, an architecture diagram or a mind map from a
						description, but this site has no AI provider set up. An administrator can
						turn it on in Oqiva Settings.
					</p>
				</div>

				<div
					v-else-if="availability === 'failed'"
					class="rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-4 text-sm text-ink-gray-7"
					role="alert"
				>
					<p>We could not check whether AI diagrams are available. Please try again.</p>
					<Button class="mt-3" variant="subtle" @click="checkStatus">Try again</Button>
				</div>

				<template v-else>
					<fieldset class="flex flex-col gap-2" :disabled="phase === 'working'">
						<legend class="mb-1 text-sm font-medium text-ink-gray-8">What kind?</legend>
						<div class="grid gap-2 sm:grid-cols-3" role="radiogroup">
							<label
								v-for="item in KINDS"
								:key="item.id"
								class="flex cursor-pointer flex-col rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-outline-gray-5"
								:class="
									kind === item.id
										? 'border-outline-gray-4 bg-surface-gray-2'
										: 'border-outline-gray-2 hover:bg-surface-gray-1'
								"
							>
								<input
									v-model="kind"
									type="radio"
									name="ai-kind"
									:value="item.id"
									class="sr-only"
									:data-testid="`ai-kind-${item.id}`"
								/>
								<span class="font-medium text-ink-gray-8">{{ item.label }}</span>
								<span class="text-xs text-ink-gray-5">{{ item.hint }}</span>
							</label>
						</div>
					</fieldset>

					<div class="flex flex-col gap-1.5">
						<label for="ai-prompt" class="text-sm font-medium text-ink-gray-8"
							>Describe it</label
						>
						<textarea
							id="ai-prompt"
							ref="input"
							v-model="prompt"
							rows="4"
							:maxlength="MAX"
							:disabled="phase === 'working'"
							class="w-full resize-y rounded-lg border border-outline-gray-2 bg-surface-white p-2.5 text-sm text-ink-gray-8 placeholder:text-ink-gray-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5 disabled:opacity-60"
							placeholder="For example: how a support ticket moves from the customer to a resolved state"
							data-testid="ai-prompt"
							@keydown="onKey"
						/>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div class="flex flex-wrap gap-1.5">
								<button
									v-for="example in EXAMPLES[kind]"
									:key="example"
									type="button"
									class="rounded-full border border-outline-gray-2 px-2.5 py-0.5 text-xs text-ink-gray-6 hover:bg-surface-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
									:disabled="phase === 'working'"
									@click="prompt = example"
								>
									{{ example }}
								</button>
							</div>
							<span class="text-xs text-ink-gray-5"
								>{{ prompt.length }}/{{ MAX }}</span
							>
						</div>
					</div>

					<p
						v-if="phase === 'error'"
						class="text-sm text-ink-red-3"
						role="alert"
						data-testid="ai-error"
					>
						{{ message }}
					</p>
					<p
						v-if="phase === 'working'"
						class="flex items-center gap-2 text-sm text-ink-gray-6"
						role="status"
						data-testid="ai-working"
					>
						<LoadingIndicator class="h-4 w-4" /> Drawing your diagram. This can take up
						to a minute.
					</p>
					<p class="text-xs text-ink-gray-5">
						Only the description you type here is sent to the AI provider. Nothing else
						on your board is shared. The result is added as one step you can undo.
					</p>

					<div class="flex justify-end gap-2">
						<Button v-if="phase === 'working'" variant="subtle" @click="cancel"
							>Cancel</Button
						>
						<Button
							v-else
							variant="solid"
							:disabled="!ready"
							data-testid="ai-generate"
							@click="submit"
						>
							{{ phase === "error" ? "Try again" : "Create diagram" }}
						</Button>
					</div>
				</template>
			</div>
		</template>
	</Dialog>
</template>
