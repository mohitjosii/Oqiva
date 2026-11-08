// Turns an SVG string into a PNG or JPEG in the browser, and into a PDF page.

const loadImage = (url) =>
	new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error("The picture could not be drawn."))
		image.src = url
	})

// ``width`` and ``height`` are the SVG's own size; the result is ``scale`` times that.
export async function rasterize(
	svg,
	{ width, height, scale = 1, mime = "image/png", background = null, quality = 0.92 },
) {
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }))
	try {
		const image = await loadImage(url)
		const canvas = document.createElement("canvas")
		canvas.width = Math.max(1, Math.round(width * scale))
		canvas.height = Math.max(1, Math.round(height * scale))
		const context = canvas.getContext("2d")
		if (background) {
			context.fillStyle = background
			context.fillRect(0, 0, canvas.width, canvas.height)
		}
		context.drawImage(image, 0, 0, canvas.width, canvas.height)
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
		if (!blob) throw new Error("The picture could not be made.")
		return { blob, width: canvas.width, height: canvas.height }
	} finally {
		URL.revokeObjectURL(url)
	}
}

const POINTS_PER_PIXEL = 0.75 // a CSS pixel is 1/96 inch and a PDF point 1/72
const PDF_MAX_POINTS = 14400 // the largest page PDF readers accept

// One page the size of the picture, holding it. jsPDF is loaded only when a PDF is asked for.
export async function pdfFromPng(blob, { width, height }) {
	const { jsPDF } = await import("jspdf")
	let w = width * POINTS_PER_PIXEL
	let h = height * POINTS_PER_PIXEL
	const shrink = Math.min(1, PDF_MAX_POINTS / Math.max(w, h))
	w *= shrink
	h *= shrink
	const data = await new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result)
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(blob)
	})
	const pdf = new jsPDF({
		orientation: w >= h ? "landscape" : "portrait",
		unit: "pt",
		format: [w, h],
		compress: true,
	})
	pdf.addImage(data, "PNG", 0, 0, w, h)
	return pdf.output("blob")
}
