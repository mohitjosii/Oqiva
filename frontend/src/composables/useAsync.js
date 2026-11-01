import { ref } from "vue"
import { toApiError } from "@/utils/errors"

// Runs an async loader and tracks its state. A newer run replaces an older one, so a
// slow response for a view the user already left cannot overwrite the current data.
export function useAsync(loader, initial = null) {
	const data = ref(initial)
	const loading = ref(false)
	const error = ref(null)
	let latest = 0

	async function run(...args) {
		const ticket = ++latest
		loading.value = true
		error.value = null
		try {
			const result = await loader(...args)
			if (ticket === latest) data.value = result
			return result
		} catch (caught) {
			if (ticket === latest) error.value = toApiError(caught)
			return undefined
		} finally {
			if (ticket === latest) loading.value = false
		}
	}

	return { data, loading, error, run }
}
