// The board document (ARCHITECTURE section 15.2): one JSON value holding everything on a
// board. Documents come from other people and from older versions of the app, so
// parseDocument never trusts its input: it migrates, clamps, and drops what cannot be drawn.

import { DEFAULT_THEME, THEMES, isColor } from "./themes"
import { ID_PATTERN } from "./ids"

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
export const KNOWN_KINDS = new Set(["shape", "text"])
export const SHAPE_NAMES = new Set([
	"rectangle",
	"ellipse",
	"triangle",
	"diamond",
	"polygon",
	"arrow",
])
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
		canvas: { mode: "infinite", preset: "16:9", background: null, grid: "off" },
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

function sanitizeStyle(style = {}) {
	const source = style && typeof style === "object" ? style : {}
	return {
		fill: source.fill === null ? null : isColor(source.fill) ? source.fill : null,
		stroke: source.stroke === null ? null : isColor(source.stroke) ? source.stroke : "#475569",
		strokeWidth: number(source.strokeWidth, 2, 0, 20),
		dash: DASHES.has(source.dash) ? source.dash : "solid",
		opacity: number(source.opacity, 1, 0, 1),
		radius: number(source.radius, 0, 0, 200),
	}
}

export function sanitizeObject(raw, index, themeName) {
	if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !ID_PATTERN.test(raw.id))
		return null
	if (typeof raw.kind !== "string" || !KNOWN_KINDS.has(raw.kind)) return { ...raw } // kept for newer versions
	const isText = raw.kind === "text"
	const object = {
		id: raw.id,
		kind: raw.kind,
		shape: isText ? "rectangle" : SHAPE_NAMES.has(raw.shape) ? raw.shape : "rectangle",
		x: number(raw.x, 0, -LIMITS.coordinate, LIMITS.coordinate),
		y: number(raw.y, 0, -LIMITS.coordinate, LIMITS.coordinate),
		w: number(raw.w, 100, 1, LIMITS.maxSize),
		h: number(raw.h, 60, 1, LIMITS.maxSize),
		rotation: normalizeRotation(number(raw.rotation, 0, -1e6, 1e6)),
		z: number(raw.z, index, -1e9, 1e9),
		style: sanitizeStyle(raw.style),
		text: sanitizeText(raw.text, themeName),
	}
	if (object.shape === "polygon") object.sides = Math.round(number(raw.sides, 5, 3, 12))
	return object
}

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
	const base = createDocument()
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
	const document = {
		...raw,
		schemaVersion: SCHEMA_VERSION,
		canvas: {
			mode: canvas.mode === "preset" ? "preset" : "infinite",
			preset: CANVAS_PRESETS[canvas.preset] ? canvas.preset : base.canvas.preset,
			background: isColor(canvas.background) ? canvas.background : null,
			grid: canvas.grid in GRID_SIZES ? canvas.grid : "off",
		},
		theme: { preset: themeName },
		objects,
		connectors: Array.isArray(raw.connectors) ? raw.connectors : [],
		mindmaps: Array.isArray(raw.mindmaps) ? raw.mindmaps : [],
		flowcharts: Array.isArray(raw.flowcharts) ? raw.flowcharts : [],
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
