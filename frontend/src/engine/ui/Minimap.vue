<script setup>
// A small map of the whole board with a rectangle for what is on screen. Click or drag on it to
// move the view there.
import { computed, ref } from "vue"
import { objectBounds, unionBounds } from "../geometry/bounds"
import { boardPoints } from "../model/strokes"
import { toBoard } from "../geometry/viewport"
import { centerOn, contentBounds } from "../interaction/view"

const props = defineProps({
	store: { type: Object, required: true },
	controller: { type: Object, default: null }, // where mind maps and flowcharts are drawn
})

const WIDTH = 200
const HEIGHT = 120
const state = computed(() => props.store.state)
const svg = ref(null)

const view = computed(() => {
	const { viewport, size } = state.value
	if (!size.width) return null
	const topLeft = toBoard(viewport, { x: 0, y: 0 })
	const bottomRight = toBoard(viewport, { x: size.width, y: size.height })
	return {
		x: topLeft.x,
		y: topLeft.y,
		w: bottomRight.x - topLeft.x,
		h: bottomRight.y - topLeft.y,
	}
})
// The map shows everything on the board and wherever the view is, with a little room round it.
const world = computed(() => {
	void props.store.objects.value
	void props.store.connectors.value
	void props.controller?.maps.value
	void props.controller?.flows.value
	const content = contentBounds(props.store)
	if (!view.value) return null
	const box = unionBounds([...(content ? [content] : []), view.value])
	const pad = Math.max(box.w, box.h) * 0.06
	return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
})
const scale = computed(() =>
	world.value ? Math.min(WIDTH / world.value.w, HEIGHT / world.value.h) : 1,
)
const offset = computed(() =>
	world.value
		? {
				x: (WIDTH - world.value.w * scale.value) / 2 - world.value.x * scale.value,
				y: (HEIGHT - world.value.h * scale.value) / 2 - world.value.y * scale.value,
			}
		: { x: 0, y: 0 },
)
const place = (box) => ({
	x: box.x * scale.value + offset.value.x,
	y: box.y * scale.value + offset.value.y,
	width: Math.max(1, box.w * scale.value),
	height: Math.max(1, box.h * scale.value),
})

const FLOW_FILL = {
	terminator: "#86EFAC",
	process: "#93C5FD",
	decision: "#FCD34D",
	io: "#C4B5FD",
	junction: "#64748B",
}

// Mind map nodes and flowchart steps, as small boxes like everything else.
const diagrams = computed(() => {
	if (!props.controller) return []
	const out = []
	for (const layout of props.controller.maps.value.values())
		for (const node of layout.nodes) {
			const box = layout.boxes.get(node.id)
			if (box) out.push({ id: node.id, fill: node.color || "#8B5CF6", ...place(box) })
		}
	for (const layout of props.controller.flows.value.values())
		for (const node of layout.nodes) {
			const size = layout.sizes.get(node.id)
			if (!size) continue
			out.push({
				id: node.id,
				fill: FLOW_FILL[node.type] || "#93C5FD",
				...place({ x: node.x - size.w / 2, y: node.y - size.h / 2, w: size.w, h: size.h }),
			})
		}
	return out
})

// Freehand strokes are drawn as thin lines, not as the box round them.
const inks = computed(() =>
	props.store.objects.value
		.filter((object) => object.kind === "stroke")
		.map((object) => {
			const points = boardPoints(object)
			const step = Math.max(1, Math.floor(points.length / 40))
			const kept = points.filter((_, i) => i % step === 0 || i === points.length - 1)
			return {
				id: object.id,
				d: kept
					.map(([x, y], i) => {
						const p = place({ x, y, w: 0, h: 0 })
						return `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
					})
					.join(" "),
				color: object.style.stroke || "#475569",
				opacity: object.style.opacity,
			}
		}),
)

const shapes = computed(() =>
	props.store.objects.value
		.filter((object) => object.kind !== "stroke")
		.map((object) => {
			const box = objectBounds(object)
			return {
				id: object.id,
				frame: object.kind === "frame",
				fill:
					object.kind === "frame"
						? "none"
						: object.style.fill || object.style.stroke || "#9CA3AF",
				...place(box),
			}
		}),
)
const viewRect = computed(() => (view.value ? place(view.value) : null))

let dragging = false
function moveTo(event) {
	const rect = svg.value.getBoundingClientRect()
	const x = ((event.clientX - rect.left) / rect.width) * WIDTH
	const y = ((event.clientY - rect.top) / rect.height) * HEIGHT
	centerOn(props.store, {
		x: (x - offset.value.x) / scale.value,
		y: (y - offset.value.y) / scale.value,
	})
}
function down(event) {
	dragging = true
	svg.value.setPointerCapture?.(event.pointerId)
	moveTo(event)
}
const move = (event) => dragging && moveTo(event)
const up = () => (dragging = false)
</script>

<template>
	<div
		v-if="state.minimap && world"
		class="absolute bottom-4 right-4 z-10 hidden overflow-hidden rounded-lg border border-outline-gray-2 bg-surface-white shadow-lg md:block"
		data-testid="minimap"
		data-print="hide"
		@pointerdown.stop
		@dblclick.stop
		@wheel.stop
	>
		<svg
			ref="svg"
			:width="WIDTH"
			:height="HEIGHT"
			:viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
			class="block cursor-pointer touch-none"
			role="img"
			aria-label="Map of the board. Click to move the view."
			@pointerdown="down"
			@pointermove="move"
			@pointerup="up"
			@pointercancel="up"
		>
			<rect
				v-for="s in shapes"
				:key="s.id"
				:x="s.x"
				:y="s.y"
				:width="s.width"
				:height="s.height"
				:fill="s.fill"
				:fill-opacity="s.frame ? 0 : 0.55"
				stroke="#94A3B8"
				stroke-width="0.75"
			/>
			<rect
				v-for="d in diagrams"
				:key="d.id"
				:x="d.x"
				:y="d.y"
				:width="d.width"
				:height="d.height"
				:fill="d.fill"
				fill-opacity="0.7"
				stroke="#64748B"
				stroke-width="0.5"
			/>
			<path
				v-for="ink in inks"
				:key="ink.id"
				:d="ink.d"
				fill="none"
				:stroke="ink.color"
				:stroke-opacity="ink.opacity"
				stroke-width="1.2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<rect
				v-if="viewRect"
				v-bind="viewRect"
				fill="#2563eb"
				fill-opacity="0.08"
				stroke="#2563eb"
				stroke-width="1.5"
				data-testid="minimap-view"
			/>
		</svg>
	</div>
</template>
