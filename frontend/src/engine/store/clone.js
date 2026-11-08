// Copies a selection with fresh ids, for duplicate, copy and paste. A connector comes along
// if both its ends are attached to copied objects, or if it was selected itself; an end
// attached to something that is not copied is let go, staying where it was.

import { newId } from "../model/ids"
import { resolveConnectors, isAttached } from "../geometry/connectors"

const deep = (value) => JSON.parse(JSON.stringify(value))

export function cloneSelection(objects, connectors, ids, offset = 10) {
	const chosen = new Set(ids)
	const sources = objects.filter((object) => chosen.has(object.id))
	const sourceIds = new Set(sources.map((object) => object.id))
	const byId = new Map(objects.map((object) => [object.id, object]))
	const resolved = resolveConnectors(connectors, byId)
	const included = connectors.filter((connector) => {
		if (chosen.has(connector.id)) return true
		return (
			isAttached(connector.from) &&
			isAttached(connector.to) &&
			sourceIds.has(connector.from.objectId) &&
			sourceIds.has(connector.to.objectId)
		)
	})
	const idMap = new Map(sources.map((object) => [object.id, newId()]))
	// A copied group is a new group; a copy of just one member belongs to no group.
	const members = new Map()
	for (const object of sources)
		if (object.groupId) members.set(object.groupId, (members.get(object.groupId) || 0) + 1)
	const groupMap = new Map(
		[...members].filter(([, count]) => count > 1).map(([group]) => [group, newId()]),
	)
	let z = Math.max(0, ...objects.map((object) => object.z)) + 1
	const copiedObjects = sources.map((object) => {
		const copy = {
			...deep(object),
			id: idMap.get(object.id),
			x: object.x + offset,
			y: object.y + offset,
			z: z++,
		}
		if (copy.groupId) {
			if (groupMap.has(copy.groupId)) copy.groupId = groupMap.get(copy.groupId)
			else delete copy.groupId
		}
		return copy
	})
	let zc = Math.max(0, ...connectors.map((connector) => connector.z)) + 1
	const copiedConnectors = included.map((connector) => {
		const end = (side) => {
			const spec = connector[side]
			if (isAttached(spec) && idMap.has(spec.objectId))
				return { objectId: idMap.get(spec.objectId), anchor: spec.anchor }
			const point = resolved.get(connector.id)?.[side === "from" ? "p0" : "p1"] || spec
			return { x: point.x + offset, y: point.y + offset }
		}
		return { ...deep(connector), id: newId(), from: end("from"), to: end("to"), z: zc++ }
	})
	return { objects: copiedObjects, connectors: copiedConnectors }
}
