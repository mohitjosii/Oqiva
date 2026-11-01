import { call } from "frappe-ui"
import { toApiError } from "@/utils/errors"

// Every call goes to oqiva.api.<method>. Failures come back as ApiError.
export async function api(method, params = {}) {
	try {
		return await call(`oqiva.api.${method}`, params)
	} catch (error) {
		throw toApiError(error)
	}
}
