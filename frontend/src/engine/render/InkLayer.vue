<script setup>
// What is being drawn right now and is not part of the board yet: the stroke under the pen, what is
// left of the strokes an eraser is cutting, the eraser's tip and the laser pointer with its fading
// trail. None of it is saved or exported. It sits above the objects and never takes a click.
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { INKS, boardPoints, outlinePath } from "../model/strokes"

const props = defineProps({
	store: { type: Object, required: true },
	transform: { type: String, required: true },
})

const state = computed(() => props.store.state)
const scale = computed(() => state.value.viewport.scale)

const live = computed(() => {
	const p = state.value.inkPreview
	if (!p || !p.points.length) return null
	return {
		d: outlinePath(p.points, p.width, p.ink),
		color: p.color,
		opacity: (INKS[p.ink] || INKS.pen).opacity,
	}
})

// The pieces an eraser leaves of the strokes it is cutting.
const pieces = computed(() => {
	const pending = state.value.erasePending
	if (!pending) return []
	return pending.pieces.map((piece) => ({
		id: piece.id,
		d: outlinePath(boardPoints(piece), piece.style.strokeWidth, piece.ink),
		color: piece.style.stroke,
		opacity: piece.style.opacity,
	}))
})

// Objects that an object-mode eraser is about to remove, outlined.
const marks = computed(() => {
	const pending = state.value.erasePending
	if (!pending?.marks?.size) return []
	return props.store.objects.value
		.filter((o) => pending.marks.has(o.id))
		.map((o) => ({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, r: o.rotation || 0 }))
})

// The laser: a trail that fades over TRAIL_MS, driven by the clock while there is one.
const TRAIL_MS = 900
const now = ref(performance.now())
let frame = 0
function tick() {
	now.value = performance.now()
	const laser = state.value.laser
	if (laser) laser.trail = laser.trail.filter((p) => now.value - p.t < TRAIL_MS)
	if (laser || peerTrails.value.size) frame = requestAnimationFrame(tick)
	else frame = 0
}
watch(
	() => Boolean(state.value.laser),
	(on) => {
		if (on && !frame) frame = requestAnimationFrame(tick)
	},
	{ immediate: true },
)
onBeforeUnmount(() => cancelAnimationFrame(frame))

// Other people's lasers: each peer's recent positions are kept here, so a trail can fade.
const peerTrails = ref(new Map())
watch(
	() => state.value.peers,
	(peers) => {
		const time = performance.now()
		const next = new Map()
		for (const peer of peers) {
			if (!peer.laser) continue
			const trail = [...(peerTrails.value.get(peer.clientId)?.trail || [])]
			const last = trail[trail.length - 1]
			if (!last || last.x !== peer.laser.x || last.y !== peer.laser.y)
				trail.push({ x: peer.laser.x, y: peer.laser.y, t: time })
			next.set(peer.clientId, { color: peer.color, name: peer.name, trail: trail.slice(-60) })
		}
		peerTrails.value = next
		if (next.size && !frame) frame = requestAnimationFrame(tick)
	},
	{ deep: true, immediate: true },
)
const peerLasers = computed(() => {
	const out = []
	for (const [id, { color, name, trail }] of peerTrails.value) {
		const live = trail.filter((p) => now.value - p.t < TRAIL_MS)
		const segments = []
		for (let i = 1; i < live.length; i++)
			segments.push({
				key: i,
				x1: live[i - 1].x,
				y1: live[i - 1].y,
				x2: live[i].x,
				y2: live[i].y,
				opacity: Math.max(0, 1 - (now.value - live[i].t) / TRAIL_MS),
			})
		const head = trail[trail.length - 1]
		out.push({ id, color, name, segments, head })
	}
	return out
})

const trail = computed(() => {
	const laser = state.value.laser
	if (!laser) return []
	const out = []
	const pts = laser.trail
	for (let i = 1; i < pts.length; i++) {
		const age = (now.value - pts[i].t) / TRAIL_MS
		out.push({
			id: i,
			x1: pts[i - 1].x,
			y1: pts[i - 1].y,
			x2: pts[i].x,
			y2: pts[i].y,
			opacity: Math.max(0, 1 - age),
		})
	}
	return out
})
</script>

<template>
	<g :transform="transform" data-testid="ink-layer" pointer-events="none">
		<path
			v-if="live"
			:d="live.d"
			:fill="live.color"
			:opacity="live.opacity"
			data-testid="ink-preview"
		/>
		<path
			v-for="piece in pieces"
			:key="piece.id"
			:d="piece.d"
			:fill="piece.color"
			:opacity="piece.opacity"
			data-testid="erase-piece"
		/>
		<rect
			v-for="mark in marks"
			:key="mark.id"
			:x="mark.x - 3"
			:y="mark.y - 3"
			:width="mark.w + 6"
			:height="mark.h + 6"
			:transform="`rotate(${mark.r} ${mark.x + mark.w / 2} ${mark.y + mark.h / 2})`"
			fill="#EF4444"
			fill-opacity="0.12"
			stroke="#EF4444"
			stroke-width="1.5"
			stroke-dasharray="6 4"
		/>
		<circle
			v-if="state.eraser"
			:cx="state.eraser.x"
			:cy="state.eraser.y"
			:r="state.eraser.r"
			fill="#FFFFFF"
			fill-opacity="0.35"
			stroke="#64748B"
			:stroke-width="1.5 / scale"
			data-testid="eraser-tip"
		/>
		<g v-for="peer in peerLasers" :key="peer.id" data-testid="peer-laser">
			<line
				v-for="seg in peer.segments"
				:key="seg.key"
				:x1="seg.x1"
				:y1="seg.y1"
				:x2="seg.x2"
				:y2="seg.y2"
				:stroke="peer.color"
				stroke-linecap="round"
				:stroke-width="6 / scale"
				:opacity="seg.opacity"
			/>
			<circle
				v-if="peer.head"
				:cx="peer.head.x"
				:cy="peer.head.y"
				:r="7 / scale"
				:fill="peer.color"
				fill-opacity="0.85"
			/>
		</g>
		<template v-if="state.laser">
			<line
				v-for="seg in trail"
				:key="seg.id"
				:x1="seg.x1"
				:y1="seg.y1"
				:x2="seg.x2"
				:y2="seg.y2"
				stroke="#EF4444"
				stroke-linecap="round"
				:stroke-width="6 / scale"
				:opacity="seg.opacity"
			/>
			<circle
				:cx="state.laser.x"
				:cy="state.laser.y"
				:r="7 / scale"
				fill="#EF4444"
				fill-opacity="0.85"
				data-testid="laser-dot"
			/>
		</template>
	</g>
</template>
