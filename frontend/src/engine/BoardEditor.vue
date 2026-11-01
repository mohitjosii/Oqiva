<script setup>
// The editor for one board. It builds the store, controller and autosave from what the page
// gives it (the "host": the loaded document, capabilities and save functions) and never talks
// to the server itself.
import { toast } from "frappe-ui"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { CanvasController } from "./interaction/controller"
import { commandFor, isTypingTarget } from "./interaction/keymap"
import { runCommand } from "./interaction/commands"
import { fitView } from "./interaction/view"
import { createAutosave } from "./persistence/autosave"
import { createStore } from "./store/createStore"
import { measureText, resetMeasureCache } from "./text/measure"
import BoardCanvas from "./render/BoardCanvas.vue"
import FloatingPalette from "./ui/FloatingPalette.vue"
import ShortcutsDialog from "./ui/ShortcutsDialog.vue"
import TextEditorOverlay from "./ui/TextEditorOverlay.vue"

const props = defineProps({
	// {document, revision, capabilities, limits, api: {save, getRevision}}
	host: { type: Object, required: true },
})
const emit = defineEmits(["status"])

const store = createStore(props.host.document, { readonly: !props.host.capabilities.can_edit })
store.setLimits({ maxObjects: props.host.limits.max_objects_per_board })
const controller = new CanvasController(store, { measure: measureText })

const autosave = createAutosave({
	save: props.host.api.save,
	getRevisionInfo: props.host.api.getRevision,
	getDocument: () => store.snapshot(),
	revision: props.host.revision,
	onStatus: (status) => {
		emit("status", status)
		if (status.status === "conflict") store.setReadonly(true) // never write over someone else's work
	},
})

const fonts = ref(0)
const showShortcuts = ref(false)

const unsubscribe = store.subscribe((event) => {
	if (event.type === "change") autosave.markDirty()
	if (event.type === "limit")
		toast.error(`This board is full. It can hold ${event.maxObjects} objects.`)
})

function onKeydown(event) {
	if (event.key === " " && !isTypingTarget(event.target) && !store.state.editingId) {
		event.preventDefault()
		controller.setSpaceHeld(true)
		return
	}
	const command = commandFor(event, {
		editing: Boolean(store.state.editingId),
		readonly: store.state.readonly,
	})
	if (!command) return
	event.preventDefault()
	runCommand(store, controller, command, {
		toggleShortcuts: () => (showShortcuts.value = !showShortcuts.value),
	})
}
const onKeyup = (event) => event.key === " " && controller.setSpaceHeld(false)
const onBlur = () => controller.setSpaceHeld(false)
const onOnline = () => autosave.retryNow()
const onHide = () => document.visibilityState === "hidden" && autosave.flush()
function onBeforeUnload(event) {
	if (!autosave.unsaved) return
	event.preventDefault()
	event.returnValue = ""
}
const onFontsLoaded = () => {
	resetMeasureCache() // widths measured before the fonts arrived used a fallback font
	fonts.value++
}

onMounted(() => {
	window.addEventListener("keydown", onKeydown)
	window.addEventListener("keyup", onKeyup)
	window.addEventListener("blur", onBlur)
	window.addEventListener("online", onOnline)
	window.addEventListener("beforeunload", onBeforeUnload)
	document.addEventListener("visibilitychange", onHide)
	document.fonts?.addEventListener("loadingdone", onFontsLoaded)
	document.fonts?.ready.then(onFontsLoaded)
})

// The canvas reports its size once it is on screen; frame the board then, only once.
const stopSizeWatch = watch(
	() => store.state.size.width,
	(width) => {
		if (!width) return
		fitView(store)
		stopSizeWatch()
	},
)

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onKeydown)
	window.removeEventListener("keyup", onKeyup)
	window.removeEventListener("blur", onBlur)
	window.removeEventListener("online", onOnline)
	window.removeEventListener("beforeunload", onBeforeUnload)
	document.removeEventListener("visibilitychange", onHide)
	document.fonts?.removeEventListener("loadingdone", onFontsLoaded)
	unsubscribe()
	store.state.editingId = null // lets the text editor commit what is being typed
	autosave.flush().finally(() => autosave.dispose())
})

const unsaved = computed(() => autosave.unsaved)
defineExpose({ flush: () => autosave.flush(), store, autosave, unsaved })
</script>

<template>
	<div class="relative h-full w-full overflow-hidden" data-testid="board-editor">
		<BoardCanvas :store="store" :controller="controller" :fonts="fonts">
			<TextEditorOverlay :store="store" :measure="measureText" />
		</BoardCanvas>
		<FloatingPalette :store="store" :controller="controller" />
		<ShortcutsDialog v-model="showShortcuts" />
	</div>
</template>
