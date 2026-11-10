// Keyboard shortcuts. ``commandFor`` is a pure function: given a key event and what the
// editor is doing, it names the command, or null to leave the key alone. Keys never reach it
// while text is being typed, and number keys are not bound to shape actions.

export const SHORTCUTS = [
	{ group: "Edit", keys: ["Ctrl/Cmd", "Z"], label: "Undo" },
	{ group: "Edit", keys: ["Ctrl/Cmd", "Shift", "Z"], label: "Redo" },
	{ group: "Edit", keys: ["Ctrl/Cmd", "D"], label: "Duplicate" },
	{ group: "Edit", keys: ["Ctrl/Cmd", "C"], label: "Copy" },
	{ group: "Edit", keys: ["Ctrl/Cmd", "X"], label: "Cut" },
	{ group: "Edit", keys: ["Ctrl/Cmd", "V"], label: "Paste (also a picture from the clipboard)" },
	{ group: "Edit", keys: ["Alt", "Drag"], label: "Move without snapping to guides" },
	{ group: "Edit", keys: ["Delete"], label: "Delete selection" },
	{ group: "Edit", keys: ["Arrows"], label: "Nudge by 1 (Shift: 10)" },
	{ group: "Edit", keys: ["Double-click"], label: "Edit text, or add a shape on empty canvas" },
	{ group: "Select", keys: ["Ctrl/Cmd", "A"], label: "Select all" },
	{ group: "Select", keys: ["Shift", "Click"], label: "Add to or remove from selection" },
	{ group: "Select", keys: ["Esc"], label: "Deselect, or leave the current tool" },
	{ group: "Tools", keys: ["V"], label: "Select" },
	{ group: "Tools", keys: ["H"], label: "Hand (or hold Space)" },
	{ group: "Tools", keys: ["R"], label: "Rectangle" },
	{ group: "Tools", keys: ["O"], label: "Ellipse" },
	{ group: "Tools", keys: ["T"], label: "Text box" },
	{ group: "Tools", keys: ["L"], label: "Line or arrow (last one used)" },
	{ group: "Tools", keys: ["C"], label: "Comment (click a shape or a place)" },
	{ group: "Tools", keys: ["N"], label: "Sticky note" },
	{ group: "Tools", keys: ["F"], label: "Frame (a named section)" },
	{ group: "Tools", keys: ["Shift", "S"], label: "Shape library" },
	{ group: "Mind map", keys: ["M"], label: "New mind map in the middle of the screen" },
	{ group: "Mind map", keys: ["Tab"], label: "Add a child to the selected node" },
	{ group: "Mind map", keys: ["Enter"], label: "Add a sibling after it" },
	{ group: "Mind map", keys: ["Shift", "Tab"], label: "Move a node up one level" },
	{ group: "Mind map", keys: ["Arrows"], label: "Walk through the nodes" },
	{ group: "Mind map", keys: ["Alt", "Up / Down"], label: "Move a node among its siblings" },
	{ group: "Mind map", keys: ["F2"], label: "Edit the text (or double-click)" },
	{ group: "Mind map", keys: ["- / +"], label: "Collapse or expand a node" },
	{ group: "Mind map", keys: ["Delete"], label: "Delete a node and what grows from it" },
	{ group: "Mind map", keys: ["Shift", "Enter"], label: "New line while editing a node" },
	{ group: "Edit", keys: ["Tab"], label: "In a note: write the next note beside it" },
	{ group: "Lines", keys: ["Click a hover arrow"], label: "Add a connected copy" },
	{ group: "Lines", keys: ["Drag an end"], label: "Move or re-attach a line end" },
	{ group: "File", keys: ["Ctrl/Cmd", "P"], label: "Print the board" },
	{ group: "View", keys: ["Ctrl/Cmd", "+"], label: "Zoom in" },
	{ group: "View", keys: ["Ctrl/Cmd", "-"], label: "Zoom out" },
	{ group: "View", keys: ["Ctrl/Cmd", "0"], label: "Zoom to 100%" },
	{ group: "View", keys: ["Shift", "1"], label: "Fit everything" },
	{ group: "View", keys: ["Ctrl/Cmd", "Scroll"], label: "Zoom at the cursor" },
	{ group: "View", keys: ["Scroll"], label: "Pan (Shift: sideways)" },
	{ group: "Help", keys: ["?"], label: "Show these shortcuts" },
]

const TOOL_KEYS = {
	v: "select",
	h: "hand",
	r: "rectangle",
	o: "ellipse",
	t: "text",
	l: "connector",
	c: "comment",
	n: "note",
	f: "frame",
}
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

// Commands that only look around or select, which a read-only viewer may use.
const VIEW_ONLY = new Set([
	"copy",
	"print",
	"zoomIn",
	"zoomOut",
	"zoomReset",
	"fit",
	"selectAll",
	"escape",
	"shortcuts",
	"tool",
	"mm.nav",
])

// Inputs that take no typed text (a slider, a checkbox) must not swallow shortcuts such as undo.
const NON_TEXT_INPUTS = new Set([
	"range",
	"checkbox",
	"radio",
	"button",
	"submit",
	"reset",
	"color",
	"image",
])

export function isTypingTarget(target) {
	if (!target) return false
	const tag = target.tagName
	if (tag === "INPUT") return !NON_TEXT_INPUTS.has(String(target.type || "text").toLowerCase())
	return tag === "TEXTAREA" || tag === "SELECT" || Boolean(target.isContentEditable)
}

// With only mind map nodes selected, the mind map owns these keys (a Tab on a node is not a Tab
// anywhere else, and the arrows walk the tree instead of nudging).
const MM_ARROWS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }
function mindmapLookup(event) {
	const key = event.key
	const mod = event.ctrlKey || event.metaKey
	if (mod) return null
	if (event.altKey) {
		if (key === "ArrowUp") return { name: "mm.moveUp" }
		if (key === "ArrowDown") return { name: "mm.moveDown" }
		return null
	}
	if (key === "Tab") return { name: event.shiftKey ? "mm.promote" : "mm.child" }
	if (key === "Enter" && !event.shiftKey) return { name: "mm.sibling" }
	if (key in MM_ARROWS) return { name: "mm.nav", direction: MM_ARROWS[key] }
	if (key === "Delete" || key === "Backspace") return { name: "mm.delete" }
	if (key === "F2") return { name: "mm.edit" }
	if (key === "-") return { name: "mm.toggle", collapsed: true }
	if (key === "+" || key === "=") return { name: "mm.toggle", collapsed: false }
	return null
}

function lookup(event, mindmap = false) {
	if (mindmap) {
		const found = mindmapLookup(event)
		if (found) return found
	}
	const mod = event.ctrlKey || event.metaKey
	const key = event.key
	if (mod) {
		if (event.altKey) return null
		const lower = key.toLowerCase()
		if (lower === "z") return { name: event.shiftKey ? "redo" : "undo" }
		if (lower === "y") return { name: "redo" }
		if (lower === "a") return { name: "selectAll" }
		if (lower === "d") return { name: "duplicate" }
		if (lower === "c") return { name: "copy" }
		if (lower === "p") return { name: "print" }
		if (lower === "x") return { name: "cut" }
		if (key === "=" || key === "+") return { name: "zoomIn" }
		if (key === "-" || key === "_") return { name: "zoomOut" }
		if (key === "0") return { name: "zoomReset" }
		return null
	}
	if (event.altKey) return null
	if (key === "Delete" || key === "Backspace") return { name: "delete" }
	if (key === "Escape") return { name: "escape" }
	if (key === "?") return { name: "shortcuts" }
	if (event.shiftKey && event.code === "Digit1") return { name: "fit" }
	if (event.shiftKey && event.key.toLowerCase() === "s") return { name: "library" }
	if (key in ARROWS) {
		const step = event.shiftKey ? 10 : 1
		return { name: "nudge", dx: ARROWS[key][0] * step, dy: ARROWS[key][1] * step }
	}
	if (!event.shiftKey && key.toLowerCase() === "m") return { name: "mm.new" }
	if (!event.shiftKey && key.length === 1 && key.toLowerCase() in TOOL_KEYS) {
		return { name: "tool", tool: TOOL_KEYS[key.toLowerCase()] }
	}
	return null
}

export function commandFor(
	event,
	{ editing = false, readonly = false, canComment = false, mindmap = false } = {},
) {
	if (editing || isTypingTarget(event.target)) return null
	const command = lookup(event, mindmap)
	if (!command) return null
	if (readonly) {
		if (!VIEW_ONLY.has(command.name)) return null
		const allowed =
			command.tool === "select" ||
			command.tool === "hand" ||
			(command.tool === "comment" && canComment)
		if (command.name === "tool" && !allowed) return null
	}
	if (readonly && command.name.startsWith("mm.") && command.name !== "mm.nav") return null
	return command
}
