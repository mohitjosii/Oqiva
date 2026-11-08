// Fetches the pictures a scene uses and turns them into data, so an exported SVG carries them.

const toDataUrl = (blob) =>
	new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result)
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(blob)
	})

// Returns {images: Map(address -> data URL), missing: [address]}. A picture that cannot be
// fetched is listed in ``missing`` and the export carries on with a placeholder for it.
export async function inlinePictures(
	objects,
	fetcher = (url) => fetch(url, { credentials: "same-origin" }),
) {
	const addresses = [
		...new Set(objects.filter((object) => object.kind === "image").map((object) => object.src)),
	]
	const images = new Map()
	const missing = []
	await Promise.all(
		addresses.map(async (address) => {
			try {
				const response = await fetcher(address)
				if (!response.ok) throw new Error(String(response.status))
				const blob = await response.blob()
				if (!blob.type.startsWith("image/")) throw new Error("not a picture")
				images.set(address, await toDataUrl(blob))
			} catch {
				missing.push(address)
			}
		}),
	)
	return { images, missing }
}
