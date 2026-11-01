import { ref } from "vue"
import { api } from "@/data/api"
import { toApiError } from "@/utils/errors"

// A paged board list. ``getParams`` is read on every load so it can follow the route.
// A newer load replaces an older one, so a slow response cannot overwrite a fresher list.
export function useBoardList(getParams) {
	const boards = ref([])
	const hasMore = ref(false)
	const loading = ref(false)
	const error = ref(null)
	let latest = 0

	async function load({ append = false } = {}) {
		const ticket = ++latest
		loading.value = true
		error.value = null
		try {
			const start = append ? boards.value.length : 0
			const result = await api("board.list_boards", { ...getParams(), start })
			if (ticket !== latest) return
			boards.value = append ? [...boards.value, ...result.boards] : result.boards
			hasMore.value = result.has_more
		} catch (caught) {
			if (ticket === latest) error.value = toApiError(caught)
		} finally {
			if (ticket === latest) loading.value = false
		}
	}

	return { boards, hasMore, loading, error, load, loadMore: () => load({ append: true }) }
}
