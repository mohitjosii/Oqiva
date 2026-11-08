<script setup>
// The editor for one board. It builds the store, controller and autosave from what the page
// gives it (the "host": the loaded document, capabilities and save functions) and never talks
// to the server itself.
import { toast } from "frappe-ui"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { CanvasController } from "./interaction/controller"
import { commandFor, isTypingTarget } from "./interaction/keymap"
import { runCommand } from "./interaction/commands"
import { pasteClipboard } from "./interaction/clipboard"
import { insertImage } from "./interaction/images"
import { exportBoard } from "./export/exporter"
import { createThumbnailer, renderThumbnail } from "./export/thumbnail"
import { fitView } from "./interaction/view"
import { createAutosave } from "./persistence/autosave"
import { createStore } from "./store/createStore"
import { measureText, resetMeasureCache } from "./text/measure"
import BoardCanvas from "./render/BoardCanvas.vue"
import FloatingPalette from "./ui/FloatingPalette.vue"
import ExportMenu from "./ui/ExportMenu.vue"
import ShortcutsDialog from "./ui/ShortcutsDialog.vue"
import LineLabelEditor from "./ui/LineLabelEditor.vue"
import RightPalette from "./ui/RightPalette.vue"
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

// The home screen's thumbnail, refreshed after edits and at most every 30 seconds.
const thumbnailer =
	props.host.thumbnails && props.host.capabilities.can_edit
		? createThumbnailer({
				render: () => renderThumbnail(store),
				save: (blob) => props.host.thumbnails.save(blob),
			})
		: null

const canExport = Boolean(props.host.capabilities.can_export && props.host.exports)
const notify = {
	error: (message) => toast.error(message),
	warning: (message) => toast.warning(message),
	success: (message) => toast.success(message),
}
async function runExport({ format, scope = "board", scale = 1 }) {
	if (!canExport || store.state.exporting) return
	store.state.exporting = true
	try {
		await exportBoard({ store, host: props.host, format, scope, scale, notify })
	} finally {
		store.state.exporting = false
	}
}

const unsubscribe = store.subscribe((event) => {
	if (event.type === "change") {
		autosave.markDirty()
		thumbnailer?.request()
	}
	if (event.type === "limit")
		toast.error(`This board is full. It can hold ${event.maxObjects} objects.`)
})

// A menu, popover or dialog that is open owns the keyboard: Escape closes it rather than
// clearing the selection behind it. Reka (frappe-ui's overlay layer) marks these layers.
const overlayOpen = () =>
	Boolean(document.querySelector('[data-dismissable-layer][data-state="open"]'))

function onKeydown(event) {
	if (overlayOpen()) return
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
	if (command.name === "print" && !canExport) return // leave the browser's own print alone
	event.preventDefault()
	runCommand(store, controller, command, {
		toggleShortcuts: () => (showShortcuts.value = !showShortcuts.value),
		print: () => runExport({ format: "print" }),
	})
}
const say = (message) => toast.error(message)
const addImage = (file, center) => insertImage(store, props.host, file, { center, notify: say })
const addFiles = (files, center) => {
	for (const file of files) addImage(file, center)
}

// Pasting uses the browser's own event, because that is the only way to receive a picture.
function onPaste(event) {
	if (isTypingTarget(event.target) || store.state.editingId || store.state.readonly) return
	const file = [...(event.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"))
	if (file) {
		event.preventDefault()
		addImage(file)
		return
	}
	if (pasteClipboard(store).length) event.preventDefault()
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
	window.addEventListener("paste", onPaste)
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
	window.removeEventListener("paste", onPaste)
	window.removeEventListener("blur", onBlur)
	window.removeEventListener("online", onOnline)
	window.removeEventListener("beforeunload", onBeforeUnload)
	document.removeEventListener("visibilitychange", onHide)
	document.fonts?.removeEventListener("loadingdone", onFontsLoaded)
	unsubscribe()
	thumbnailer?.dispose()
	store.state.editingId = null // lets the text editor commit what is being typed
	autosave.flush().finally(() => autosave.dispose())
})

const unsaved = computed(() => autosave.unsaved)
defineExpose({ flush: () => autosave.flush(), store, autosave, unsaved })
</script>

<template>
	<div class="relative h-full w-full overflow-hidden" data-testid="board-editor">
		<BoardCanvas :store="store" :controller="controller" :fonts="fonts" @files="addFiles">
			<TextEditorOverlay :store="store" :measure="measureText" />
			<LineLabelEditor :store="store" :paths="controller.paths" />
		</BoardCanvas>
		<FloatingPalette :store="store" :controller="controller" @image="addImage" />
		<ExportMenu v-if="canExport" :store="store" @export="runExport" />
		<div
			v-if="store.state.uploads"
			class="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-outline-gray-2 bg-surface-white px-3 py-1 text-sm text-ink-gray-7 shadow"
			role="status"
			data-testid="uploading"
		>
			Adding picture…
		</div>
		<RightPalette :store="store" :measure="measureText" />
		<ShortcutsDialog v-model="showShortcuts" />
	</div>
</template>
