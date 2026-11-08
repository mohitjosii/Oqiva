// Draws a scene as a standalone SVG string. This is the same description the editor draws
// from (render/nodes.js), so an export looks like the screen. Pictures are embedded as data
// so the file works anywhere.

import { connectorPath, resolveConnectors } from "../geometry/connectors"
import { connectorNode, el, FONT, objectNode, serializeNode } from "../render/nodes"

// Shown where a picture could not be fetched.
export const MISSING_PICTURE =
	"data:image/svg+xml;utf8," +
	encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#E5E7EB"/><path d="M12 48 L26 30 L36 42 L42 35 L52 48 Z" fill="#9CA3AF"/><circle cx="44" cy="20" r="6" fill="#9CA3AF"/></svg>',
	)

// ``images`` maps a picture's address to the data that replaces it (or null to show the
// placeholder everywhere, as thumbnails do).
function withPictures(object, images) {
	if (object.kind !== "image") return object
	return { ...object, src: (images && images.get(object.src)) || MISSING_PICTURE }
}

export function buildSvg(items, area, { background = null, measure, images = null } = {}) {
	const ctx = { measure, detail: true, hideText: false }
	const resolved = items.connectors.length
		? resolveConnectors(items.connectors, items.byId)
		: new Map()
	const children = []
	if (background)
		children.push(
			el("rect", { x: area.x, y: area.y, width: area.w, height: area.h, fill: background }),
		)
	// Everything is clipped to the area, which is what makes a page export show only the page.
	const clip = "oq-export-area"
	children.push(
		el("clipPath", { id: clip }, [
			el("rect", { x: area.x, y: area.y, width: area.w, height: area.h }),
		]),
	)
	const body = [
		...items.objects.map((object) => objectNode(withPictures(object, images), ctx)),
		...items.connectors
			.filter((connector) => resolved.has(connector.id))
			.map((connector) =>
				connectorNode(connector, connectorPath(connector, resolved.get(connector.id)), {
					...ctx,
					background: background || "#FFFFFF",
				}),
			),
	]
	children.push(el("g", { "clip-path": `url(#${clip})`, "font-family": FONT }, body))
	const root = el(
		"svg",
		{
			xmlns: "http://www.w3.org/2000/svg",
			width: area.w,
			height: area.h,
			viewBox: `${area.x} ${area.y} ${area.w} ${area.h}`,
		},
		children,
	)
	return serializeNode(root)
}
