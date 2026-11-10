// Keeps the board's comment threads in the store and does what the panel asks. The engine never
// calls the server: the page gives it ``port`` (list, people, add, reply, edit, remove, resolve).

export function createComments({
	store,
	port,
	notify,
	delay = 150,
	schedule = setTimeout,
	cancel = clearTimeout,
}) {
	let timer = null
	let disposed = false

	async function refresh() {
		timer = null
		if (disposed) return
		try {
			store.state.comments = await port.list()
		} catch {
			// the list stays as it was; the next change tries again
		}
	}

	// Many changes arriving together cause one fetch.
	const scheduleRefresh = () => {
		if (disposed) return
		if (timer !== null) cancel(timer)
		timer = schedule(refresh, delay)
	}

	async function run(work) {
		try {
			const result = await work()
			await refresh()
			return result ?? true
		} catch (error) {
			notify.error(error?.message || "That could not be done.")
			return false
		}
	}

	return {
		refresh,
		scheduleRefresh,
		people: () => port.people(),
		// Writes the comment that was being drafted, and opens its thread.
		async add(content) {
			const draft = store.state.commentDraft
			if (!draft) return false
			const made = await run(() => port.add({ ...draft, content }))
			if (!made) return false
			store.state.commentDraft = null
			if (made.name) store.state.openThread = made.name
			return true
		},
		reply: (thread, content) => run(() => port.reply(thread.name, content)),
		edit: (comment, content) => run(() => port.edit(comment.name, content)),
		async remove(comment) {
			const done = await run(() => port.remove(comment.name))
			if (done && store.state.openThread === comment.name) store.state.openThread = null
			return done
		},
		resolve: (thread, resolved) => run(() => port.resolve(thread.name, resolved)),
		dispose() {
			disposed = true
			if (timer !== null) cancel(timer)
		},
	}
}
