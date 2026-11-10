<script setup>
// The editor for one board. It builds the store, controller and autosave from what the page
// gives it (the "host": the loaded document, capabilities and save functions) and never talks
// to the server itself.
import { confirmDialog, toast } from "frappe-ui"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { CanvasController } from "./interaction/controller"
import { commandFor, isTypingTarget } from "./interaction/keymap"
import { runCommand } from "./interaction/commands"
import { flowOwnsKeys } from "./modes/flowchart/commands"
import { nodesOwnKeys } from "./modes/mindmap/commands"
import { createMapFromOutline } from "./modes/mindmap/storeOps"
import { looksLikeOutline, parseOutline, treeToChange } from "./modes/mindmap/paste"
import { childrenOf } from "./modes/mindmap/tree"
import { applyChange as applyMapChange } from "./modes/mindmap/storeOps"
import { pasteClipboard } from "./interaction/clipboard"
import { insertImage } from "./interaction/images"
import { exportBoard } from "./export/exporter"
import { createThumbnailer, renderThumbnail } from "./export/thumbnail"
import { fitView } from "./interaction/view"
import { attachCollab, prepareCollab } from "./collab/session"
import { createComments } from "./comments/session"
import { createAutosave } from "./persistence/autosave"
import { parseDocument } from "./model/schema"
import { createStore } from "./store/createStore"
import { measureText, resetMeasureCache } from "./text/measure"
import BoardCanvas from "./render/BoardCanvas.vue"
import FloatingPalette from "./ui/FloatingPalette.vue"
import CommentPanel from "./ui/CommentPanel.vue"
import CommentPins from "./ui/CommentPins.vue"
import FrameNameEditor from "./ui/FrameNameEditor.vue"
import LinkBadges from "./ui/LinkBadges.vue"
import Minimap from "./ui/Minimap.vue"
import ShapeLibrary from "./ui/ShapeLibrary.vue"
import VersionPanel from "./ui/VersionPanel.vue"
import VersionPreview from "./ui/VersionPreview.vue"
import ExportMenu from "./ui/ExportMenu.vue"
import ShortcutsDialog from "./ui/ShortcutsDialog.vue"
import LineLabelEditor from "./ui/LineLabelEditor.vue"
import RightPalette from "./ui/RightPalette.vue"
import FlowchartBar from "./ui/FlowchartBar.vue"
import FlowEditor from "./ui/FlowEditor.vue"
import FlowTypePicker from "./ui/FlowTypePicker.vue"
import MapNodeEditor from "./ui/MapNodeEditor.vue"
import MindMapBar from "./ui/MindMapBar.vue"
import OutlinePanel from "./ui/OutlinePanel.vue"
import TextEditorOverlay from "./ui/TextEditorOverlay.vue"

const props = defineProps({
	// {document, revision, capabilities, limits, api: {save, getRevision}}
	host: { type: Object, required: true },
})
const emit = defineEmits(["status", "peers", "access"])

// With collaboration the board starts from the shared document, which may hold more than the
// saved content (changes a peer made that are not saved yet are merged in as they arrive).
const collabStart = props.host.collab ? prepareCollab(props.host) : null
const readonlyAtStart = !props.host.capabilities.can_edit
const store = createStore(collabStart ? collabStart.initial : props.host.document, {
	readonly: readonlyAtStart,
})
store.setLimits({ maxObjects: props.host.limits.max_objects_per_board })
// Questions the mind map asks before it deletes a branch.
const ask = (message) =>
	new Promise((resolve) => {
		confirmDialog({
			title: "Are you sure?",
			message,
			onConfirm: ({ hideDialog }) => {
				hideDialog()
				resolve(true)
			},
			onCancel: () => resolve(false),
		})
	})
const controller = new CanvasController(store, { measure: measureText, ask })

const autosave = createAutosave({
	save: props.host.api.save,
	getRevisionInfo: props.host.api.getRevision,
	getDocument: () => store.snapshot(),
	getCrdtState: () => collab?.encode() ?? null,
	recover: props.host.collab ? () => collab.recover() : null,
	revision: props.host.revision,
	onStatus: (status) => {
		emit("status", status)
		if (status.status === "conflict") store.setReadonly(true) // never write over someone else's work
	},
})

const say = (message) => toast.error(message)
const levelWords = { comment: "comment on", view: "view" }
// The relay or the server says this person's access changed: follow it, and tell them.
function accessChanged(level) {
	emit("access", level)
	if (level === "edit") return
	toast.warning(
		level
			? `Your access changed: you can now only ${levelWords[level]} this board.`
			: "You no longer have access to this board.",
	)
}
// Comments: the threads live in the store; the page supplies the port that reads and writes them.
const comments = props.host.comments
	? createComments({
			store,
			port: props.host.comments,
			notify: { error: (message) => toast.error(message) },
		})
	: null
if (comments) {
	store.state.canComment = Boolean(props.host.capabilities.can_comment)
	comments.refresh()
}

const collab = collabStart
	? attachCollab({
			host: props.host,
			store,
			doc: collabStart.doc,
			autosave,
			notify: { warning: (m) => toast.warning(m) },
			onAccess: accessChanged,
			onComment: () => comments?.scheduleRefresh(),
			readonlyAtStart,
		})
	: null
if (collab) {
	watch(
		() => store.state.peers,
		(peers) => emit("peers", peers),
	)
	watch(
		() => store.state.cursor,
		(point) => collab.presence.setCursor(point),
	)
	watch(
		() => store.state.selection,
		(ids) => collab.presence.setSelection(ids),
	)
}

// Small preferences kept in this browser: the shapes added lately, and whether the map shows.
const PREFS = { recent: "oqiva.recentShapes", minimap: "oqiva.minimap" }
function readPref(key, fallback) {
	try {
		const raw = window.localStorage.getItem(key)
		return raw === null ? fallback : JSON.parse(raw)
	} catch {
		return fallback
	}
}
function writePref(key, value) {
	try {
		window.localStorage.setItem(key, JSON.stringify(value))
	} catch {
		// private windows and blocked storage just forget it
	}
}
const savedRecent = readPref(PREFS.recent, [])
store.state.recentPresets = Array.isArray(savedRecent)
	? savedRecent.filter((k) => typeof k === "string").slice(0, 4)
	: []
store.state.minimap = readPref(PREFS.minimap, true) !== false
watch(
	() => store.state.recentPresets,
	(list) => writePref(PREFS.recent, list),
)
watch(
	() => store.state.minimap,
	(on) => writePref(PREFS.minimap, on),
)

// ----- version history -----
const versionPanel = ref(null)
const preview = ref(null) // {number, title, document} while an old version is being looked at
const restoring = ref(false)
const canRestore = computed(
	() => Boolean(props.host.capabilities.can_edit) && !store.state.readonly,
)
const sayError = (error, fallback) => toast.error(error?.message || fallback)

async function previewVersion(number) {
	try {
		const found = await props.host.versions.get(number)
		const { document } = parseDocument(found.document)
		preview.value = { number, title: found.label || `Version ${number}`, document }
	} catch (error) {
		sayError(error, "That version could not be opened.")
	}
}

// Restoring is one ordinary edit of this board: the server keeps what is there now (Pre-restore),
// and the old content is applied here, so people editing at the same time see it arrive like any
// other change. Undo puts it all back.
async function restoreVersion(number) {
	if (restoring.value || !canRestore.value) return
	restoring.value = true
	try {
		await autosave.flush() // so the copy the server keeps is what is on screen
		const result = await props.host.versions.beginRestore(number)
		const { document } = parseDocument(result.document)
		store.replaceContent(document, { label: `Restore version ${number}` })
		preview.value = null
		toast.success(`Restored version ${number}. Press Undo to go back.`)
		versionPanel.value?.refresh()
	} catch (error) {
		sayError(error, "That version could not be restored.")
	} finally {
		restoring.value = false
	}
}

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
		if (event.origin !== "remote") autosave.markDirty() // a peer's changes are theirs to save
		thumbnailer?.request()
	}
	if (event.type === "limit")
		toast.error(`This board is full. It can hold ${event.maxObjects} objects.`)
})

// A menu, popover or dialog that is open owns the keyboard: Escape closes it rather than
// clearing the selection behind it. Reka (frappe-ui's overlay layer) marks these layers.
const overlayOpen = () =>
	Boolean(document.querySelector('[data-dismissable-layer][data-state="open"]'))

// Undo and redo still work with a menu open (a colour or a tile was just chosen in it), as long as
// the person is not typing in a box.
const isHistoryKey = (event) =>
	(event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())

function onKeydown(event) {
	if (overlayOpen() && !(isHistoryKey(event) && !isTypingTarget(event.target))) return
	if (event.key === " " && !isTypingTarget(event.target) && !store.state.editingId) {
		event.preventDefault()
		controller.setSpaceHeld(true)
		return
	}
	const command = commandFor(event, {
		editing: Boolean(
			store.state.editingId || store.state.editingNodeId || store.state.editingFlowId,
		),
		readonly: store.state.readonly,
		canComment: store.state.canComment,
		mindmap: nodesOwnKeys(store),
		flowchart: flowOwnsKeys(store),
	})
	if (!command) return
	if (command.name === "print" && !canExport) return // leave the browser's own print alone
	event.preventDefault()
	runCommand(store, controller, command, {
		toggleShortcuts: () => (showShortcuts.value = !showShortcuts.value),
		print: () => runExport({ format: "print" }),
		mindmap: controller.mapHost(),
		flowchart: controller.flowHost(),
	})
}
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
	const text = event.clipboardData?.getData("text/plain") || ""
	if (looksLikeOutline(text) && pasteOutline(text)) {
		event.preventDefault()
		return
	}
	if (pasteClipboard(store).length) event.preventDefault()
}

// Indented or bulleted text becomes branches under the selected node, or a new map when nothing
// is selected.
function pasteOutline(text) {
	const outline = parseOutline(text)
	if (!outline.length) return false
	const [node, ...rest] = store.selectedNodes()
	if (node && !rest.length && store.state.selection.length === 1) {
		const nodes = store.nodesOfMap(node.mapId)
		const change = treeToChange({
			mapId: node.mapId,
			parentId: node.id,
			startOrder: childrenOf(nodes, node.id).length,
			tree: outline,
		})
		if (node.collapsed)
			change.update = [...(change.update || []), { id: node.id, patch: { collapsed: false } }]
		return applyMapChange(store, node.mapId, change, {
			label: "Paste outline",
			select: node.id,
			selectUndo: [node.id],
		})
	}
	if (store.state.selection.length) return false
	return Boolean(
		createMapFromOutline(store, controller.mapHost().viewCenter(), outline, treeToChange),
	)
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
	store.state.fontsTick++
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
	collab?.dispose()
	comments?.dispose()
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
			<MapNodeEditor :store="store" :controller="controller" />
			<FlowEditor :store="store" :controller="controller" />
			<FlowTypePicker :store="store" :controller="controller" />
			<LineLabelEditor :store="store" :paths="controller.paths" />
			<CommentPins v-if="comments" :store="store" />
			<LinkBadges :store="store" :links="host.links" />
			<FrameNameEditor :store="store" />
		</BoardCanvas>
		<ShapeLibrary :store="store" :controller="controller" />
		<MindMapBar :store="store" :controller="controller" />
		<FlowchartBar :store="store" :controller="controller" />
		<OutlinePanel :store="store" :controller="controller" />
		<template v-if="host.versions">
			<button
				type="button"
				class="absolute right-[8.25rem] top-3 z-10 flex items-center gap-1.5 rounded-lg bg-surface-gray-2 px-2.5 py-1.5 text-sm text-ink-gray-8 hover:bg-surface-gray-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-5"
				:aria-expanded="store.state.versionsOpen"
				title="Version history"
				data-testid="history-button"
				data-print="hide"
				@pointerdown.stop
				@click="store.state.versionsOpen = !store.state.versionsOpen"
			>
				<span class="lucide-history h-4 w-4" aria-hidden="true" />
				History
			</button>
			<VersionPanel
				ref="versionPanel"
				:store="store"
				:versions="host.versions"
				:can-edit="canRestore"
				@preview="previewVersion"
				@restore="restoreVersion"
			/>
			<VersionPreview
				v-if="preview"
				:key="preview.number"
				:document="preview.document"
				:title="preview.title"
				:can-restore="canRestore"
				:busy="restoring"
				@close="preview = null"
				@restore="restoreVersion(preview.number)"
			/>
		</template>
		<Minimap :store="store" />
		<FloatingPalette :store="store" :controller="controller" @image="addImage" />
		<ExportMenu v-if="canExport" :store="store" @export="runExport" />
		<CommentPanel v-if="comments" :store="store" :comments="comments" />
		<div
			v-if="store.state.uploads"
			class="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-outline-gray-2 bg-surface-white px-3 py-1 text-sm text-ink-gray-7 shadow"
			role="status"
			data-testid="uploading"
		>
			Adding picture…
		</div>
		<RightPalette :store="store" :measure="measureText" :links="host.links" />
		<ShortcutsDialog v-model="showShortcuts" />
	</div>
</template>
