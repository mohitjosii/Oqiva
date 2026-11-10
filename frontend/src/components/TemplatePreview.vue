<script setup>
import { computed } from "vue"
import { previewGeometry } from "@/utils/templates"

const props = defineProps({
	preview: { type: Object, default: () => ({ objects: [], connectors: [] }) },
	label: { type: String, default: "" },
})

const view = computed(() => previewGeometry(props.preview))
</script>

<template>
	<svg
		:viewBox="view.viewBox"
		preserveAspectRatio="xMidYMid meet"
		class="h-full w-full"
		role="img"
		:aria-label="label"
	>
		<template v-if="!view.empty">
			<line
				v-for="line in view.lines"
				:key="line.id"
				:x1="line.x1"
				:y1="line.y1"
				:x2="line.x2"
				:y2="line.y2"
				stroke="#64748B"
				stroke-width="1.5"
				vector-effect="non-scaling-stroke"
				stroke-linecap="round"
			/>
			<g v-for="shape in view.shapes" :key="shape.id">
				<ellipse
					v-if="shape.kind === 'ellipse'"
					:cx="shape.x + shape.w / 2"
					:cy="shape.y + shape.h / 2"
					:rx="shape.w / 2"
					:ry="shape.h / 2"
					:fill="shape.fill"
					:stroke="shape.stroke"
					stroke-width="1.5"
					vector-effect="non-scaling-stroke"
				/>
				<polygon
					v-else-if="shape.points"
					:points="shape.points"
					:fill="shape.fill"
					:stroke="shape.stroke"
					stroke-width="1.5"
					vector-effect="non-scaling-stroke"
				/>
				<rect
					v-else-if="shape.kind !== 'text'"
					:x="shape.x"
					:y="shape.y"
					:width="shape.w"
					:height="shape.h"
					:rx="Math.min(shape.w, shape.h) * 0.08"
					:fill="shape.fill"
					:stroke="shape.stroke"
					stroke-width="1.5"
					vector-effect="non-scaling-stroke"
				/>
				<text
					v-if="shape.labelSize"
					:x="shape.x + shape.w / 2"
					:y="shape.y + shape.h / 2"
					:font-size="shape.labelSize"
					text-anchor="middle"
					dominant-baseline="central"
					fill="#334155"
				>
					{{ shape.label }}
				</text>
			</g>
		</template>
		<g
			v-else
			fill="none"
			stroke="#CBD5E1"
			stroke-dasharray="4 4"
			vector-effect="non-scaling-stroke"
		>
			<rect
				x="20"
				y="14"
				width="120"
				height="72"
				rx="6"
				stroke-width="1.5"
				vector-effect="non-scaling-stroke"
			/>
		</g>
	</svg>
</template>
