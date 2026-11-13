// Test helpers: build a chart's records from short specs.
//   flow({ nodes: [["a", "terminator", 0, 0], ["b", "process", 0, 200]], edges: [["a", "b"]] })
// A node is [id, type, x, y, text?] and an edge is [from, to, label?, order?]. Edge ids are
// "from>to".

export const measure = (text, size) => text.length * size * 0.5

export const CHART_ID = "c"

export function flow({ nodes = [], edges = [], direction = "TB", numbered = false } = {}) {
	return {
		chart: { id: CHART_ID, direction, numbered },
		nodes: nodes.map(([id, type = "process", x = 0, y = 0, text, manual = false]) => ({
			id,
			chartId: CHART_ID,
			type,
			text:
				text ??
				{
					terminator: "Start",
					process: "Step",
					decision: "Decision?",
					io: "Input",
					junction: "",
				}[type],
			x,
			y,
			manual,
		})),
		edges: edges.map(([from, to, label = "", order = 0]) => ({
			id: `${from}>${to}`,
			chartId: CHART_ID,
			from,
			to,
			label,
			order,
		})),
	}
}

export const frozen = (...values) => JSON.stringify(values)
