// Draws a description from nodes.js as Vue nodes.
import { defineComponent, h } from "vue"

function toVNode(node) {
	if (node.text !== undefined) return node.text
	const attrs = {}
	for (const [name, value] of Object.entries(node.attrs)) {
		if (value !== null && value !== undefined) attrs[name] = value
	}
	return h(node.tag, attrs, node.children.map(toVNode))
}

export default defineComponent({
	name: "SvgTree",
	props: { node: { type: Object, required: true } },
	setup: (props) => () => toVNode(props.node),
})
