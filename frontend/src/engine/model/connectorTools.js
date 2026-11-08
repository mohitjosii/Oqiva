// The six line tools: three geometries, each as a plain line or an arrow. A document stores
// the geometry and the arrowheads, never which tool drew it.

export const CONNECTOR_TOOLS = [
	{
		id: "line-straight",
		label: "Straight line",
		geometry: "straight",
		arrow: false,
		icon: "minus",
	},
	{
		id: "line-elbow",
		label: "Elbow line",
		geometry: "elbow",
		arrow: false,
		icon: "corner-down-right",
	},
	{ id: "line-curved", label: "Curved line", geometry: "curved", arrow: false, icon: "activity" },
	{
		id: "arrow-straight",
		label: "Straight arrow",
		geometry: "straight",
		arrow: true,
		icon: "arrow-right",
	},
	{
		id: "arrow-elbow",
		label: "Elbow arrow",
		geometry: "elbow",
		arrow: true,
		icon: "corner-right-down",
	},
	{
		id: "arrow-curved",
		label: "Curved arrow",
		geometry: "curved",
		arrow: true,
		icon: "trending-up",
	},
]

export const connectorToolById = (id) => CONNECTOR_TOOLS.find((tool) => tool.id === id) || null
