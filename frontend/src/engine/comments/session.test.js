import { describe, expect, it, vi } from "vitest"
import { createDocument } from "../model/schema"
import { createStore } from "../store/createStore"
import { createComments } from "./session"

function setup(over = {}) {
	const store = createStore(createDocument())
	const calls = []
	let threads = [{ name: "t1" }]
	const port = {
		list: vi.fn(async () => threads),
		people: vi.fn(async () => [{ user: "a" }]),
		add: vi.fn(async (payload) => {
			calls.push(["add", payload])
			threads = [...threads, { name: "t2" }]
			return { name: "t2" }
		}),
		reply: vi.fn(async (name, content) => calls.push(["reply", name, content])),
		edit: vi.fn(async (name, content) => calls.push(["edit", name, content])),
		remove: vi.fn(async (name) => calls.push(["remove", name])),
		resolve: vi.fn(async (name, value) => calls.push(["resolve", name, value])),
		...over,
	}
	const errors = []
	const timers = []
	const comments = createComments({
		store,
		port,
		notify: { error: (m) => errors.push(m) },
		schedule: (fn) => timers.push(fn) && timers.length,
		cancel: (id) => (timers[id - 1] = () => {}),
	})
	return { store, port, comments, calls, errors, timers }
}

describe("comment threads in the store", () => {
	it("loads the threads", async () => {
		const { store, comments } = setup()
		await comments.refresh()
		expect(store.state.comments).toEqual([{ name: "t1" }])
	})

	it("many change notices cause one fetch", async () => {
		const { port, comments, timers } = setup()
		for (let i = 0; i < 10; i++) comments.scheduleRefresh()
		timers.forEach((fn) => fn())
		await Promise.resolve()
		expect(port.list).toHaveBeenCalledTimes(1)
	})

	it("keeps the old list when fetching fails", async () => {
		const { store, port, comments } = setup()
		await comments.refresh()
		port.list.mockRejectedValueOnce(new Error("offline"))
		await comments.refresh()
		expect(store.state.comments).toEqual([{ name: "t1" }])
	})

	it("adding writes the draft, clears it, shows the new thread and opens it", async () => {
		const { store, comments, calls } = setup()
		store.state.commentDraft = { anchor_type: "shape", shape_id: "s" }
		expect(await comments.add("Hello")).toBe(true)
		expect(calls).toEqual([["add", { anchor_type: "shape", shape_id: "s", content: "Hello" }]])
		expect(store.state.commentDraft).toBeNull()
		expect(store.state.openThread).toBe("t2")
		expect(store.state.comments.map((t) => t.name)).toEqual(["t1", "t2"])
	})

	it("a draft that fails to save is kept so nothing typed is lost, and the reason is shown", async () => {
		const { store, comments, errors } = setup({
			add: vi.fn(async () =>
				Promise.reject(new Error("A comment can be up to 5000 characters.")),
			),
		})
		store.state.commentDraft = { anchor_type: "point", x: 1, y: 2 }
		expect(await comments.add("x")).toBe(false)
		expect(store.state.commentDraft).not.toBeNull()
		expect(errors).toEqual(["A comment can be up to 5000 characters."])
	})

	it("adding with no draft does nothing", async () => {
		const { port, comments } = setup()
		expect(await comments.add("x")).toBe(false)
		expect(port.add).not.toHaveBeenCalled()
	})

	it("reply, edit, resolve and delete go to the server and refresh the list", async () => {
		const { port, comments, calls } = setup()
		await comments.reply({ name: "t1" }, "yes")
		await comments.edit({ name: "c1" }, "better")
		await comments.resolve({ name: "t1" }, true)
		await comments.remove({ name: "c1" })
		expect(calls).toEqual([
			["reply", "t1", "yes"],
			["edit", "c1", "better"],
			["resolve", "t1", true],
			["remove", "c1"],
		])
		expect(port.list).toHaveBeenCalledTimes(4)
	})

	it("deleting the open thread closes it", async () => {
		const { store, comments } = setup()
		store.state.openThread = "t1"
		await comments.remove({ name: "t1" })
		expect(store.state.openThread).toBeNull()
	})

	it("says why when something fails", async () => {
		const { comments, errors } = setup({
			resolve: vi.fn(async () =>
				Promise.reject(new Error("You don't have permission to do that.")),
			),
		})
		expect(await comments.resolve({ name: "t1" }, true)).toBe(false)
		expect(errors).toEqual(["You don't have permission to do that."])
	})

	it("stops after being disposed", async () => {
		const { port, comments } = setup()
		comments.dispose()
		await comments.refresh()
		comments.scheduleRefresh()
		expect(port.list).not.toHaveBeenCalled()
	})
})
