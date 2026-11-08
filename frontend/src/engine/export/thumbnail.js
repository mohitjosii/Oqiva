// The board's thumbnail for the home screen. It is drawn from the same SVG as an export, and
// sent to the host at most once every 30 seconds; if anything goes wrong the tile simply keeps
// showing its placeholder.

import { measureText } from "../text/measure"
import { rasterize } from "./raster"
import { collectItems, exportArea, exportBackground, fitScale, isEmpty } from "./scene"
import { buildSvg } from "./svg"

export const THUMBNAIL_INTERVAL_MS = 30_000
export const THUMBNAIL_SIDE = 480
export const THUMBNAIL_MAX_BYTES = 256 * 1024 // the server refuses anything larger

// A small PNG of the whole board, or null for an empty board or when it cannot be drawn.
export async function renderThumbnail(store, measure = measureText) {
	const items = collectItems(store, "board")
	if (isEmpty(items)) return null
	const area = exportArea(store, items, "board")
	const svg = buildSvg(items, area, {
		background: exportBackground(store.canvas.value, "thumbnail"),
		measure,
		images: null,
	})
	for (const side of [THUMBNAIL_SIDE, THUMBNAIL_SIDE / 2]) {
		const scale = Math.min(2, side / Math.max(area.w, area.h))
		const { blob } = await rasterize(svg, {
			width: area.w,
			height: area.h,
			scale: fitScale(area.w, area.h, scale).scale,
		})
		if (blob.size <= THUMBNAIL_MAX_BYTES) return blob
	}
	return null
}

// Decides when to send. ``request()`` says the board has changed; the thumbnail goes out now if
// the last one was long enough ago, otherwise when the interval is up.
export function createThumbnailer({
	render,
	save,
	interval = THUMBNAIL_INTERVAL_MS,
	settle = 2000,
	now = Date.now,
	schedule = setTimeout,
	cancel = clearTimeout,
}) {
	let last = -Infinity
	let timer = null
	let running = false
	let pending = false
	let disposed = false

	async function run() {
		timer = null
		if (disposed || running) return
		running = true
		pending = false
		last = now() // counted from the attempt, so a failing render cannot be retried in a tight loop
		try {
			const blob = await render()
			if (blob && !disposed) await save(blob)
		} catch {
			// the placeholder stays; the next change tries again
		} finally {
			running = false
			if (pending && !disposed) request()
		}
	}

	function request() {
		if (disposed) return
		pending = true
		if (running || timer !== null) return
		// Wait for edits to settle, and never send more often than the interval.
		const wait = Math.max(settle, last + interval - now())
		timer = schedule(run, wait)
	}

	return {
		request,
		dispose() {
			disposed = true
			if (timer !== null) cancel(timer)
			timer = null
		},
		get pending() {
			return pending
		},
	}
}
