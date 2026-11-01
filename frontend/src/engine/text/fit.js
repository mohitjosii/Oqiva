// How tall an object must be for its text, and how that changes the object.

import { heightForText, textArea } from "../model/shapes"
import { layoutText } from "./layout"

export const MIN_TEXT_BOX_HEIGHT = 24

export function layoutFor(object, measure, text = object.text) {
	if (!text) return null
	return layoutText(text, { width: textArea(object).w, measure })
}

// The height an object should have, or null to leave it alone. A shape only ever grows to
// hold its text (it never shrinks below what the user drew). A text box follows its text.
export function autoHeight(object, measure, text = object.text) {
	const layout = layoutFor(object, measure, text)
	if (!layout) return null
	const needed = Math.ceil(heightForText(object, layout.height))
	if (object.kind === "text")
		return Math.max(MIN_TEXT_BOX_HEIGHT, needed) === object.h
			? null
			: Math.max(MIN_TEXT_BOX_HEIGHT, needed)
	return needed > object.h ? needed : null
}
