// Turns pointer events into changes to the board. It owns no document state: it reads the
// store, and changes it through the store's operations and gestures. It takes plain event
// objects ({clientX, clientY, button, shiftKey, ctrlKey, metaKey, target}), so it can be
// driven in tests without a browser.

import { rectFromPoints } from "../geometry/bounds"
import { objectsInRect, topObjectAt } from "../geometry/hit"
import { HANDLES, resizeBox, rotationFor, snapAngle } from "../geometry/resize"
import { panBy, toBoard, zoomAt } from "../geometry/viewport"
import { autoHeight } from "../text/fit"
import { createObject, defaultRect } from "../model/factories"
import { normalizeRotation } from "../model/schema"
import { toolById } from "../model/shapes"
import { setViewport } from "./view"

const CLICK_SLOP_PX = 3 // a press that moves less than this is a click, not a drag
const HIT_TOLERANCE_PX = 4
const WHEEL_ZOOM_RATE = 0.00095

export class CanvasController {
	constructor(store, { bounds = () => ({ left: 0, top: 0 }), measure }) {
		this.store = store
		this.bounds = bounds
		this.measure = measure
		this.drag = null
	}

	get state() {
		return this.store.state
	}

	get cursor() {
		if (this.state.panning) return "grabbing"
		if (this.state.tool === "hand" || this.state.spaceHeld) return "grab"
		return this.state.tool === "select" ? "default" : "crosshair"
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
		const point = this.boardPoint(event)
		const tool = toolById(this.state.tool)
		if (tool) {
			if (!this.state.readonly)
				this.drag = { type: "draw", tool, start: point, startScreen: screen }
			return
		}
		this.pressInSelectMode(event, point, screen)
	}

	pressInSelectMode(event, point, screen) {
		const handle = event.target?.dataset?.handle
		const selected = this.store.selectedObjects()
		if (handle && selected.length === 1 && !this.state.readonly) {
			const object = selected[0]
			const gesture = this.store.beginGesture([object.id])
			this.drag =
				handle === "rotate"
					? { type: "rotate", object, gesture }
					: { type: "resize", object, handle, gesture }
			return
		}
		const hit = topObjectAt(
			this.store.objects.value,
			point,
			HIT_TOLERANCE_PX / this.state.viewport.scale,
		)
		if (hit) {
			if (event.shiftKey) {
				this.store.toggleSelection(hit.id)
				return
			}
			const alreadySelected = this.state.selection.includes(hit.id)
			if (!alreadySelected) this.store.select([hit.id])
			const ids = [...this.state.selection]
			this.drag = {
				type: "move",
				start: point,
				startScreen: screen,
				moved: false,
				ids,
				origins: new Map(ids.map((id) => [id, this.store.getObject(id)])),
				// A click on one of several selected objects narrows the selection to it.
				collapseTo: alreadySelected && ids.length > 1 ? hit.id : null,
				gesture: this.state.readonly ? null : this.store.beginGesture(ids),
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
		if (!drag) return
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
				this.moveSelection(drag, point, screen)
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
				this.store.select([...new Set([...drag.base, ...inside])])
				break
			}
			case "draw":
				this.state.preview = {
					tool: drag.tool.id,
					rect: this.drawRect(drag, point, event.shiftKey),
				}
				break
		}
	}

	moveSelection(drag, point, screen) {
		if (!drag.gesture) return
		if (!drag.moved) {
			if (
				Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) <
				CLICK_SLOP_PX
			)
				return
			drag.moved = true
		}
		const dx = point.x - drag.start.x
		const dy = point.y - drag.start.y
		drag.gesture.set(
			drag.ids.map((id) => ({
				id,
				patch: { x: drag.origins.get(id).x + dx, y: drag.origins.get(id).y + dy },
			})),
		)
	}

	resize(drag, point, keepAspect) {
		const { object, handle } = drag
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
		this.state.panning = false
		switch (drag.type) {
			case "move":
				if (drag.moved) drag.gesture?.commit("Move")
				else if (drag.collapseTo) this.store.select([drag.collapseTo])
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
		const rect = dragged
			? this.drawRect(drag, point, shiftKey)
			: defaultRect(drag.tool.id, drag.start)
		this.createAndSelect(drag.tool.id, rect)
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
		if (drag?.gesture) drag.gesture.cancel()
	}

	doubleClick(event) {
		if (this.state.tool !== "select" || this.state.readonly) return
		const point = this.boardPoint(event)
		const hit = topObjectAt(
			this.store.objects.value,
			point,
			HIT_TOLERANCE_PX / this.state.viewport.scale,
		)
		if (hit) {
			this.store.select([hit.id])
			this.state.editingNew = false
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
