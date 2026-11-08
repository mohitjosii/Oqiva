import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createStore } from "../store/createStore"
import { createDocument } from "../model/schema"
import { IMAGE_TYPES, insertImage, viewCentre } from "./images"

const file = (name = "cat.png", type = "image/png", size = 1000) => {
	const f = new File([new Uint8Array(8)], name, { type })
	Object.defineProperty(f, "size", { value: size })
	return f
}
let store
let messages
const notify = (m) => messages.push(m)
const host = (over = {}) => ({
	limits: { upload_max_bytes: 5 * 1024 * 1024 },
	images: { upload: vi.fn(async () => ({ src: "/private/files/abc.png" })) },
	...over,
})

beforeEach(() => {
	store = createStore(createDocument())
	store.state.size = { width: 1000, height: 600 }
	messages = []
	vi.stubGlobal("createImageBitmap", async () => ({ width: 800, height: 400, close() {} }))
})
afterEach(() => vi.unstubAllGlobals())

describe("adding a picture", () => {
	it("uploads it, then puts an image object at the middle of the view, scaled to fit", async () => {
		const h = host()
		const image = await insertImage(store, h, file(), { notify })
		expect(h.images.upload).toHaveBeenCalledTimes(1)
		expect(image.kind).toBe("image")
		expect(image.src).toBe("/private/files/abc.png")
		expect(image.alt).toBe("cat")
		expect([image.w, image.h]).toEqual([480, 240]) // 800x400 shrunk to a 480 longest side
		const centre = viewCentre(store)
		expect([image.x + image.w / 2, image.y + image.h / 2]).toEqual([centre.x, centre.y])
		expect(store.objects.value).toHaveLength(1)
		expect(store.state.selection).toEqual([image.id])
		expect(store.history.undoStack).toHaveLength(1)
		expect(store.state.uploads).toBe(0)
	})

	it("drops it where it was let go", async () => {
		const image = await insertImage(store, host(), file(), {
			center: { x: 500, y: 300 },
			notify,
		})
		expect([image.x + image.w / 2, image.y + image.h / 2]).toEqual([500, 300])
	})

	it("does not enlarge a small picture", async () => {
		vi.stubGlobal("createImageBitmap", async () => ({ width: 100, height: 50, close() {} }))
		const image = await insertImage(store, host(), file(), { notify })
		expect([image.w, image.h]).toEqual([100, 50])
	})

	it("refuses other file types without uploading anything", async () => {
		const h = host()
		for (const type of ["image/svg+xml", "text/html", "application/pdf", ""]) {
			expect(await insertImage(store, h, file("x", type), { notify })).toBeNull()
		}
		expect(h.images.upload).not.toHaveBeenCalled()
		expect(messages[0]).toMatch(/PNG, JPEG, GIF and WebP/)
		expect(IMAGE_TYPES).not.toContain("image/svg+xml")
	})

	it("refuses a picture over the upload limit and says how big the limit is", async () => {
		const h = host()
		expect(
			await insertImage(store, h, file("big.png", "image/png", 6 * 1024 * 1024), { notify }),
		).toBeNull()
		expect(messages[0]).toMatch(/5 MB/)
		expect(h.images.upload).not.toHaveBeenCalled()
	})

	it("says so when the server turns it down, and leaves the board alone", async () => {
		const error = Object.assign(new Error("This workspace has run out of storage."), {
			name: "ApiError",
		})
		const h = host({ images: { upload: vi.fn(async () => Promise.reject(error)) } })
		expect(await insertImage(store, h, file(), { notify })).toBeNull()
		expect(messages).toEqual(["This workspace has run out of storage."])
		expect(store.objects.value).toHaveLength(0)
		expect(store.state.uploads).toBe(0)
	})

	it("gives a plain message when something unexpected goes wrong", async () => {
		const h = host({
			images: { upload: vi.fn(async () => Promise.reject(new TypeError("boom"))) },
		})
		await insertImage(store, h, file(), { notify })
		expect(messages).toEqual(["That picture could not be added."])
	})

	it("says so when the browser cannot read the picture", async () => {
		vi.stubGlobal("createImageBitmap", async () => Promise.reject(new Error("bad image")))
		const h = host()
		expect(await insertImage(store, h, file(), { notify })).toBeNull()
		expect(h.images.upload).not.toHaveBeenCalled()
		expect(messages).toHaveLength(1)
	})

	it("does nothing for a viewer, or when the host offers no uploads", async () => {
		store.setReadonly(true)
		expect(await insertImage(store, host(), file(), { notify })).toBeNull()
		store.setReadonly(false)
		expect(await insertImage(store, { limits: {} }, file(), { notify })).toBeNull()
		expect(messages).toEqual([])
	})

	it("counts pictures in flight", async () => {
		let release
		const h = host({
			images: {
				upload: () =>
					new Promise(
						(resolve) => (release = () => resolve({ src: "/private/files/a.png" })),
					),
			},
		})
		const pending = insertImage(store, h, file(), { notify })
		await vi.waitFor(() => expect(release).toBeTypeOf("function")) // the upload has started
		expect(store.state.uploads).toBe(1)
		release()
		await pending
		expect(store.state.uploads).toBe(0)
	})

	it("keeps a long file name to 200 characters", async () => {
		const image = await insertImage(store, host(), file("n".repeat(300) + ".png"), { notify })
		expect(image.alt).toHaveLength(200)
	})
})
