// Pure helpers for the template gallery: filtering the catalogue and turning a template's
// reduced preview into shapes for a small SVG. Nothing here imports the canvas engine.

const FALLBACK_FILL = "#F1F5F9"
const FALLBACK_STROKE = "#94A3B8"
const EMPTY_BOX = { x: 0, y: 0, w: 160, h: 100 }
const ANCHORS = {
	n: [0.5, 0],
	ne: [1, 0],
	e: [1, 0.5],
	se: [1, 1],
	s: [0.5, 1],
	sw: [0, 1],
	w: [0, 0.5],
	nw: [0, 0],
}

const finite = (value, fallback = 0) =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback

// Templates matching a category (null or "" means every category) and a search text, which is
// matched case-insensitively against name, description and tags.
export function filterTemplates(templates, { category = null, query = "" } = {}) {
	const needle = String(query || "")
		.trim()
		.toLowerCase()
	return (templates || []).filter((template) => {
		if (category && template.category !== category) return false
		if (!needle) return true
		const haystack = [template.name, template.description, ...(template.tags || [])]
		return haystack.join(" ").toLowerCase().includes(needle)
	})
}

function anchorPoint(box, anchor) {
	const [fx, fy] = ANCHORS[anchor] || ANCHORS.e
	return { x: box.x + box.w * fx, y: box.y + box.h * fy }
}

function endPoint(end, boxes) {
	if (end && typeof end.objectId === "string") {
		const box = boxes.get(end.objectId)
		return box ? anchorPoint(box, end.anchor) : null
	}
	if (end && Number.isFinite(end.x) && Number.isFinite(end.y)) return { x: end.x, y: end.y }
	return null
}

function shapeKind(object) {
	if (object.kind === "text") return "text"
	if (object.kind !== "shape") return "block" // a picture or a table is drawn as a plain block
	if (object.shape === "ellipse") return "ellipse"
	if (object.shape === "diamond" || object.shape === "triangle") return object.shape
	return "rect"
}

function polygon(kind, box) {
	const { x, y, w, h } = box
	const points =
		kind === "diamond"
			? [
					[x + w / 2, y],
					[x + w, y + h / 2],
					[x + w / 2, y + h],
					[x, y + h / 2],
				]
			: [
					[x + w / 2, y],
					[x + w, y + h],
					[x, y + h],
				]
	return points.map(([px, py]) => `${px},${py}`).join(" ")
}

// A caption size that fits its box, or 0 when it would be too small to read.
export function labelSize(label, box) {
	if (!label) return 0
	const size = Math.min(box.h * 0.3, 18, (box.w * 0.9) / (label.length * 0.55))
	return size >= 5 ? Math.round(size * 10) / 10 : 0
}

// Everything a preview SVG draws: the viewBox, boxes in drawing order and straight lines.
// Positions are in canvas units, so the SVG scales them. Lines whose end is attached to an
// object that is not in the preview are left out.
export function previewGeometry(preview, { padding = 0.06 } = {}) {
	const objects = (preview?.objects || []).filter((o) => o && finite(o.w) > 0 && finite(o.h) > 0)
	const boxes = new Map()
	for (const o of objects) {
		boxes.set(o.id, { x: finite(o.x), y: finite(o.y), w: finite(o.w), h: finite(o.h) })
	}
	const lines = []
	for (const connector of preview?.connectors || []) {
		const from = endPoint(connector?.from, boxes)
		const to = endPoint(connector?.to, boxes)
		if (from && to) lines.push({ id: connector.id, x1: from.x, y1: from.y, x2: to.x, y2: to.y })
	}
	const xs = []
	const ys = []
	for (const box of boxes.values()) {
		xs.push(box.x, box.x + box.w)
		ys.push(box.y, box.y + box.h)
	}
	for (const line of lines) {
		xs.push(line.x1, line.x2)
		ys.push(line.y1, line.y2)
	}
	const empty = !boxes.size && !lines.length
	const minX = empty ? EMPTY_BOX.x : Math.min(...xs)
	const minY = empty ? EMPTY_BOX.y : Math.min(...ys)
	const width = empty ? EMPTY_BOX.w : Math.max(1, Math.max(...xs) - minX)
	const height = empty ? EMPTY_BOX.h : Math.max(1, Math.max(...ys) - minY)
	const pad = Math.max(width, height) * padding
	const shapes = objects.map((o) => {
		const box = boxes.get(o.id)
		const kind = shapeKind(o)
		return {
			id: o.id,
			kind,
			...box,
			points: kind === "diamond" || kind === "triangle" ? polygon(kind, box) : null,
			fill: kind === "text" ? "none" : o.style?.fill || FALLBACK_FILL,
			stroke: kind === "text" ? "none" : o.style?.stroke || FALLBACK_STROKE,
			label: o.label || "",
			labelSize: labelSize(o.label, box),
		}
	})
	return {
		empty,
		viewBox: [minX - pad, minY - pad, width + pad * 2, height + pad * 2].join(" "),
		shapes,
		lines,
	}
}
