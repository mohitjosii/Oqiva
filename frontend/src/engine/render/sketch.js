// Hand-drawn rendering of shapes (the "sketch" style). roughjs makes wobbly outlines from a seed,
// so a shape is drawn the same way every time and on every screen: the seed comes from the object's
// id, never from chance. Only outlines and fills change; text, notes, tables and pictures do not.

import rough from "roughjs/bundled/rough.esm.js"

const el = (tag, attrs) => ({ tag, attrs, children: [] }) // the same plain description nodes.js uses
const generator = rough.generator()
const cache = new Map()

// A stable whole number from an id (the seed must not change between draws).
export function seedOf(id) {
	let hash = 2166136261
	for (let i = 0; i < String(id).length; i++) {
		hash ^= String(id).charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return (hash >>> 0) % 2147483647 || 1
}

// ``what``: {kind: "rect"|"ellipse"|"path", w, h, d?}. ``paint``: {fill, stroke, width, dash}.
export function sketchNodes(id, what, paint) {
	const key = `${id}|${what.kind}|${what.w}|${what.h}|${what.d || ""}|${paint.fill}|${paint.stroke}|${paint.width}|${paint.dash || ""}`
	let paths = cache.get(key)
	if (!paths) {
		const options = {
			seed: seedOf(id),
			roughness: 1.1,
			bowing: 1,
			stroke: paint.stroke || "none",
			strokeWidth: paint.width,
			fill: paint.fill || undefined,
			fillStyle: "solid",
			...(paint.dash ? { strokeLineDash: paint.dash.split(" ").map(Number) } : {}),
		}
		const drawable =
			what.kind === "ellipse"
				? generator.ellipse(what.w / 2, what.h / 2, what.w, what.h, options)
				: what.kind === "rect"
					? generator.rectangle(0, 0, what.w, what.h, options)
					: generator.path(what.d, options)
		paths = generator.toPaths(drawable)
		if (cache.size > 3000) cache.clear()
		cache.set(key, paths)
	}
	return paths.map((p) =>
		el("path", {
			d: p.d,
			fill: p.fill || "none",
			stroke: p.stroke || "none",
			"stroke-width": p.strokeWidth,
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
			...(paint.dash && p.stroke !== "none" ? { "stroke-dasharray": paint.dash } : {}),
		}),
	)
}
