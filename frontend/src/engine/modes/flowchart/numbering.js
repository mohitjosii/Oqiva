// Optional step numbers (DF-F11). Steps are counted in flow order: breadth first from the nodes
// nothing points to, following each node's outputs by their order. Only process, decision and
// input/output nodes get a number; start/end terminators and junctions are passed through.

const NUMBERED_TYPES = new Set(["process", "decision", "io"])

const byOrder = (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function stepNumbers(chart, nodes, edges) {
	const byId = new Map()
	for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node)
	const outs = new Map()
	const hasIn = new Set()
	for (const edge of edges) {
		if (!byId.has(edge.from) || !byId.has(edge.to)) continue
		if (!outs.has(edge.from)) outs.set(edge.from, [])
		outs.get(edge.from).push(edge)
		hasIn.add(edge.to)
	}
	const numbers = new Map()
	let next = 1
	const visit = (node) => {
		if (NUMBERED_TYPES.has(node.type)) numbers.set(node.id, next++)
	}
	const seen = new Set()
	const queue = []
	for (const node of byId.values()) {
		if (hasIn.has(node.id)) continue
		seen.add(node.id)
		queue.push(node.id)
	}
	for (let i = 0; i < queue.length; i++) {
		const id = queue[i]
		visit(byId.get(id))
		for (const edge of [...(outs.get(id) || [])].sort(byOrder)) {
			if (seen.has(edge.to)) continue
			seen.add(edge.to)
			queue.push(edge.to)
		}
	}
	// What no source reaches (a loop with no way in) follows, in id order.
	const rest = [...byId.values()].filter((n) => !seen.has(n.id))
	rest.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
	for (const node of rest) visit(node)
	return numbers
}
