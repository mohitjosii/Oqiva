// The shape library: ready-made shapes for diagrams, in three groups. A preset is only data
// (which geometry, how big, what colour); turning one into an object is ``presetObject``.

import { newId } from "./ids"
import { sanitizeText } from "./schema"
import { SWATCHES } from "../interaction/palette"
import { defaultAlign } from "./shapes"

const tone = (name) => SWATCHES.find(([label]) => label === name)[1] // [tint, mid, deep]
const COLORS = {
	violet: tone("Violet"),
	green: tone("Green"),
	blue: tone("Blue"),
	orange: tone("Orange"),
	red: tone("Red"),
	yellow: tone("Yellow"),
	grey: tone("Gray"),
	black: ["#FFFFFF", "#111827", "#111827"],
}

const p = (key, label, shape, w, h, color, fill, aliases, extra = {}) => ({
	key,
	label,
	shape,
	w,
	h,
	color,
	fill,
	aliases,
	...extra,
})

export const LIBRARY = [
	{
		group: "Architecture",
		hint: "Systems, services and infrastructure",
		presets: [
			p(
				"server",
				"Server",
				"rectangle",
				180,
				100,
				"violet",
				"semi",
				["host", "vm", "machine"],
				{ icon: "server" },
			),
			p(
				"database",
				"Database",
				"cylinder",
				160,
				110,
				"green",
				"semi",
				["db", "postgres", "sql", "store"],
				{ icon: "database" },
			),
			p("service", "Service", "rectangle", 180, 90, "blue", "semi", ["microservice", "api"], {
				icon: "box",
			}),
			p("api", "API", "rectangle", 160, 80, "blue", "semi", ["endpoint", "rest", "graphql"], {
				icon: "braces",
			}),
			p(
				"queue",
				"Queue",
				"rectangle",
				190,
				70,
				"orange",
				"semi",
				["kafka", "sqs", "topic", "broker"],
				{ icon: "rows-3" },
			),
			p("cache", "Cache", "rectangle", 150, 100, "orange", "semi", ["redis", "memcached"], {
				icon: "zap",
			}),
			p(
				"storage",
				"Object storage",
				"rectangle",
				170,
				110,
				"green",
				"semi",
				["s3", "bucket", "blob", "files"],
				{ icon: "hard-drive" },
			),
			p(
				"cloud",
				"Cloud",
				"cloud",
				190,
				110,
				"grey",
				"semi",
				["aws", "gcp", "azure", "external"],
				{ icon: "cloud" },
			),
			p(
				"gateway",
				"Gateway",
				"hexagon",
				170,
				100,
				"violet",
				"semi",
				["proxy", "ingress", "load balancer"],
				{ icon: "waypoints" },
			),
			p(
				"user-actor",
				"User",
				"ellipse",
				130,
				110,
				"blue",
				"none",
				["actor", "person", "client"],
				{ icon: "user" },
			),
			p(
				"device",
				"Device",
				"rectangle",
				130,
				150,
				"grey",
				"none",
				["phone", "mobile", "browser"],
				{ icon: "smartphone" },
			),
			p(
				"external",
				"External system",
				"rectangle",
				190,
				90,
				"grey",
				"pattern",
				["third party", "vendor"],
				{ icon: "external-link" },
			),
		],
	},
	{
		group: "Flowchart",
		hint: "Process and decision shapes",
		presets: [
			p("process", "Process", "rectangle", 190, 90, "black", "none", [
				"step",
				"task",
				"action",
			]),
			p("decision", "Decision", "diamond", 190, 120, "orange", "none", [
				"branch",
				"if",
				"condition",
			]),
			p(
				"terminator",
				"Start / end",
				"rectangle",
				150,
				70,
				"blue",
				"none",
				["begin", "finish", "terminator"],
				{ radius: 35 },
			),
			p("document", "Document", "document", 170, 100, "black", "none", [
				"report",
				"output",
				"file",
			]),
			p("input", "Input", "trapezoid", 180, 90, "green", "none", ["data", "entry"]),
			p(
				"manual",
				"Manual step",
				"trapezoid",
				180,
				90,
				"orange",
				"none",
				["human", "operator"],
				{ flipY: true },
			),
		],
	},
	{
		group: "Wireframe",
		hint: "Interface building blocks",
		presets: [
			p(
				"screen",
				"Screen",
				"desktop",
				360,
				240,
				"grey",
				"none",
				["page", "view", "frame", "desktop"],
				{ icon: "monitor", noText: true },
			),
			p(
				"mobile",
				"Mobile screen",
				"mobile",
				200,
				380,
				"grey",
				"none",
				["phone", "app", "frame"],
				{ icon: "smartphone", noText: true },
			),
			p(
				"nav",
				"Navigation",
				"rectangle",
				360,
				56,
				"grey",
				"semi",
				["header", "menu", "toolbar"],
				{ icon: "panel-top" },
			),
			p("button", "Button", "rectangle", 120, 40, "blue", "solid", ["cta", "action"], {
				icon: "mouse-pointer-click",
				radius: 8,
			}),
			p(
				"input-field",
				"Text field",
				"rectangle",
				220,
				40,
				"grey",
				"none",
				["field", "text box", "form", "input"],
				{ icon: "text-cursor-input", radius: 6, align: "left", text: "Placeholder" },
			),
			p(
				"checkbox",
				"Checkbox",
				"checkbox",
				160,
				28,
				"grey",
				"none",
				["tick", "option", "toggle"],
				{ icon: "square-check" },
			),
			p("radio", "Radio button", "radio", 160, 28, "grey", "none", ["option", "choice"], {
				icon: "circle-dot",
			}),
			p(
				"dropdown",
				"Dropdown",
				"dropdown",
				200,
				40,
				"grey",
				"none",
				["select", "picker", "menu"],
				{ icon: "chevrons-up-down", text: "Select…" },
			),
			p("card", "Card", "rectangle", 200, 140, "grey", "none", ["tile", "panel"], {
				icon: "layout-template",
				radius: 8,
			}),
			p(
				"modal",
				"Modal",
				"rectangle",
				260,
				170,
				"violet",
				"semi",
				["dialog", "popup", "overlay"],
				{ icon: "app-window", radius: 10 },
			),
			p(
				"image-block",
				"Image",
				"rectangle",
				200,
				140,
				"grey",
				"pattern",
				["photo", "media", "placeholder"],
				{ icon: "image" },
			),
			p("avatar", "Avatar", "ellipse", 64, 64, "grey", "semi", ["profile", "user image"], {
				icon: "circle-user",
			}),
		],
	},
]

export const PRESETS = LIBRARY.flatMap((group) =>
	group.presets.map((p) => ({ ...p, group: group.group })),
)
export const presetByKey = (key) => PRESETS.find((preset) => preset.key === key) || null

// Matches for ``query`` in each group: label starts with it, label contains it, an alias starts
// with it, an alias contains it. Best first, catalogue order within a rank; empty groups drop out.
export function searchPresets(query) {
	const needle = String(query || "")
		.trim()
		.toLowerCase()
	if (!needle) return LIBRARY.map((group) => ({ ...group, presets: [...group.presets] }))
	const rank = (preset) => {
		const label = preset.label.toLowerCase()
		if (label.startsWith(needle)) return 0
		if (label.includes(needle)) return 1
		if (preset.aliases.some((alias) => alias.startsWith(needle))) return 2
		if (preset.aliases.some((alias) => alias.includes(needle))) return 3
		return null
	}
	return LIBRARY.map((group) => ({
		...group,
		presets: group.presets
			.map((preset, index) => ({ preset, index, rank: rank(preset) }))
			.filter((entry) => entry.rank !== null)
			.sort((a, b) => a.rank - b.rank || a.index - b.index)
			.map((entry) => entry.preset),
	})).filter((group) => group.presets.length)
}

export const MAX_RECENT_PRESETS = 4
export const pushRecentPreset = (recent, key) =>
	[key, ...recent.filter((k) => k !== key)].slice(0, MAX_RECENT_PRESETS)
// Drops keys that are no longer in the catalogue.
export const resolveRecent = (recent) => recent.map(presetByKey).filter(Boolean)

// The object a preset becomes, with its top-left corner at ``at``.
export function presetObject(preset, at, { theme, z }) {
	const [tint, mid, deep] = COLORS[preset.color]
	const solid = preset.fill === "solid"
	const fill = preset.fill === "none" ? "#FFFFFF" : solid ? mid : tint
	const inkOnSolid = "#FFFFFF"
	const label = preset.text ?? preset.label
	const object = {
		id: newId(),
		kind: "shape",
		shape: preset.shape,
		x: at.x,
		y: at.y,
		w: preset.w,
		h: preset.h,
		rotation: 0,
		z,
		style: {
			fill,
			stroke: preset.color === "black" ? "#111827" : mid,
			strokeWidth: 2,
			dash: preset.fill === "pattern" ? "dashed" : "solid",
			opacity: 1,
			radius: preset.radius ?? 8,
		},
		text: preset.noText
			? null
			: sanitizeText(
					{
						align: preset.align || defaultAlign(preset.shape),
						size: 16,
						color: solid ? inkOnSolid : deep,
						paragraphs: [{ runs: label ? [{ t: label }] : [] }],
					},
					theme,
				),
	}
	if (preset.flipY) object.flipY = true
	return object
}
