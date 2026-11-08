// The outline of every connector, worked out from the current objects. A path is reused while
// its connector and its two ends have not changed, so moving one shape redraws only the
// connectors attached to it.

import { computed } from "vue"
import { connectorPath, resolveConnectors } from "../geometry/connectors"

export function createConnectorPaths(store) {
	const cache = new Map()
	return computed(() => {
		const objects = store.objects.value
		const connectors = store.connectors.value
		const byId = new Map(objects.map((object) => [object.id, object]))
		const resolved = resolveConnectors(connectors, byId)
		const paths = new Map()
		const alive = new Set()
		for (const connector of connectors) {
			const r = resolved.get(connector.id)
			if (!r) continue
			alive.add(connector.id)
			const key = `${r.p0.x},${r.p0.y},${r.p1.x},${r.p1.y},${r.d0.x},${r.d0.y},${r.d1.x},${r.d1.y}`
			const hit = cache.get(connector.id)
			if (hit && hit.connector === connector && hit.key === key) {
				paths.set(connector.id, hit.path)
			} else {
				const path = connectorPath(connector, r)
				cache.set(connector.id, { connector, key, path })
				paths.set(connector.id, path)
			}
		}
		for (const id of cache.keys()) if (!alive.has(id)) cache.delete(id)
		return paths
	})
}
