// How flowcharts are stored and read back. A document holds ``flowcharts`` as nested records (one
// per chart, with its nodes and edges), which is what is saved and shared. The store keeps the same
// content as three flat lists (charts, nodes, edges). These functions convert both ways and clean
// whatever comes in: documents come from other people and older versions, so nothing is trusted.

import { ID_PATTERN } from "../../model/ids"
import {
	DIRECTIONS,
	FLOW_LABEL_LIMIT,
	FLOW_TEXT_LIMIT,
	MAX_CHARTS,
	MAX_EDGES,
	MAX_NODES,
	NODE_TYPES,
} from "./model"

export const FLOW_LIMITS = {
	charts: MAX_CHARTS,
	nodesPerChart: MAX_NODES,
	edgesPerChart: MAX_EDGES,
	text: FLOW_TEXT_LIMIT,
	label: FLOW_LABEL_LIMIT,
	order: 1000,
	coordinate: 1_000_000,
}

const finite = (v) => typeof v === "number" && Number.isFinite(v)
const clamp = (v, low, high) => Math.min(high, Math.max(low, v))
const validId = (id) => typeof id === "string" && ID_PATTERN.test(id)
const cut = (value, limit) => (typeof value === "string" ? value.slice(0, limit) : "")
const coordinate = (v) =>
	finite(v) ? clamp(v, -FLOW_LIMITS.coordinate, FLOW_LIMITS.coordinate) : 0

// ----- flat records, as the store and the Yjs document hold them -----

export function sanitizeChart(raw) {
	if (!raw || typeof raw !== "object" || !validId(raw.id)) return null
	return {
		id: raw.id,
		direction: DIRECTIONS.includes(raw.direction) ? raw.direction : "TB",
		numbered: raw.numbered === true,
	}
}

export function sanitizeFlowNode(raw) {
	if (!raw || typeof raw !== "object" || !validId(raw.id) || !validId(raw.chartId)) return null
	if (!NODE_TYPES.includes(raw.type)) return null
	return {
		id: raw.id,
		chartId: raw.chartId,
		type: raw.type,
		text: cut(raw.text, FLOW_LIMITS.text),
		x: coordinate(raw.x),
		y: coordinate(raw.y),
		manual: raw.manual === true,
		...(finite(raw.fontSize) && raw.fontSize >= 8 && raw.fontSize <= 200
			? { fontSize: Math.round(raw.fontSize) }
			: {}),
	}
}

export function sanitizeFlowEdge(raw) {
	if (!raw || typeof raw !== "object" || !validId(raw.id) || !validId(raw.chartId)) return null
	if (!validId(raw.from) || !validId(raw.to) || raw.from === raw.to) return null
	return {
		id: raw.id,
		chartId: raw.chartId,
		from: raw.from,
		to: raw.to,
		label: cut(raw.label, FLOW_LIMITS.label),
		order: finite(raw.order) ? clamp(Math.round(raw.order), 0, FLOW_LIMITS.order) : 0,
	}
}

// ----- nested <-> flat -----

export function flattenFlowcharts(flowcharts) {
	const charts = []
	const nodes = []
	const edges = []
	for (const chart of Array.isArray(flowcharts) ? flowcharts : []) {
		if (!chart || typeof chart !== "object") continue
		charts.push({ id: chart.id, direction: chart.direction, numbered: chart.numbered })
		for (const node of Array.isArray(chart.nodes) ? chart.nodes : [])
			nodes.push({ ...node, chartId: chart.id })
		for (const edge of Array.isArray(chart.edges) ? chart.edges : [])
			edges.push({ ...edge, chartId: chart.id })
	}
	return { charts, nodes, edges }
}

export function nestFlowcharts(charts, nodes, edges) {
	const group = (list) => {
		const map = new Map()
		for (const item of list) {
			if (!map.has(item.chartId)) map.set(item.chartId, [])
			map.get(item.chartId).push(item)
		}
		return map
	}
	const nodesByChart = group(nodes)
	const edgesByChart = group(edges)
	return charts.map((chart) => ({
		id: chart.id,
		direction: chart.direction,
		numbered: chart.numbered,
		nodes: (nodesByChart.get(chart.id) || []).map(({ chartId, ...rest }) => rest),
		edges: (edgesByChart.get(chart.id) || []).map(({ chartId, ...rest }) => rest),
	}))
}

// ----- whole-structure repair -----

// Cleans one chart: nodes with a repeated or taken id are dropped, so are edges with a missing end,
// loops back onto the same node, repeats of the same (from, to) pair and ids already used. The
// counts are capped. Returns the cleaned flat records, or null when no node is left.
export function repairChart(chart, nodes, edges, taken = new Set()) {
	const seen = new Set()
	const keptNodes = []
	for (const node of nodes) {
		if (node.chartId !== chart.id || seen.has(node.id) || taken.has(node.id)) continue
		if (keptNodes.length >= FLOW_LIMITS.nodesPerChart) break
		seen.add(node.id)
		keptNodes.push(node)
	}
	if (!keptNodes.length) return null
	const nodeIds = new Set(seen)
	const keptEdges = []
	const pairs = new Set()
	for (const edge of edges) {
		if (edge.chartId !== chart.id) continue
		if (seen.has(edge.id) || taken.has(edge.id)) continue
		if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) continue
		const pair = `${edge.from}\u0000${edge.to}`
		if (pairs.has(pair)) continue
		if (keptEdges.length >= FLOW_LIMITS.edgesPerChart) break
		pairs.add(pair)
		seen.add(edge.id)
		keptEdges.push(edge)
	}
	return { chart, nodes: keptNodes, edges: keptEdges }
}

// A raw ``flowcharts`` value from a document, cleaned: the nested records to keep, and what was
// dropped. ``taken`` holds ids already used by other objects, which a chart may not reuse.
export function sanitizeFlowcharts(raw, taken = new Set()) {
	const issues = []
	const out = []
	const used = new Set(taken)
	for (const entry of Array.isArray(raw) ? raw : []) {
		if (out.length >= FLOW_LIMITS.charts) {
			issues.push("dropped a flowchart over the limit")
			break
		}
		const chart = sanitizeChart(entry)
		if (!chart || used.has(chart.id)) {
			issues.push("dropped a flowchart")
			continue
		}
		const list = (value, limit) => (Array.isArray(value) ? value.slice(0, limit * 2) : [])
		const nodes = list(entry.nodes, FLOW_LIMITS.nodesPerChart)
			.map((n) =>
				n && typeof n === "object" ? sanitizeFlowNode({ ...n, chartId: chart.id }) : null,
			)
			.filter(Boolean)
		const edges = list(entry.edges, FLOW_LIMITS.edgesPerChart)
			.map((e) =>
				e && typeof e === "object" ? sanitizeFlowEdge({ ...e, chartId: chart.id }) : null,
			)
			.filter(Boolean)
		const repaired = repairChart(chart, nodes, edges, new Set([...used, chart.id]))
		if (!repaired) {
			issues.push(`dropped flowchart ${chart.id}: no nodes`)
			continue
		}
		const rawNodes = Array.isArray(entry.nodes) ? entry.nodes.length : 0
		const rawEdges = Array.isArray(entry.edges) ? entry.edges.length : 0
		if (repaired.nodes.length < rawNodes || repaired.edges.length < rawEdges)
			issues.push(`repaired flowchart ${chart.id}`)
		used.add(chart.id)
		for (const n of repaired.nodes) used.add(n.id)
		for (const e of repaired.edges) used.add(e.id)
		out.push(...nestFlowcharts([repaired.chart], repaired.nodes, repaired.edges))
	}
	return { flowcharts: out, issues }
}
