<script setup>
// Selection outlines, resize and rotation handles, the marquee. Drawn in screen pixels so
// handles keep their size at every zoom. Handles carry data-handle for the controller.
import { computed } from "vue"
import { boundsOfObjects, centerOf, corners, rotatePoint } from "../geometry/bounds"
import { ANCHORS, anchorDirection, anchorPoint } from "../geometry/connectors"
import { activeCell } from "../interaction/tables"
import { cellRect, offsetOf } from "../store/tableOps"
import { HANDLE_NAMES, handlePoint, rotationHandlePoint } from "../geometry/resize"
import { toScreen } from "../geometry/viewport"

const props = defineProps({
	store: { type: Object, required: true },
	paths: { type: Object, required: true }, // a ref to every line's path
})

const ACCENT = "#2563eb"
const HANDLE = 9
const ROTATE_GAP_PX = 28
const CURSORS = {
	n: "ns-resize",
	s: "ns-resize",
	e: "ew-resize",
	w: "ew-resize",
	nw: "nwse-resize",
	se: "nwse-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
}

const state = computed(() => props.store.state)
const selected = computed(() => props.store.selectedObjects())
const selectedLines = computed(() => props.store.selectedConnectors())
const single = computed(() =>
	selected.value.length === 1 && !selectedLines.value.length ? selected.value[0] : null,
)
const singleLine = computed(() =>
	selectedLines.value.length === 1 && !selected.value.length ? selectedLines.value[0] : null,
)
const editable = computed(() => !state.value.readonly && !state.value.editingId)
const toPx = (point) => toScreen(state.value.viewport, point)

const outlines = computed(() =>
	selected.value.map((object) => ({
		id: object.id,
		points: corners(object)
			.map((corner) => {
				const p = toPx(corner)
				return `${p.x},${p.y}`
			})
			.join(" "),
	})),
)

const toPoints = (points) =>
	points
		.map((point) => {
			const p = toPx(point)
			return `${p.x},${p.y}`
		})
		.join(" ")

const lineOutlines = computed(() =>
	selectedLines.value
		.map((connector) => ({ id: connector.id, path: props.paths.value.get(connector.id) }))
		.filter((entry) => entry.path)
		.map((entry) => ({ id: entry.id, points: toPoints(entry.path.points) })),
)

// Endpoint handles, and a bend handle on a curved line.
const lineHandles = computed(() => {
	const connector = singleLine.value
	const path = connector && props.paths.value.get(connector.id)
	if (!path || !editable.value) return []
	const list = [
		{ name: "line-from", ...toPx(path.p0), attached: connector.from.objectId !== undefined },
		{ name: "line-to", ...toPx(path.p1), attached: connector.to.objectId !== undefined },
	]
	if (connector.geometry === "curved")
		list.push({ name: "line-bend", ...toPx(path.mid), bend: true })
	return list
})

// The eight anchors of shapes a line could attach to, with the one it would snap to marked.
const anchorDots = computed(() => {
	const snap = state.value.snap
	return state.value.anchorShapes.flatMap((id) => {
		const object = props.store.getObject(id)
		if (!object) return []
		return ANCHORS.map((anchor) => ({
			key: `${id}:${anchor}`,
			...toPx(anchorPoint(object, anchor)),
			snapped: snap?.objectId === id && snap.anchor === anchor,
		}))
	})
})

// How far each arrow sits from its shape's edge. The one above is further out, so it clears the
// rotation handle.
const QUICK_OFFSETS_PX = { n: 46, e: 36, s: 36, w: 36 }
const QUICK_SIDES = ["n", "e", "s", "w"]
// The little arrows beside a shape that add a connected copy: the hovered shape, or the one shape
// that is selected (a touch screen cannot hover).
const quickSource = computed(() => {
	if (state.value.readonly || state.value.tool !== "select") return null
	const hovered = props.store.getObject(state.value.hoverId)
	if (hovered?.kind === "shape") return hovered
	const only = single.value
	return only?.kind === "shape" ? only : null
})
const quickArrows = computed(() => {
	const object = quickSource.value
	if (!object) return []
	const busy =
		state.value.marquee || state.value.panning || state.value.editingId || state.value.dragging
	if (busy) return []
	return QUICK_SIDES.map((side) => {
		const dir = anchorDirection(object, side)
		const base = toPx(anchorPoint(object, side))
		const reach = QUICK_OFFSETS_PX[side]
		return {
			side,
			x: base.x + dir.x * reach,
			y: base.y + dir.y * reach,
			angle: (Math.atan2(dir.y, dir.x) * 180) / Math.PI,
		}
	})
})

const handles = computed(() => {
	const object = single.value
	if (!object || !editable.value) return []
	return HANDLE_NAMES.map((name) => ({
		name,
		...toPx(handlePoint(object, name)),
		cursor: CURSORS[name],
	}))
})

const rotation = computed(() => {
	const object = single.value
	if (!object || !editable.value) return null
	const top = toPx(handlePoint(object, "n"))
	const knob = toPx(rotationHandlePoint(object, ROTATE_GAP_PX / state.value.viewport.scale))
	return { top, knob }
})

const group = computed(() => {
	if (selected.value.length < 2) return null
	const box = boundsOfObjects(selected.value)
	const a = toPx({ x: box.x, y: box.y })
	const b = toPx({ x: box.x + box.w, y: box.y + box.h })
	return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }
})

// The chosen cell of a selected table, outlined (it may be turned with the table).
const cellOutline = computed(() => {
	const cell = activeCell(props.store)
	const object = cell && props.store.getObject(state.value.tableCell.id)
	if (!object || state.value.editingId) return null
	const r = cellRect(object.table, cell.row, cell.col)
	const centre = centerOf(object)
	return [
		{ x: r.x, y: r.y },
		{ x: r.x + r.w, y: r.y },
		{ x: r.x + r.w, y: r.y + r.h },
		{ x: r.x, y: r.y + r.h },
	]
		.map((p) => {
			const board = { x: object.x + p.x, y: object.y + p.y }
			const turned = object.rotation ? rotatePoint(board, centre, object.rotation) : board
			const s = toPx(turned)
			return `${s.x},${s.y}`
		})
		.join(" ")
})

// The borders between the rows and between the columns of a selected table, each a handle for
// resizing that one row or column (it may be turned with the table).
const trackHandles = computed(() => {
	const object = single.value
	if (!object || object.kind !== "table" || !editable.value) return []
	const { rowH, colW } = object.table
	const centre = centerOf(object)
	const place = (x, y) => {
		const board = { x: object.x + x, y: object.y + y }
		return toPx(object.rotation ? rotatePoint(board, centre, object.rotation) : board)
	}
	const rows = rowH.map((_, i) => {
		const y = offsetOf(rowH, i + 1)
		return { name: `row-${i}`, cursor: "row-resize", a: place(0, y), b: place(object.w, y) }
	})
	const cols = colW.map((_, i) => {
		const x = offsetOf(colW, i + 1)
		return { name: `col-${i}`, cursor: "col-resize", a: place(x, 0), b: place(x, object.h) }
	})
	return [...rows, ...cols]
})

// The frame a library shape being dragged would land in.
const hintFrame = computed(() => {
	const frame = props.store.getObject(state.value.hintFrame)
	return frame ? toPoints(corners(frame)) : null
})

// Other people: where their pointers are, and what they have selected, in their colours.
const peerPointers = computed(() =>
	state.value.peers
		.filter((peer) => peer.cursor)
		.map((peer) => ({
			key: peer.clientId,
			name: peer.name,
			color: peer.color,
			...toPx(peer.cursor),
		})),
)
const peerSelections = computed(() =>
	state.value.peers.flatMap((peer) =>
		peer.selection
			.map((id) => props.store.getObject(id))
			.filter(Boolean)
			.map((object) => ({
				key: `${peer.clientId}:${object.id}`,
				color: peer.color,
				points: corners(object)
					.map((corner) => {
						const p = toPx(corner)
						return `${p.x},${p.y}`
					})
					.join(" "),
			})),
	),
)

const GUIDE = "#ec4899"
const guideLines = computed(() =>
	state.value.guides.map((guide, index) => {
		const a = toPx({ x: guide.x1, y: guide.y1 })
		const b = toPx({ x: guide.x2, y: guide.y2 })
		return { key: index, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
	}),
)

const marquee = computed(() => {
	const m = state.value.marquee
	if (!m) return null
	const a = toPx({ x: m.x, y: m.y })
	const b = toPx({ x: m.x + m.w, y: m.y + m.h })
	return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }
})
</script>

<template>
	<g data-testid="selection-overlay">
		<polygon
			v-if="hintFrame"
			:points="hintFrame"
			fill="#2563eb"
			fill-opacity="0.06"
			:stroke="ACCENT"
			stroke-width="2"
			stroke-dasharray="6 4"
			pointer-events="none"
			data-testid="frame-hint"
		/>
		<polygon
			v-for="outline in outlines"
			:key="outline.id"
			:points="outline.points"
			fill="none"
			:stroke="ACCENT"
			stroke-width="1.5"
			pointer-events="none"
		/>
		<polyline
			v-for="outline in lineOutlines"
			:key="outline.id"
			:points="outline.points"
			fill="none"
			:stroke="ACCENT"
			stroke-opacity="0.35"
			stroke-width="7"
			stroke-linejoin="round"
			stroke-linecap="round"
			pointer-events="none"
		/>
		<circle
			v-for="dot in anchorDots"
			:key="dot.key"
			:cx="dot.x"
			:cy="dot.y"
			:r="dot.snapped ? 6 : 4"
			:fill="dot.snapped ? ACCENT : '#fff'"
			:stroke="ACCENT"
			stroke-width="1.5"
			pointer-events="none"
			:data-anchor="dot.snapped ? 'snapped' : 'anchor'"
		/>
		<g v-for="arrow in quickArrows" :key="arrow.side">
			<circle
				:cx="arrow.x"
				:cy="arrow.y"
				r="11"
				fill="#fff"
				:stroke="ACCENT"
				stroke-width="1.25"
				:data-quick="arrow.side"
				style="cursor: pointer"
			/>
			<polygon
				points="-4,-4 4,0 -4,4"
				:fill="ACCENT"
				:transform="`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`"
				pointer-events="none"
			/>
		</g>
		<circle
			v-for="handle in lineHandles"
			:key="handle.name"
			:cx="handle.x"
			:cy="handle.y"
			:r="handle.bend ? 5 : 6"
			:fill="handle.bend ? ACCENT : handle.attached ? ACCENT : '#fff'"
			:stroke="ACCENT"
			stroke-width="1.5"
			:data-handle="handle.name"
			style="cursor: move"
		/>
		<rect
			v-if="group"
			v-bind="group"
			fill="none"
			:stroke="ACCENT"
			stroke-width="1"
			stroke-dasharray="4 3"
			pointer-events="none"
		/>
		<template v-if="rotation">
			<line
				:x1="rotation.top.x"
				:y1="rotation.top.y"
				:x2="rotation.knob.x"
				:y2="rotation.knob.y"
				:stroke="ACCENT"
				stroke-width="1"
				pointer-events="none"
			/>
			<circle
				:cx="rotation.knob.x"
				:cy="rotation.knob.y"
				r="5.5"
				fill="#fff"
				:stroke="ACCENT"
				stroke-width="1.5"
				data-handle="rotate"
				style="cursor: grab"
			/>
		</template>
		<line
			v-for="track in trackHandles"
			:key="track.name"
			:x1="track.a.x"
			:y1="track.a.y"
			:x2="track.b.x"
			:y2="track.b.y"
			stroke-width="10"
			class="stroke-transparent hover:stroke-blue-500/40"
			pointer-events="stroke"
			:data-handle="track.name"
			:style="{ cursor: track.cursor }"
		/>
		<rect
			v-for="handle in handles"
			:key="handle.name"
			:x="handle.x - HANDLE / 2"
			:y="handle.y - HANDLE / 2"
			:width="HANDLE"
			:height="HANDLE"
			rx="1.5"
			fill="#fff"
			:stroke="ACCENT"
			stroke-width="1.5"
			:data-handle="handle.name"
			:style="{ cursor: handle.cursor }"
		/>
		<polygon
			v-if="cellOutline"
			:points="cellOutline"
			:fill="ACCENT"
			fill-opacity="0.12"
			:stroke="ACCENT"
			stroke-width="2"
			pointer-events="none"
			data-testid="active-cell"
		/>
		<polygon
			v-for="outline in peerSelections"
			:key="outline.key"
			:points="outline.points"
			fill="none"
			:stroke="outline.color"
			stroke-width="2"
			stroke-dasharray="5 3"
			pointer-events="none"
			data-testid="peer-selection"
		/>
		<g
			v-for="pointer in peerPointers"
			:key="pointer.key"
			:transform="`translate(${pointer.x} ${pointer.y})`"
			pointer-events="none"
			data-testid="peer-cursor"
		>
			<path
				d="M0 0 L0 15 L4 11.5 L7 18 L9.5 17 L6.5 10.5 L12 10.5 Z"
				:fill="pointer.color"
				stroke="#fff"
				stroke-width="1"
			/>
			<rect
				x="12"
				y="14"
				:width="pointer.name.length * 7 + 12"
				height="18"
				rx="9"
				:fill="pointer.color"
			/>
			<text
				x="18"
				y="27"
				font-size="11"
				fill="#fff"
				font-family="Inter, system-ui, sans-serif"
				>{{ pointer.name }}</text
			>
		</g>
		<line
			v-for="guide in guideLines"
			:key="`guide-${guide.key}`"
			:x1="guide.x1"
			:y1="guide.y1"
			:x2="guide.x2"
			:y2="guide.y2"
			:stroke="GUIDE"
			stroke-width="1"
			stroke-dasharray="4 3"
			pointer-events="none"
			data-guide="line"
		/>
		<rect
			v-if="marquee"
			v-bind="marquee"
			:fill="ACCENT"
			fill-opacity="0.08"
			:stroke="ACCENT"
			stroke-width="1"
			pointer-events="none"
		/>
	</g>
</template>
