<script setup>
import { computed } from "vue"
import { measureText } from "../text/measure"
import { connectorNode } from "./nodes"
import SvgTree from "./SvgTree"

const props = defineProps({
	connector: { type: Object, required: true },
	path: { type: Object, required: true },
	detail: { type: Boolean, default: true },
	hideLabel: { type: Boolean, default: false }, // while the label is being edited
	background: { type: String, default: "#ffffff" },
	fonts: { type: Number, default: 0 },
	sketch: { type: Boolean, default: false }, // the board's hand-drawn style
})

const node = computed(() => {
	void props.fonts
	return connectorNode(props.connector, props.path, {
		measure: measureText,
		detail: props.detail && !props.hideLabel,
		background: props.background,
		sketch: props.sketch,
	})
})
</script>

<template>
	<SvgTree :node="node" />
</template>
