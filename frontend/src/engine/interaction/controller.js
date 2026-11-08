// Turns pointer events into changes to the board. It owns no document state: it reads the
// store, and changes it through the store's operations and gestures. It takes plain event
// objects ({clientX, clientY, button, shiftKey, ctrlKey, metaKey, target}), so it can be
// driven in tests without a browser.

import { boundsOfObjects, objectBounds, rectFromPoints, rectsIntersect } from "../geometry/bounds"
import {
	bendFor,
	connectorHit,
	connectorPath,
	CONNECTABLE_KINDS,
	isAttached,
	nearestAnchor,
	pathIntersectsRect,
	resolveConnectors,
} from "../geometry/connectors"
import { objectsInRect, topObjectAt } from "../geometry/hit"
import { HANDLES, resizeBox, rotationFor, snapAngle } from "../geometry/resize"
import { panBy, toBoard, visibleRect, zoomAt } from "../geometry/viewport"
import { autoHeight } from "../text/fit"
import { connectorToolById } from "../model/connectorTools"
import { createConnector, createObject, createTable, defaultRect } from "../model/factories"
import { newId } from "../model/ids"
import { normalizeRotation, pageSize } from "../model/schema"
import { toolById } from "../model/shapes"
import { OPPOSITE, quickAddRect } from "./placement"
import { createConnectorPaths } from "../render/connectorPaths"
import { expandToGroups } from "../store/arrange"
import { cellAt, scaleTable, withTable } from "../store/tableOps"
import { paintOnto } from "./actions"
import { snapToGuides } from "./guides"
import { setViewport } from "./view"

const CLICK_SLOP_PX = 3 // a press that moves less than this is a click, not a drag
const HIT_TOLERANCE_PX = 4
const WHEEL_ZOOM_RATE = 0.00095
const SNAP_PX = 14 // how near an anchor must be for a connector end to attach
const ANCHOR_REVEAL_PX = 48 // shapes this near the pointer show their anchors
const GUIDE_SNAP_PX = 6 // how close an edge must be to snap to a guide
const EDGE_ZONE_PX = 40 // dragging this close to the edge of the view scrolls it
const EDGE_SPEED = 700 // board pixels per second at the very edge

export class CanvasController {
	constructor(store, { bounds = () => ({ left: 0, top: 0 }), measure }) {
		this.store = store
		this.bounds = bounds
		this.measure = measure
		this.drag = null
		this.paths = createConnectorPaths(store)
	}

	get state() {
		return this.store.state
	}

	get cursor() {
		if (this.state.panning) return "grabbing"
		if (this.state.tool === "hand" || this.state.spaceHeld) return "grab"
		return this.state.tool === "select" ? "default" : "crosshair"
	}

	// --- connectors: finding them, snapping to anchors ---

	topConnectorAt(point, tolerance) {
		const paths = this.paths.value
		const connectors = this.store.connectors.value
		for (let i = connectors.length - 1; i >= 0; i--) {
			const path = paths.get(connectors[i].id)
			if (path && connectorHit(path, point, tolerance)) return connectors[i]
		}
		return null
	}

	snapAt(point, skipId = null) {
		const found = nearestAnchor(
			this.store.objects.value,
			point,
			SNAP_PX / this.state.viewport.scale,
			skipId,
		)
		return found ? { objectId: found.object.id, anchor: found.anchor } : null
	}

	// Shapes near the pointer show their anchors while a line is being drawn.
	revealAnchors(point) {
		const reach = ANCHOR_REVEAL_PX / this.state.viewport.scale
		this.state.anchorShapes = this.store.objects.value
			.filter(
				(object) =>
					CONNECTABLE_KINDS.has(object.kind) &&
					rectsIntersect(objectBounds(object), {
						x: point.x - reach,
						y: point.y - reach,
						w: reach * 2,
						h: reach * 2,
					}),
			)
			.map((object) => object.id)
	}

	clearConnectHints() {
		this.state.snap = null
		this.state.anchorShapes = []
		this.state.connectorPreview = null
	}

	// Pointer moving with no button down: which shape is hovered, and which anchors to show.
	hover(event) {
		if (event.target?.dataset?.quick) return // moving onto a quick-add arrow keeps its shape
		const point = this.boardPoint(event)
		if (connectorToolById(this.state.tool)) {
			this.revealAnchors(point)
			this.state.snap = this.snapAt(point)
			return
		}
		if (this.state.tool !== "select" || this.state.readonly) return this.clearHover()
		const hit = topObjectAt(
			this.store.objects.value,
			point,
			HIT_TOLERANCE_PX / this.state.viewport.scale,
		)
		this.state.hoverId = hit && hit.kind === "shape" ? hit.id : null
	}

	clearHover() {
		this.state.hoverId = null
		this.state.anchorShapes = []
		this.state.snap = null
	}

	screenPoint(event) {
		const box = this.bounds()
		return { x: event.clientX - box.left, y: event.clientY - box.top }
	}

	boardPoint(event) {
		return toBoard(this.state.viewport, this.screenPoint(event))
	}

	setSpaceHeld(held) {
		this.state.spaceHeld = held
	}

	// --- pointer ---

	pointerDown(event) {
		if (this.drag) return
		const screen = this.screenPoint(event)
		if (event.button === 1 || this.state.tool === "hand" || this.state.spaceHeld) {
			this.drag = { type: "pan", last: screen }
			this.state.panning = true
			return
		}
		if (event.button !== 0) return
		this.state.editingId = null // pressing anywhere else ends text editing, which saves it
		if (!event.target?.dataset?.quick) this.state.hoverId = null
		const point = this.boardPoint(event)
		const connectorTool = connectorToolById(this.state.tool)
		if (connectorTool) {
			if (!this.state.readonly) this.startConnector(connectorTool, point, screen)
			return
		}
		if (this.state.tool === "table") {
			if (!this.state.readonly)
				this.drag = {
					type: "draw",
					tool: { id: "table" },
					start: point,
					startScreen: screen,
				}
			return
		}
		const tool = toolById(this.state.tool)
		if (tool) {
			if (!this.state.readonly)
				this.drag = { type: "draw", tool, start: point, startScreen: screen }
			return
		}
		this.pressInSelectMode(event, point, screen)
	}

	pressInSelectMode(event, point, screen) {
		const quick = event.target?.dataset?.quick
		if (quick && !this.state.readonly) return this.quickAdd(quick)
		const handle = event.target?.dataset?.handle
		const selected = this.store.selectedObjects()
		const lines = this.store.selectedConnectors()
		if (handle?.startsWith("line-") && lines.length === 1 && !selected.length) {
			if (!this.state.readonly) this.startLineHandle(handle, lines[0])
			return
		}
		if (
			handle &&
			!handle.startsWith("line-") &&
			selected.length === 1 &&
			!lines.length &&
			!this.state.readonly
		) {
			const object = selected[0]
			const gesture = this.store.beginGesture([object.id])
			this.drag =
				handle === "rotate"
					? { type: "rotate", object, gesture }
					: { type: "resize", object, handle, gesture }
			return
		}
		const tolerance = HIT_TOLERANCE_PX / this.state.viewport.scale
		// Lines are drawn above shapes, so a press on a line picks the line.
		const hit =
			this.topConnectorAt(point, tolerance * 2) ||
			topObjectAt(this.store.objects.value, point, tolerance)
		if (hit) {
			if (this.state.painter) {
				if (!this.state.readonly) paintOnto(this.store, [hit.id])
				return
			}
			// Picking one member of a group picks the whole group.
			const members = expandToGroups(this.store.objects.value, [hit.id])
			if (event.shiftKey) {
				const selected = this.state.selection
				const all = members.every((id) => selected.includes(id))
				this.store.select(
					all
						? selected.filter((id) => !members.includes(id))
						: [...new Set([...selected, ...members])],
				)
				return
			}
			if (hit.kind === "table") {
				const cell = cellAt(hit, point)
				if (cell) this.state.tableCell = { id: hit.id, ...cell }
			}
			const alreadySelected = this.state.selection.includes(hit.id)
			if (!alreadySelected) this.store.select(members)
			const ids = [...this.state.selection]
			this.drag = {
				type: "move",
				start: point,
				startScreen: screen,
				moved: false,
				ids,
				origins: new Map(ids.map((id) => [id, this.store.getItem(id)])),
				// A click on one of several selected objects narrows the selection to it.
				collapseTo: alreadySelected && ids.length > members.length ? members : null,
				gesture: this.state.readonly ? null : this.store.beginGesture(ids),
				...this.snapTargets(ids),
			}
			return
		}
		if (!event.shiftKey) this.store.clearSelection()
		this.drag = {
			type: "marquee",
			start: point,
			base: event.shiftKey ? [...this.state.selection] : [],
		}
	}

	pointerMove(event) {
		const drag = this.drag
		if (!drag) return this.hover(event)
		this.lastMove = event
		const screen = this.screenPoint(event)
		const point = this.boardPoint(event)
		switch (drag.type) {
			case "pan":
				setViewport(
					this.store,
					panBy(this.state.viewport, screen.x - drag.last.x, screen.y - drag.last.y),
				)
				drag.last = screen
				break
			case "move":
				this.moveSelection(drag, point, screen, event.altKey)
				break
			case "resize":
				this.resize(drag, point, event.shiftKey)
				break
			case "rotate": {
				const angle = rotationFor(drag.object, point)
				drag.gesture.set([
					{
						id: drag.object.id,
						patch: {
							rotation: normalizeRotation(event.shiftKey ? snapAngle(angle) : angle),
						},
					},
				])
				break
			}
			case "marquee": {
				const rect = rectFromPoints(drag.start, point)
				this.state.marquee = rect
				const inside = objectsInRect(this.store.objects.value, rect).map(
					(object) => object.id,
				)
				const paths = this.paths.value
				const lines = this.store.connectors.value
					.filter((connector) => {
						const path = paths.get(connector.id)
						return path && pathIntersectsRect(path, rect)
					})
					.map((connector) => connector.id)
				const picked = expandToGroups(this.store.objects.value, inside)
				this.store.select([...new Set([...drag.base, ...picked, ...lines])])
				break
			}
			case "connect":
				this.moveConnector(drag, point)
				break
			case "line-end":
				this.moveLineEnd(drag, point)
				break
			case "line-bend":
				drag.gesture.set([
					{
						id: drag.connector.id,
						patch: { bend: bendFor(drag.connector, drag.resolved, point) },
					},
				])
				break
			case "draw":
				this.state.preview = {
					tool: drag.tool.id,
					rect: this.drawRect(drag, point, event.shiftKey),
				}
				break
		}
	}

	// The boxes a dragged selection lines up with: every other object on screen, and the page.
	snapTargets(ids) {
		const moving = ids.map((id) => this.store.getObject(id)).filter(Boolean)
		if (!moving.length) return { box: null, targets: [] }
		const box = boundsOfObjects(moving)
		const view = visibleRect(this.state.viewport, this.state.size)
		const chosen = new Set(ids)
		const targets = this.store.objects.value
			.filter((object) => !chosen.has(object.id))
			.map(objectBounds)
			.filter((other) => rectsIntersect(other, view))
		const canvas = this.store.canvas.value
		if (canvas.mode === "preset") {
			const { width, height } = pageSize(canvas)
			targets.push({ x: 0, y: 0, w: width, h: height })
		}
		return { box, targets }
	}

	moveSelection(drag, point, screen, alt = false) {
		if (!drag.gesture) return
		if (!drag.moved) {
			if (
				Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) <
				CLICK_SLOP_PX
			)
				return
			drag.moved = true
		}
		let dx = point.x - drag.start.x
		let dy = point.y - drag.start.y
		this.state.guides = []
		if (drag.box && !alt) {
			// A light snap: only within a few pixels, and it lets go as soon as you move on.
			const where = { ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy }
			const snap = snapToGuides(
				where,
				drag.targets,
				GUIDE_SNAP_PX / this.state.viewport.scale,
			)
			dx += snap.dx
			dy += snap.dy
			this.state.guides = snap.guides
		}
		const changes = []
		for (const id of drag.ids) {
			const origin = drag.origins.get(id)
			if (!origin) continue
			if (origin.geometry) {
				// A line moves only the ends that are not attached to a shape.
				const patch = {}
				for (const end of ["from", "to"])
					if (!isAttached(origin[end]))
						patch[end] = { x: origin[end].x + dx, y: origin[end].y + dy }
				if (Object.keys(patch).length) changes.push({ id, patch })
			} else {
				changes.push({ id, patch: { x: origin.x + dx, y: origin.y + dy } })
			}
		}
		drag.gesture.set(changes)
	}

	// --- drawing and editing lines ---

	startConnector(tool, point, screen) {
		const snap = this.snapAt(point)
		this.drag = {
			type: "connect",
			tool,
			from: snap || { x: point.x, y: point.y },
			startScreen: screen,
			end: null,
		}
		this.state.snap = snap
	}

	moveConnector(drag, point) {
		const snap = this.snapAt(point)
		this.state.snap = snap
		this.revealAnchors(point)
		drag.end = snap || { x: point.x, y: point.y }
		this.state.connectorPreview = {
			from: drag.from,
			to: drag.end,
			geometry: drag.tool.geometry,
			arrow: drag.tool.arrow,
		}
	}

	finishConnector(drag, screen) {
		this.clearConnectHints()
		const dragged =
			Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) >=
			CLICK_SLOP_PX
		const same =
			isAttached(drag.from) &&
			isAttached(drag.end) &&
			drag.from.objectId === drag.end.objectId &&
			drag.from.anchor === drag.end.anchor
		if (!dragged || !drag.end || same) return
		const connector = createConnector({
			from: drag.from,
			to: drag.end,
			geometry: drag.tool.geometry,
			arrow: drag.tool.arrow,
			theme: this.store.theme.value.preset,
			z: this.store.nextConnectorZ(),
		})
		if (this.store.addItems({ connectors: [connector] }, { label: "Add line" }))
			this.state.tool = "select"
	}

	startLineHandle(handle, connector) {
		const gesture = this.store.beginGesture([connector.id])
		if (handle === "line-bend") {
			const byId = new Map(this.store.objects.value.map((object) => [object.id, object]))
			const resolved = resolveConnectors(this.store.connectors.value, byId).get(connector.id)
			this.drag = { type: "line-bend", connector, resolved, gesture }
			return
		}
		this.drag = {
			type: "line-end",
			connector,
			end: handle === "line-from" ? "from" : "to",
			gesture,
		}
	}

	moveLineEnd(drag, point) {
		const snap = this.snapAt(point)
		this.state.snap = snap
		this.revealAnchors(point)
		drag.gesture.set([
			{ id: drag.connector.id, patch: { [drag.end]: snap || { x: point.x, y: point.y } } },
		])
	}

	// The hover arrows: a copy of the shape on one side, joined to it by an arrow.
	quickAdd(side) {
		const source = this.store.getObject(this.state.hoverId)
		if (!source || source.kind !== "shape") return
		const obstacles = this.store.objects.value.map(objectBounds)
		const rect = quickAddRect(source, side, obstacles)
		const copy = {
			...source,
			id: newId(),
			x: rect.x,
			y: rect.y,
			z: this.store.nextZ(),
			text: source.text ? { ...source.text, paragraphs: [{ runs: [] }] } : null,
		}
		const arrow = createConnector({
			from: { objectId: source.id, anchor: side },
			to: { objectId: copy.id, anchor: OPPOSITE[side] },
			geometry: "straight",
			arrow: true,
			theme: this.store.theme.value.preset,
			z: this.store.nextConnectorZ(),
		})
		if (
			this.store.addItems(
				{ objects: [copy], connectors: [arrow] },
				{ label: "Add shape and arrow" },
			)
		) {
			this.store.select([copy.id])
			this.state.hoverId = null
		}
	}

	resize(drag, point, keepAspect) {
		const { object, handle } = drag
		if (object.kind === "table") return this.resizeTable(drag, point, keepAspect)
		let box = resizeBox(object, handle, point, { keepAspect })
		if (object.text) {
			// A shape never shrinks below its text, so the drag stops where the text would no longer fit.
			const needed = autoHeight({ ...object, ...box }, this.measure)
			if (needed && needed > box.h && HANDLES[handle].hy !== 0) {
				box = resizeBox(object, handle, point, { keepAspect: false, minHeight: needed })
			} else if (needed && needed > box.h) {
				box = { ...box, h: needed }
			}
		}
		drag.gesture.set([{ id: object.id, patch: box }])
	}

	// A table is resized by stretching its columns and rows together, never below the minimum cell.
	resizeTable(drag, point, keepAspect) {
		const { object, handle } = drag
		const box = resizeBox(object, handle, point, { keepAspect })
		const table = scaleTable(object.table, box.w, box.h)
		const size = withTable(table)
		const patch = { ...size, x: box.x, y: box.y }
		if (!object.rotation) {
			// If a minimum cell stopped it short, the edge being dragged stays with the pointer.
			if (HANDLES[handle].hx < 0) patch.x = box.x + box.w - size.w
			if (HANDLES[handle].hy < 0) patch.y = box.y + box.h - size.h
		}
		drag.gesture.set([{ id: object.id, patch }])
	}

	drawRect(drag, point, shiftKey) {
		if (drag.tool.ratio || shiftKey) {
			const size = Math.max(
				Math.abs(point.x - drag.start.x),
				Math.abs(point.y - drag.start.y),
			)
			return {
				x: point.x >= drag.start.x ? drag.start.x : drag.start.x - size,
				y: point.y >= drag.start.y ? drag.start.y : drag.start.y - size,
				w: size,
				h: size,
			}
		}
		return rectFromPoints(drag.start, point)
	}

	pointerUp(event) {
		const drag = this.drag
		if (!drag) return
		this.drag = null
		this.lastMove = null
		this.state.panning = false
		this.state.guides = []
		switch (drag.type) {
			case "move":
				if (drag.moved) drag.gesture?.commit("Move")
				else if (drag.collapseTo) this.store.select(drag.collapseTo)
				break
			case "resize":
				drag.gesture.commit("Resize")
				break
			case "rotate":
				drag.gesture.commit("Rotate")
				break
			case "marquee":
				this.state.marquee = null
				break
			case "connect":
				this.finishConnector(drag, this.screenPoint(event))
				break
			case "line-end":
				this.clearConnectHints()
				drag.gesture.commit("Move line end")
				break
			case "line-bend":
				drag.gesture.commit("Bend line")
				break
			case "draw":
				this.finishDraw(
					drag,
					this.boardPoint(event),
					this.screenPoint(event),
					event.shiftKey,
				)
				break
		}
	}

	finishDraw(drag, point, screen, shiftKey) {
		this.state.preview = null
		const dragged =
			Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) >=
			CLICK_SLOP_PX
		if (drag.tool.id === "table") return this.createTableAt(drag, point, dragged, shiftKey)
		const rect = dragged
			? this.drawRect(drag, point, shiftKey)
			: defaultRect(drag.tool.id, drag.start)
		this.createAndSelect(drag.tool.id, rect)
	}

	// A table dragged out over a rectangle, or dropped at the click with ordinary cell sizes.
	createTableAt(drag, point, dragged, shiftKey) {
		const { tableRows: rows, tableCols: cols } = this.state.toolOptions
		const table = createTable({
			rows,
			cols,
			theme: this.store.theme.value.preset,
			z: this.store.nextZ(),
			...(dragged ? { rect: this.drawRect(drag, point, shiftKey) } : { center: drag.start }),
		})
		if (!this.store.addItems({ objects: [table] }, { label: "Add table" })) return
		this.state.tool = "select"
		this.state.tableCell = { id: table.id, row: 0, col: 0 }
	}

	// Places a new object, selects it, and goes back to the select tool.
	createAndSelect(toolId, rect, { edit = toolId === "text" } = {}) {
		const object = createObject(toolId, rect, {
			theme: this.store.theme.value.preset,
			z: this.store.nextZ(),
			sides: this.state.toolOptions.sides,
		})
		if (
			!this.store.addObjects([object], {
				label: toolId === "text" ? "Add text box" : "Add shape",
			})
		)
			return null
		if (toolId !== "text") this.state.lastShapeTool = toolId
		this.state.tool = "select"
		if (edit) {
			this.state.editingNew = object.kind === "text"
			this.state.editingId = object.id
		}
		return object
	}

	// Pressing Escape, or switching tools, abandons whatever is half done.
	cancel() {
		const drag = this.drag
		this.drag = null
		this.state.panning = false
		this.state.preview = null
		this.state.marquee = null
		this.state.guides = []
		this.lastMove = null
		this.clearConnectHints()
		if (drag?.gesture) drag.gesture.cancel()
	}

	doubleClick(event) {
		if (this.state.tool !== "select" || this.state.readonly) return
		const point = this.boardPoint(event)
		const tolerance = HIT_TOLERANCE_PX / this.state.viewport.scale
		const line = this.topConnectorAt(point, tolerance * 2)
		if (line) {
			this.store.select([line.id])
			this.state.editingNew = false
			this.state.editingId = line.id
			return
		}
		const hit = topObjectAt(this.store.objects.value, point, tolerance)
		if (hit?.kind === "table") {
			const cell = cellAt(hit, point) || { row: 0, col: 0 }
			this.store.select([hit.id])
			this.state.tableCell = { id: hit.id, ...cell }
			this.state.editingNew = false
			this.state.editingCell = cell
			this.state.editingId = hit.id
			return
		}
		if (hit) {
			this.store.select([hit.id])
			this.state.editingNew = false
			this.state.editingCell = null
			this.state.editingId = hit.id
			return
		}
		// Double-clicking empty canvas makes a shape, ready for typing.
		this.createAndSelect(
			this.state.lastShapeTool,
			defaultRect(this.state.lastShapeTool, point),
			{ edit: true },
		)
	}

	// Called every animation frame: while something is being dragged near the edge of the view,
	// the view scrolls, and the drag carries on from where the pointer now is on the board.
	autoPanTick(elapsedMs) {
		const drag = this.drag
		if (!drag || drag.type === "pan" || !this.lastMove || elapsedMs <= 0) return false
		const screen = this.screenPoint(this.lastMove)
		const { width, height } = this.state.size
		const speed = (distance) =>
			distance >= EDGE_ZONE_PX ? 0 : (1 - Math.max(distance, 0) / EDGE_ZONE_PX) * EDGE_SPEED
		const step = elapsedMs / 1000
		const vx = speed(width - screen.x) - speed(screen.x)
		const vy = speed(height - screen.y) - speed(screen.y)
		if (!vx && !vy) return false
		const { x, y } = this.state.viewport
		setViewport(this.store, panBy(this.state.viewport, -vx * step, -vy * step))
		if (this.state.viewport.x === x && this.state.viewport.y === y) return false // at the limit of a preset page
		this.pointerMove(this.lastMove) // the same screen point is now somewhere else on the board
		return true
	}

	wheel(event) {
		const viewport = this.state.viewport
		if (event.ctrlKey || event.metaKey) {
			// Ctrl/Cmd and wheel (and a trackpad pinch) zoom around the cursor.
			setViewport(
				this.store,
				zoomAt(
					viewport,
					this.screenPoint(event),
					viewport.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE),
				),
			)
			return
		}
		const horizontal = event.shiftKey && !event.deltaX
		setViewport(
			this.store,
			panBy(
				viewport,
				horizontal ? -event.deltaY : -event.deltaX,
				horizontal ? 0 : -event.deltaY,
			),
		)
	}
}
