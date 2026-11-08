// Adding a picture: check it, measure it, hand it to the host to upload, then put an image
// object on the board. The engine never talks to the server itself; the host's ``images.upload``
// does (and returns the file's URL, which is all the document stores).

import { toBoard } from "../geometry/viewport"
import { createImage } from "../model/factories"

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
const mb = (bytes) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`

// The picture's own size in pixels.
export async function naturalSize(file) {
	if (typeof createImageBitmap === "function") {
		const bitmap = await createImageBitmap(file)
		const size = { w: bitmap.width, h: bitmap.height }
		bitmap.close?.()
		return size
	}
	const url = URL.createObjectURL(file)
	try {
		return await new Promise((resolve, reject) => {
			const image = new Image()
			image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight })
			image.onerror = () => reject(new Error("unreadable"))
			image.src = url
		})
	} finally {
		URL.revokeObjectURL(url)
	}
}

// The middle of what is on screen, in board units.
export const viewCentre = (store) =>
	toBoard(store.state.viewport, { x: store.state.size.width / 2, y: store.state.size.height / 2 })

// Returns the new object, or null when the picture was refused or failed (``notify`` says why).
export async function insertImage(store, host, file, { center, notify = () => {} } = {}) {
	if (store.state.readonly || !host.images) return null
	if (!IMAGE_TYPES.includes(file.type)) {
		notify("Only PNG, JPEG, GIF and WebP pictures can be added.")
		return null
	}
	const limit = host.limits?.upload_max_bytes
	if (limit && file.size > limit) {
		notify(`That picture is larger than ${mb(limit)}.`)
		return null
	}
	store.state.uploads++
	try {
		const size = await naturalSize(file)
		if (!size.w || !size.h) throw new Error("empty")
		const { src } = await host.images.upload(file)
		const image = createImage({
			src,
			alt: file.name.replace(/\.[^.]+$/, "").slice(0, 200),
			size,
			center: center || viewCentre(store),
			z: store.nextZ(),
		})
		if (!store.addItems({ objects: [image] }, { label: "Add picture" })) return null
		return image
	} catch (error) {
		notify(
			error?.message && error.name === "ApiError"
				? error.message
				: "That picture could not be added.",
		)
		return null
	} finally {
		store.state.uploads--
	}
}
