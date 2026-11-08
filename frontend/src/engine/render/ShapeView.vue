<script setup>
// One object. It takes the object and a few flags and nothing else, so Vue redraws it only
// when the object itself is replaced. What to draw comes from nodes.js, which export shares.
import { computed } from "vue"
import { measureText } from "../text/measure"
import { objectNode } from "./nodes"
import SvgTree from "./SvgTree"

const props = defineProps({
	object: { type: Object, required: true },
	detail: { type: Boolean, default: true }, // false when zoomed far out: no text
	hideText: { type: Boolean, default: false }, // while the text is being edited
	editingCell: { type: Object, default: null },
	fonts: { type: Number, default: 0 }, // changes when web fonts finish loading
})

const node = computed(() => {
	void props.fonts
	return objectNode(props.object, {
		measure: measureText,
		detail: props.detail,
		hideText: props.hideText,
		editingCell: props.editingCell,
	})
})
</script>

<template>
	<SvgTree :node="node" />
</template>
