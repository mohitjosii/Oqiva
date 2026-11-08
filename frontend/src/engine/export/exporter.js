// Export, start to finish: decide what is drawn, ask the host (the server) whether the person
// may export and to keep a record, draw it once as SVG, and make the file asked for. It talks
// to nothing but the host's ``exports.prepare`` and the browser.

import { measureText } from "../text/measure"
import { downloadBlob, printSvg } from "./files"
import { inlinePictures } from "./pictures"
import { pdfFromPng, rasterize } from "./raster"
import { collectItems, exportArea, exportBackground, fitScale, isEmpty } from "./scene"
import { buildSvg } from "./svg"

const MIME = { png: "image/png", jpeg: "image/jpeg" }

const withSuffix = (filename, suffix) =>
	suffix ? filename.replace(/(\.\w+)?$/, `${suffix}$1`) : filename

// ``notify`` has error(message), warning(message) and success(message).
// Returns {filename, reduced, missing} when done, or null when nothing was made.
export async function exportBoard({
	store,
	host,
	format,
	scope = "board",
	scale = 1,
	notify,
	measure = measureText,
}) {
	const items = collectItems(store, scope)
	if (isEmpty(items)) {
		notify.error(
			scope === "selection"
				? "Select something to export first."
				: "There is nothing on the board to export yet.",
		)
		return null
	}
	const area = exportArea(store, items, scope)
	let prepared
	try {
		prepared = await host.exports.prepare(format, scope)
	} catch (error) {
		notify.error(error?.name === "ApiError" ? error.message : "That could not be exported.")
		return null
	}
	try {
		const { images, missing } = await inlinePictures(items.objects)
		const background = exportBackground(store.canvas.value, format)
		const svg = buildSvg(items, area, { background, measure, images })
		const result = await produce({ svg, format, area, background, scale, prepared })
		if (missing.length)
			notify.warning(
				`${missing.length === 1 ? "A picture" : `${missing.length} pictures`} could not be loaded and shows as a placeholder.`,
			)
		if (result.reduced)
			notify.warning("The board is very large, so it was exported at a smaller size.")
		return { ...result, missing }
	} catch (error) {
		notify.error(error?.message || "That could not be exported.")
		return null
	}
}

async function produce({ svg, format, area, background, scale, prepared }) {
	if (format === "print") {
		printSvg(svg, prepared.filename)
		return { filename: null, reduced: false }
	}
	if (format === "svg") {
		downloadBlob(new Blob([svg], { type: "image/svg+xml" }), prepared.filename)
		return { filename: prepared.filename, reduced: false }
	}
	const wanted = format === "pdf" ? 2 : scale
	const fit = fitScale(area.w, area.h, wanted)
	if (format === "pdf") {
		const png = await rasterize(svg, {
			width: area.w,
			height: area.h,
			scale: fit.scale,
			mime: MIME.png,
			background,
		})
		const pdf = await pdfFromPng(png.blob, { width: area.w, height: area.h })
		downloadBlob(pdf, prepared.filename)
		return { filename: prepared.filename, reduced: fit.reduced }
	}
	const image = await rasterize(svg, {
		width: area.w,
		height: area.h,
		scale: fit.scale,
		mime: MIME[format],
		background,
	})
	const filename = withSuffix(prepared.filename, scale === 2 ? "-2x" : "")
	downloadBlob(image.blob, filename)
	return { filename, reduced: fit.reduced }
}
