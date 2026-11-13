// The board document (ARCHITECTURE section 15.2): one JSON value holding everything on a
// board. Documents come from other people and from older versions of the app, so
// parseDocument never trusts its input: it migrates, clamps, and drops what cannot be drawn.

import { DEFAULT_THEME, THEMES, isColor } from "./themes"
import { ID_PATTERN } from "./ids"
import { ICON_PATTERN, isEmoji } from "./icons"
import { sanitizeFlowcharts } from "../modes/flowchart/document"
import { sanitizeMindmaps } from "../modes/mindmap/document"

export const SCHEMA_VERSION = 1

export const CANVAS_PRESETS = {
	"16:9": { label: "Widescreen 16:9", width: 1280, height: 720 },
	"4:3": { label: "Standard 4:3", width: 1024, height: 768 },
	"a4-landscape": { label: "A4 landscape", width: 1123, height: 794 },
	"a4-portrait": { label: "A4 portrait", width: 794, height: 1123 },
	"letter-landscape": { label: "Letter landscape", width: 1056, height: 816 },
	"letter-portrait": { label: "Letter portrait", width: 816, height: 1056 },
	square: { label: "Square", width: 1080, height: 1080 },
}

export const GRID_SIZES = { dense: 16, sparse: 48 }
export const KNOWN_KINDS = new Set([
	"shape",
	"text",
	"image",
	"table",
	"note",
	"icon",
	"frame",
	"stroke",
])
export const STROKE_INKS = new Set(["pen", "highlighter"])
export const DOUBLE_CLICK = new Set(["shape", "text"])
export const GEOMETRIES = new Set(["straight", "elbow", "curved"])
export const HEADS = new Set(["none", "arrow", "open", "dot"])
export const ANCHOR_NAMES = new Set(["n", "ne", "e", "se", "s", "sw", "w", "nw"])
// Pictures live in the board's own private files, never at an address someone else chose.
export const IMAGE_SRC = /^\/private\/files\/[A-Za-z0-9._%()+~-]{1,200}$/
export const TABLE_LIMITS = { maxRows: 30, maxCols: 20, minSize: 20, maxSize: 2000 }
export const SHAPE_NAMES = new Set([
	"rectangle",
	"ellipse",
	"triangle",
	"diamond",
	"polygon",
	"arrow",
	"cylinder",
	"document",
	"cloud",
	"hexagon",
	"trapezoid",
	"checkbox",
	"radio",
	"dropdown",
	"mobile",
	"desktop",
])
// Sticky note colours: a pale tint to fill the note and a deep tone for its writing.
export const NOTE_COLORS = [
	{ name: "Yellow", fill: "#FEF08A", ink: "#713F12" },
	{ name: "Orange", fill: "#FDBA74", ink: "#7C2D12" },
	{ name: "Pink", fill: "#F9A8D4", ink: "#831843" },
	{ name: "Violet", fill: "#C4B5FD", ink: "#3B0764" },
	{ name: "Blue", fill: "#93C5FD", ink: "#1E3A8A" },
	{ name: "Green", fill: "#86EFAC", ink: "#14532D" },
	{ name: "Gray", fill: "#E5E7EB", ink: "#1F2937" },
]
export const LINK_LIMITS = { url: 2000, board: 140 }
const LINK_URL = /^(https?:\/\/|mailto:)[^\s<>"']+$/i
const LINK_BOARD = /^[A-Za-z0-9_.-]{1,140}$/
export const DASHES = new Set(["solid", "dashed", "dotted"])
export const ALIGNS = new Set(["left", "center", "right"])

export const LIMITS = {
	coordinate: 1_000_000,
	maxSize: 100_000,
	maxTextChars: 10_000,
	maxRuns: 500,
}

export class DocumentError extends Error {
	constructor(code, message) {
		super(message)
		this.name = "DocumentError"
		this.code = code // "invalid" or "too_new"
	}
}

export function createDocument({ theme = DEFAULT_THEME } = {}) {
	return {
		schemaVersion: SCHEMA_VERSION,
		canvas: {
			mode: "infinite",
			preset: "16:9",
			background: null,
			grid: "off",
			sketch: false,
			doubleClick: "shape",
		},
		theme: { preset: theme },
		objects: [],
		connectors: [],
		mindmaps: [],
		flowcharts: [],
	}
}

export function pageSize(canvas) {
	const preset = CANVAS_PRESETS[canvas.preset] || CANVAS_PRESETS["16:9"]
	return { width: preset.width, height: preset.height }
}

const number = (value, fallback, min, max) =>
	typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback

export function normalizeRotation(degrees) {
	const turn = ((degrees % 360) + 360) % 360
	return Math.round(turn * 100) / 100
}

function sanitizeRun(run) {
	if (!run || typeof run.t !== "string" || !run.t) return null
	const clean = { t: run.t }
	if (run.b === 1 || run.b === true) clean.b = 1
	if (run.i === 1 || run.i === true) clean.i = 1
	if (run.u === 1 || run.u === true) clean.u = 1
	if (isColor(run.c)) clean.c = run.c
	return clean
}

export function sanitizeText(text, themeName = DEFAULT_THEME) {
	if (!text || typeof text !== "object" || !Array.isArray(text.paragraphs)) return null
	let budget = LIMITS.maxTextChars
	let runCount = 0
	const paragraphs = []
	for (const paragraph of text.paragraphs) {
		const runs = []
		for (const raw of Array.isArray(paragraph?.runs) ? paragraph.runs : []) {
			const run = sanitizeRun(raw)
			if (!run || budget <= 0 || runCount >= LIMITS.maxRuns) continue
			run.t = run.t.slice(0, budget)
			budget -= run.t.length
			runCount++
			runs.push(run)
		}
		paragraphs.push({ runs })
	}
	const theme = THEMES[themeName] || THEMES[DEFAULT_THEME]
	return {
		align: ALIGNS.has(text.align) ? text.align : "center",
		size: number(text.size, 16, 8, 200),
		color: isColor(text.color) ? text.color : theme.text,
		paragraphs,
	}
}

const finite = (value) => typeof value === "number" && Number.isFinite(value)
const STROKE_MAX_POINTS = 4000

function sanitizeEnd(end, objectIds) {
	if (end && typeof end.objectId === "string") {
		return objectIds.has(end.objectId) && ANCHOR_NAMES.has(end.anchor)
			? { objectId: end.objectId, anchor: end.anchor }
			: null
	}
	if (end && finite(end.x) && finite(end.y)) {
		return {
			x: number(end.x, 0, -LIMITS.coordinate, LIMITS.coordinate),
			y: number(end.y, 0, -LIMITS.coordinate, LIMITS.coordinate),
		}
	}
	return null
}

export function sanitizeConnector(raw, index, objectIds) {
	if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !ID_PATTERN.test(raw.id))
		return null
	const from = sanitizeEnd(raw.from, objectIds)
	const to = sanitizeEnd(raw.to, objectIds)
	if (!from || !to) return null // an end attached to something that is gone cannot be drawn
	const style = sanitizeStyle(raw.style)
	const label =
		typeof raw.label?.text === "string" && raw.label.text.trim()
			? { text: raw.label.text.slice(0, 200) }
			: null
	return {
		id: raw.id,
		from,
		to,
		geometry: GEOMETRIES.has(raw.geometry) ? raw.geometry : "straight",
		heads: {
			start: HEADS.has(raw.heads?.start) ? raw.heads.start : "none",
			end: HEADS.has(raw.heads?.end) ? raw.heads.end : "none",
		},
		bend: number(raw.bend, 0, -5000, 5000),
		style: {
			stroke: style.stroke || "#475569",
			strokeWidth: Math.max(1, style.strokeWidth),
			dash: style.dash,
			opacity: style.opacity,
			...(typeof raw.style?.sketch === "boolean" ? { sketch: raw.style.sketch } : {}),
		},
		label,
		z: number(raw.z, index, -1e9, 1e9),
	}
}

export function sanitizeTable(raw, themeName) {
	const size = (list) =>
		(Array.isArray(list) ? list : [])
			.slice(0, TABLE_LIMITS.maxRows)
			.map((v) => number(v, 100, TABLE_LIMITS.minSize, TABLE_LIMITS.maxSize))
	const rowH = size(raw?.rowH)
	const colW = size(raw?.colW).slice(0, TABLE_LIMITS.maxCols)
	if (!rowH.length || !colW.length) return null
	const cells = rowH.map((_, r) =>
		colW.map((__, c) => sanitizeText(raw.cells?.[r]?.[c], themeName)),
	)
	const fills = rowH.map((_, r) =>
		colW.map((__, c) => (isColor(raw.fills?.[r]?.[c]) ? raw.fills[r][c] : null)),
	)
	return { colW, rowH, cells, fills }
}

// A link on an object: a web address or mail address, or another board. Anything else (a
// javascript: address, say) is dropped.
export function sanitizeLink(raw) {
	if (!raw || typeof raw !== "object") return null
	if (typeof raw.url === "string") {
		const url = raw.url.trim()
		return url.length <= LINK_LIMITS.url && LINK_URL.test(url) ? { url } : null
	}
	if (typeof raw.board === "string" && LINK_BOARD.test(raw.board)) {
		return {
			board: raw.board,
			title: typeof raw.title === "string" ? raw.title.slice(0, 140) : "",
		}
	}
	return null
}

function sanitizeStyle(style = {}) {
	const source = style && typeof style === "object" ? style : {}
	return {
		fill: source.fill === null ? null : isColor(source.fill) ? source.fill : null,
		stroke: source.stroke === null ? null : isColor(source.stroke) ? source.stroke : "#475569",
		strokeWidth: number(source.strokeWidth, 2, 0, 20),
		dash: DASHES.has(source.dash) ? source.dash : "solid",
		opacity: number(source.opacity, 1, 0, 1),
		radius: number(source.radius, 0, 0, 200),
		...(typeof source.sketch === "boolean" ? { sketch: source.sketch } : {}),
	}
}

// The points of a freehand stroke: pairs of fractions of its box. At least one, at most 4,000.
function sanitizePoints(raw) {
	if (!Array.isArray(raw)) return null
	const points = []
	for (const pair of raw) {
		if (!Array.isArray(pair) || !finite(pair[0]) || !finite(pair[1])) continue
		const point = [
			Math.round(Math.min(1, Math.max(0, pair[0])) * 10000) / 10000,
			Math.round(Math.min(1, Math.max(0, pair[1])) * 10000) / 10000,
		]
		if (finite(pair[2]))
			point.push(Math.round(Math.min(1, Math.max(0, pair[2])) * 10000) / 10000)
		points.push(point)
		if (points.length >= STROKE_MAX_POINTS) break
	}
	return points.length ? points : null
}

export function sanitizeObject(raw, index, themeName) {
	if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !ID_PATTERN.test(raw.id))
		return null
	if (typeof raw.kind !== "string" || !KNOWN_KINDS.has(raw.kind)) return { ...raw } // kept for newer versions
	const isText = raw.kind === "text"
	const hasText = raw.kind === "shape" || isText || raw.kind === "note"
	const object = {
		id: raw.id,
		kind: raw.kind,
		shape: raw.kind === "shape" && SHAPE_NAMES.has(raw.shape) ? raw.shape : "rectangle",
		x: number(raw.x, 0, -LIMITS.coordinate, LIMITS.coordinate),
		y: number(raw.y, 0, -LIMITS.coordinate, LIMITS.coordinate),
		w: number(raw.w, 100, 1, LIMITS.maxSize),
		h: number(raw.h, 60, 1, LIMITS.maxSize),
		rotation: normalizeRotation(number(raw.rotation, 0, -1e6, 1e6)),
		z: number(raw.z, index, -1e9, 1e9),
		style: sanitizeStyle(raw.style),
		text: hasText ? sanitizeText(raw.text, themeName) : null,
	}
	const link = sanitizeLink(raw.link)
	if (link) object.link = link
	if (raw.kind === "icon") {
		const icon = typeof raw.icon === "string" && ICON_PATTERN.test(raw.icon) ? raw.icon : null
		const emoji = isEmoji(raw.emoji) ? raw.emoji : null
		if (!icon && !emoji) return null // nothing to draw
		if (icon) object.icon = icon
		else object.emoji = emoji
	}
	if (raw.kind === "stroke") {
		object.style.strokeWidth = number(raw.style?.strokeWidth, 4, 1, 80) // a pen can be wider than a border
		const points = sanitizePoints(raw.points)
		if (!points) return null // a stroke with no points cannot be drawn
		object.points = points
		object.ink = STROKE_INKS.has(raw.ink) ? raw.ink : "pen"
	}
	if (raw.kind === "frame")
		object.name = typeof raw.name === "string" ? raw.name.slice(0, 200) : ""
	if (object.shape === "polygon") object.sides = Math.round(number(raw.sides, 5, 3, 12))
	if (typeof raw.groupId === "string" && ID_PATTERN.test(raw.groupId))
		object.groupId = raw.groupId
	if (raw.flipX === true) object.flipX = true
	if (raw.flipY === true) object.flipY = true
	if (raw.kind === "image") {
		if (typeof raw.src !== "string" || !IMAGE_SRC.test(raw.src)) return null
		object.src = raw.src
		object.alt = typeof raw.alt === "string" ? raw.alt.slice(0, 200) : ""
	}
	if (raw.kind === "table") {
		const table = sanitizeTable(raw.table, themeName)
		if (!table) return null
		object.table = table
		object.w = table.colW.reduce((sum, v) => sum + v, 0) // a table is exactly as big as its cells
		object.h = table.rowH.reduce((sum, v) => sum + v, 0)
	}
	return object
}

// The canvas settings, with anything that is not a known value put back to its default.
export function sanitizeCanvas(canvas) {
	const base = createDocument().canvas
	const source = canvas && typeof canvas === "object" ? canvas : {}
	return {
		mode: source.mode === "preset" ? "preset" : "infinite",
		preset: CANVAS_PRESETS[source.preset] ? source.preset : base.preset,
		background: isColor(source.background) ? source.background : null,
		grid: source.grid in GRID_SIZES ? source.grid : "off",
		sketch: source.sketch === true,
		doubleClick: DOUBLE_CLICK.has(source.doubleClick) ? source.doubleClick : "shape",
	}
}

export const sanitizeTheme = (theme) => ({
	preset: THEMES[theme?.preset] ? theme.preset : DEFAULT_THEME,
})

export function parseDocument(input) {
	let raw = input
	if (typeof input === "string") {
		try {
			raw = JSON.parse(input)
		} catch {
			throw new DocumentError("invalid", "The board's content is not valid JSON.")
		}
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new DocumentError("invalid", "The board's content is not a document.")
	}
	const version = raw.schemaVersion
	if (!Number.isInteger(version) || version < 0)
		throw new DocumentError("invalid", "The board has no version.")
	if (version > SCHEMA_VERSION) {
		throw new DocumentError("too_new", "This board was saved by a newer version of Oqiva.")
	}
	const issues = []
	const canvas = raw.canvas && typeof raw.canvas === "object" ? raw.canvas : {}
	const themeName = THEMES[raw.theme?.preset] ? raw.theme.preset : DEFAULT_THEME
	const seen = new Set()
	const objects = []
	for (const [index, item] of (Array.isArray(raw.objects) ? raw.objects : []).entries()) {
		const object = sanitizeObject(item, index, themeName)
		if (!object) {
			issues.push(`dropped object ${index}`)
		} else if (seen.has(object.id)) {
			issues.push(`dropped duplicate id ${object.id}`)
		} else {
			seen.add(object.id)
			objects.push(object)
		}
	}
	objects.sort((a, b) => a.z - b.z)
	const objectIds = new Set(objects.map((object) => object.id))
	const connectorIds = new Set()
	const connectors = []
	for (const [index, item] of (Array.isArray(raw.connectors) ? raw.connectors : []).entries()) {
		const connector = sanitizeConnector(item, index, objectIds)
		if (!connector || connectorIds.has(connector.id) || objectIds.has(connector.id)) {
			issues.push(`dropped connector ${index}`)
		} else {
			connectorIds.add(connector.id)
			connectors.push(connector)
		}
	}
	connectors.sort((a, b) => a.z - b.z)
	const maps = sanitizeMindmaps(raw.mindmaps, new Set([...objectIds, ...connectorIds]))
	issues.push(...maps.issues)
	const taken = new Set([...objectIds, ...connectorIds])
	for (const m of maps.mindmaps) {
		taken.add(m.id)
		for (const n of m.nodes) taken.add(n.id)
		for (const l of m.crosslinks) taken.add(l.id)
	}
	const charts = sanitizeFlowcharts(raw.flowcharts, taken)
	issues.push(...charts.issues)
	const document = {
		...raw,
		schemaVersion: SCHEMA_VERSION,
		canvas: sanitizeCanvas(canvas),
		theme: { preset: themeName },
		objects,
		connectors,
		mindmaps: maps.mindmaps,
		flowcharts: charts.flowcharts,
	}
	return { document, issues }
}

export function serializeDocument(document) {
	return JSON.stringify(document)
}

// What counts toward the board's object limit.
export function countObjects(document) {
	const nodes = (document.mindmaps || []).reduce((sum, map) => sum + (map.nodes?.length || 0), 0)
	const flowNodes = (document.flowcharts || []).reduce(
		(sum, chart) => sum + (chart.nodes?.length || 0),
		0,
	)
	return (document.objects?.length || 0) + (document.connectors?.length || 0) + nodes + flowNodes
}
