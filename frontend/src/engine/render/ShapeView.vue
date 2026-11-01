<script setup>
// One object, drawn in board coordinates. It takes the object and a few flags and nothing
// else, so Vue redraws it only when the object itself is replaced.
import { computed } from "vue"
import { layoutFor } from "../text/fit"
import { measureText } from "../text/measure"
import { shapePath, textArea } from "../model/shapes"

const props = defineProps({
	object: { type: Object, required: true },
	detail: { type: Boolean, default: true }, // false when zoomed far out: no text
	hideText: { type: Boolean, default: false }, // while the text is being edited
	fonts: { type: Number, default: 0 }, // changes when web fonts finish loading
})

const FONT = "Inter, ui-sans-serif, system-ui, sans-serif"
const DASHES = { solid: null, dashed: "8 6", dotted: "2 5" }

const transform = computed(() => {
	const o = props.object
	return `translate(${o.x + o.w / 2} ${o.y + o.h / 2}) rotate(${o.rotation || 0}) translate(${-o.w / 2} ${-o.h / 2})`
})
const path = computed(() => shapePath(props.object))
const style = computed(() => props.object.style)
const paint = computed(() => ({
	fill: style.value.fill || "none",
	stroke: style.value.stroke || "none",
	"stroke-width": style.value.strokeWidth,
	"stroke-dasharray": props.detail ? DASHES[style.value.dash] : null,
	"stroke-linejoin": "round",
}))

const lines = computed(() => {
	void props.fonts
	const object = props.object
	if (!props.detail || props.hideText || !object.text) return []
	const layout = layoutFor(object, measureText)
	const area = textArea(object)
	const align = object.text.align
	const top = object.kind === "text" ? area.y : area.y + Math.max(0, (area.h - layout.height) / 2)
	const x = align === "left" ? area.x : align === "right" ? area.x + area.w : area.x + area.w / 2
	const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle"
	return layout.lines.map((line, index) => ({
		key: index,
		x,
		anchor,
		y: top + index * layout.lineHeight + layout.lineHeight / 2,
		runs: line.runs,
	}))
})
</script>

<template>
	<g :transform="transform" :opacity="style.opacity" pointer-events="none">
		<rect
			v-if="object.shape === 'rectangle'"
			:width="object.w"
			:height="object.h"
			:rx="Math.min(style.radius, object.w / 2, object.h / 2)"
			v-bind="paint"
		/>
		<ellipse
			v-else-if="object.shape === 'ellipse'"
			:cx="object.w / 2"
			:cy="object.h / 2"
			:rx="object.w / 2"
			:ry="object.h / 2"
			v-bind="paint"
		/>
		<path v-else-if="path" :d="path" v-bind="paint" />
		<text
			v-for="line in lines"
			:key="line.key"
			:x="line.x"
			:y="line.y"
			:text-anchor="line.anchor"
			:font-size="object.text.size"
			:font-family="FONT"
			:fill="object.text.color"
			dominant-baseline="central"
			style="white-space: pre"
		>
			<tspan
				v-for="(run, index) in line.runs"
				:key="index"
				:font-weight="run.b ? 600 : null"
				:font-style="run.i ? 'italic' : null"
				:text-decoration="run.u ? 'underline' : null"
				:fill="run.c || null"
				>{{ run.t }}</tspan
			>
		</text>
	</g>
</template>
