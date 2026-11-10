// The keyboard and button commands of a mind map. They act on the selected node(s): the pure tree
// functions decide what changes, storeOps.js turns it into one undoable step, and the node that
// should be selected (and edited) next is chosen here.

import { applyChange, clearMap, createNewMap, removeMap } from "./storeOps"
import * as tree from "./tree"

// True when what is selected is only mind map nodes, so the mind map owns Tab, Enter and the arrows.
export function nodesOwnKeys(store) {
	const ids = store.state.selection
	return ids.length > 0 && store.selectedNodes().length === ids.length
}

const only = (store) => {
	const nodes = store.selectedNodes()
	return nodes.length === 1 ? nodes[0] : null
}

function edit(store, id, { fresh = false } = {}) {
	store.state.editingNodeNew = fresh
	store.state.editingNodeId = id
}

// What to select after nodes are removed: the parent of the first removed node that survives.
function survivorAfter(nodes, removedIds) {
	const gone = new Set(removedIds)
	const first = nodes.find((n) => gone.has(n.id) && n.parentId && !gone.has(n.parentId))
	return first ? first.parentId : null
}

// ``host``: {layout(mapId) -> the layout, ask(message) -> Promise<boolean>, viewCenter() -> {x, y}}.
export async function runMindmapCommand(store, command, host = {}) {
	const { state } = store
	if (state.readonly && command.name !== "mm.nav") return false
	const node = only(store)
	const nodesOf = (mapId) => store.nodesOfMap(mapId)

	switch (command.name) {
		case "mm.new": {
			const made = createNewMap(
				store,
				command.origin || host.viewCenter?.() || { x: 0, y: 0 },
			)
			if (made) edit(store, made.root.id)
			return Boolean(made)
		}
		case "mm.child": {
			if (!node) return false
			const change = tree.addChild(nodesOf(node.mapId), node.id, "")
			const ok = applyChange(store, node.mapId, change, {
				label: "Add node",
				select: (c) => c.add[0].id,
				selectUndo: [node.id],
			})
			if (ok && !command.noEdit) edit(store, change.add[0].id, { fresh: true })
			return ok
		}
		case "mm.sibling": {
			if (!node) return false
			const nodes = nodesOf(node.mapId)
			const change = node.parentId
				? tree.addSibling(nodes, node.id, "")
				: tree.addChild(nodes, node.id, "") // the root has no sibling, so a child
			const ok = applyChange(store, node.mapId, change, {
				label: "Add node",
				select: (c) => c.add[0].id,
				selectUndo: [node.id],
			})
			if (ok && !command.noEdit) edit(store, change.add[0].id, { fresh: true })
			return ok
		}
		case "mm.promote":
		case "mm.demote":
		case "mm.moveUp":
		case "mm.moveDown": {
			if (!node) return false
			const nodes = nodesOf(node.mapId)
			const change =
				command.name === "mm.promote"
					? tree.promote(nodes, node.id)
					: command.name === "mm.demote"
						? tree.demote(nodes, node.id)
						: tree.moveAmongSiblings(
								nodes,
								node.id,
								command.name === "mm.moveUp" ? -1 : 1,
							)
			return applyChange(store, node.mapId, change, {
				label: command.name === "mm.promote" ? "Promote node" : "Move node",
				select: node.id,
				selectUndo: [node.id],
			})
		}
		case "mm.nav": {
			if (!node) return false
			const layout = host.layout?.(node.mapId)
			if (!layout) return false
			const next = tree.navigate(nodesOf(node.mapId), layout, node.id, command.direction)
			if (next) store.select([next])
			return Boolean(next)
		}
		case "mm.edit":
			if (!node) return false
			edit(store, node.id)
			return true
		case "mm.toggle": {
			const nodes = store.selectedNodes()
			let did = false
			for (const n of nodes) {
				const all = nodesOf(n.mapId)
				if (!tree.childrenOf(all, n.id).length) continue
				const want = command.collapsed ?? !n.collapsed
				if (n.collapsed === want) continue
				did =
					applyChange(store, n.mapId, tree.setCollapsed(all, n.id, want), {
						label: want ? "Collapse" : "Expand",
						select: n.id,
						selectUndo: [n.id],
					}) || did
			}
			return did
		}
		case "mm.collapseAll":
		case "mm.expandAll": {
			const target = node || store.selectedNodes()[0]
			if (!target) return false
			const change = tree.setAllCollapsed(
				nodesOf(target.mapId),
				command.name === "mm.collapseAll",
			)
			return applyChange(store, target.mapId, change, {
				label: command.name === "mm.collapseAll" ? "Collapse all" : "Expand all",
				select: target.mapId && store.getMap(target.mapId)?.rootId,
				selectUndo: [target.id],
			})
		}
		case "mm.delete":
			return deleteSelected(store, host)
		default:
			return false
	}
}

async function deleteSelected(store, host) {
	const selected = store.selectedNodes()
	if (!selected.length) return false
	const byMap = new Map()
	for (const n of selected) {
		if (!byMap.has(n.mapId)) byMap.set(n.mapId, [])
		byMap.get(n.mapId).push(n)
	}
	// The root: the only map on the board is cleared, one of several is deleted whole.
	for (const [mapId, picked] of byMap) {
		const map = store.getMap(mapId)
		if (!picked.some((n) => n.id === map.rootId)) continue
		const several = store.maps.value.length > 1
		const message = several
			? "Delete this whole mind map?"
			: "Clear this mind map? Only the central idea stays."
		if (host.ask && !(await host.ask(message))) return false
		return several ? removeMap(store, mapId) : clearMap(store, mapId)
	}
	let total = 0
	for (const [mapId, picked] of byMap) {
		const nodes = store.nodesOfMap(mapId)
		const ids = new Set(picked.flatMap((n) => tree.subtreeIds(nodes, n.id)))
		total += ids.size
	}
	if (total > 1 && host.ask && !(await host.ask(`Delete ${total} nodes?`))) return false
	let ok = false
	for (const [mapId, picked] of byMap) {
		// Delete the topmost picked nodes; their subtrees go with them.
		const nodes = store.nodesOfMap(mapId)
		const ids = new Set(picked.map((n) => n.id))
		const tops = picked.filter((n) => {
			for (
				let p = nodes.find((x) => x.id === n.parentId);
				p;
				p = nodes.find((x) => x.id === p.parentId)
			)
				if (ids.has(p.id)) return false
			return true
		})
		const removed = new Set()
		const merged = { add: [], update: [], remove: [] }
		let working = nodes
		for (const top of tops) {
			const change = tree.removeSubtree(working, top.id)
			if (!change) continue
			working = tree.applyChange(working, change)
			change.remove.forEach((id) => removed.add(id))
			merged.update.push(...change.update)
		}
		merged.remove = [...removed]
		// An update to a node that was itself removed in the same step has no place.
		merged.update = merged.update.filter((u) => !removed.has(u.id))
		if (!merged.remove.length) continue
		const next = survivorAfter(nodes, merged.remove) || store.getMap(mapId).rootId
		ok =
			applyChange(store, mapId, merged, {
				label: merged.remove.length > 1 ? "Delete nodes" : "Delete node",
				select: next,
				selectUndo: picked.map((n) => n.id),
			}) || ok
	}
	return ok
}
