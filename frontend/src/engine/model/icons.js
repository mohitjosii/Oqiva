// The icons and emoji that can be placed on a board. Icons are drawn from a fixed set (so a
// document can only ever ask for a name, never for markup); emoji are plain characters.

import { ICON_DATA } from "./iconData"
import { EMOJI } from "./emoji"

export const ICON_NAMES = Object.keys(ICON_DATA)
export const iconData = (name) => ICON_DATA[name] || null
export const ICON_PATTERN = /^[a-z0-9-]{1,40}$/

export function searchIcons(query) {
	const needle = String(query || "")
		.trim()
		.toLowerCase()
	const all = ICON_NAMES.map((name) => ({ name, ...ICON_DATA[name] }))
	if (!needle) return all
	return all
		.map((icon) => {
			const words = icon.tags.split(" ")
			const rank = icon.name.startsWith(needle)
				? 0
				: icon.name.includes(needle)
					? 1
					: words.some((w) => w.startsWith(needle))
						? 2
						: icon.tags.includes(needle)
							? 3
							: null
			return rank === null ? null : { icon, rank }
		})
		.filter(Boolean)
		.sort((a, b) => a.rank - b.rank)
		.map((entry) => entry.icon)
}

export function searchEmoji(query) {
	const needle = String(query || "")
		.trim()
		.toLowerCase()
	if (!needle) return EMOJI
	return EMOJI.filter((e) => e.name.includes(needle))
}

// A character that may be stored as an emoji object: short, printable, no markup.
export function isEmoji(value) {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 16 &&
		// eslint-disable-next-line no-control-regex
		!/[\u0000-\u001f<>&"']/.test(value)
	)
}
