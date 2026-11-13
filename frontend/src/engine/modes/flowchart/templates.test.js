import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { flattenFlowcharts } from "./document"
import { tidyLayout } from "./layout"
import { routeAll } from "./routing"
import { clearRouteExists, measure, placed, routeCrossings } from "./layoutTestUtils"
import { createFlowEdge } from "./model"

const SEED = resolve(__dirname, "../../../../../oqiva/seed/templates")
export const TEMPLATES = [
	"bug-triage-flow",
	"support-escalation-flow",
	"purchase-approval-flow",
	"incident-response",
	"decision-tree",
	"user-signup-flow",
]

// The charts of a shipped template as flat records, the shape the store holds.
export function templateCharts(slug) {
	const doc = JSON.parse(readFileSync(resolve(SEED, `${slug}.json`), "utf8")).document
	const { charts, nodes, edges } = flattenFlowcharts(doc.flowcharts)
	return charts.map((chart) => ({
		chart,
		nodes: nodes.filter((n) => n.chartId === chart.id),
		edges: edges.filter((e) => e.chartId === chart.id),
	}))
}

describe("shipped flowchart templates", () => {
	for (const slug of TEMPLATES) {
		for (const { chart, nodes, edges } of templateCharts(slug)) {
			it(`${slug} / ${chart.id}: no arrow crosses a step (as shipped and after Tidy up)`, () => {
				const shipped = routeAll(chart, nodes, edges, measure)
				expect(routeCrossings(nodes, edges, shipped)).toEqual([])
				const tidy = placed(nodes, tidyLayout(chart, nodes, edges, measure))
				const rs = routeAll(chart, tidy, edges, measure)
				const crossings = routeCrossings(tidy, edges, rs)
				expect(crossings).toEqual([])
			})
		}
	}
})

// Arrows that skip steps: from every third step (in reading order) to the one three places on.
function withLongArrows(chart, nodes, edges, measure) {
	const tidy = placed(nodes, tidyLayout(chart, nodes, edges, measure))
	const order = [...tidy].sort((a, b) => a.y - b.y || a.x - b.x)
	const extra = []
	for (let i = 0; i + 3 < order.length; i += 3) {
		const from = order[i].id
		const to = order[i + 3].id
		if (edges.some((e) => e.from === from && e.to === to)) continue
		extra.push(
			createFlowEdge({ id: `x${i}`, chartId: chart.id, from, to, order: 9, label: "" }),
		)
	}
	return [...edges, ...extra]
}

describe("shipped flowchart templates with extra long arrows", () => {
	for (const slug of TEMPLATES) {
		for (const { chart, nodes, edges } of templateCharts(slug)) {
			it(`${slug} / ${chart.id}: Tidy up leaves every arrow clear of the steps`, () => {
				const all = withLongArrows(chart, nodes, edges, measure)
				expect(all.length).toBeGreaterThan(edges.length)
				const tidy = placed(nodes, tidyLayout(chart, nodes, all, measure))
				const rs = routeAll(chart, tidy, all, measure)
				expect(routeCrossings(tidy, all, rs)).toEqual([])
			})
			it(`${slug} / ${chart.id}: steps dragged by hand (arrows keep clear when a route exists)`, () => {
				const moved = nodes.map((n, i) =>
					i % 3 === 1 ? { ...n, x: n.x + 90, y: n.y + 55, manual: true } : n,
				)
				const rs = routeAll(chart, moved, edges, measure)
				for (const { edge } of routeCrossings(moved, edges, rs)) {
					const e = edges.find((x) => x.id === edge)
					expect(
						clearRouteExists(moved, e, rs.get(edge)),
						`${edge} could be routed`,
					).toBe(false)
				}
			})
		}
	}
})
