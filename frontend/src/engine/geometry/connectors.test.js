import { describe, expect, it } from "vitest"
import {
	ANCHORS,
	anchorDirection,
	anchorPoint,
	avoidanceKey,
	axisOf,
	bendFor,
	connectorHit,
	connectorPath,
	curveControls,
	distanceToPath,
	elbowPoints,
	nearestAnchor,
	pathBounds,
	resolveConnectors,
} from "./connectors"

const box = (id, x, y, w = 100, h = 60, over = {}) => ({
	id,
	kind: "shape",
	shape: "rectangle",
	x,
	y,
	w,
	h,
	rotation: 0,
	...over,
})
const link = (id, from, to, over = {}) => ({ id, from, to, geometry: "straight", bend: 0, ...over })
const byId = (...objects) => new Map(objects.map((o) => [o.id, o]))
const near = (a, b, digits = 6) => expect(a).toBeCloseTo(b, digits)

describe("anchors", () => {
	it("has eight, with outward directions that turn with the shape", () => {
		expect(ANCHORS).toHaveLength(8)
		const a = box("a", 0, 0)
		expect(anchorPoint(a, "e")).toEqual({ x: 100, y: 30 })
		expect(anchorDirection(a, "e")).toEqual({ x: 1, y: 0 })
		const turned = { ...a, rotation: 90 }
		const east = anchorDirection(turned, "e")
		near(east.x, 0)
		near(east.y, 1)
		const corner = anchorDirection(a, "se")
		near(Math.hypot(corner.x, corner.y), 1)
	})

	it("picks the nearest anchor within reach, ignoring the shape you are leaving and unconnectable kinds", () => {
		const a = box("a", 0, 0)
		const b = box("b", 300, 0)
		expect(nearestAnchor([a, b], { x: 104, y: 33 }, 14).anchor).toBe("e")
		expect(nearestAnchor([a, b], { x: 150, y: 150 }, 14)).toBeNull()
		expect(nearestAnchor([a, b], { x: 104, y: 33 }, 14, "a")).toBeNull()
		expect(nearestAnchor([{ ...a, kind: "weird" }], { x: 104, y: 33 }, 14)).toBeNull()
		expect(nearestAnchor([a, box("c", 0, 0)], { x: 100, y: 30 }, 14).distance).toBe(0)
	})

	it("treats the axis nearest a direction as the way a route leaves", () => {
		expect(axisOf({ x: 0.9, y: 0.4 })).toEqual({ x: 1, y: 0 })
		expect(axisOf({ x: -0.2, y: -0.9 })).toEqual({ x: 0, y: -1 })
	})
})

describe("following the shapes", () => {
	const conn = link("c", { objectId: "a", anchor: "e" }, { objectId: "b", anchor: "w" })

	it("keeps both ends on their anchors when a shape moves", () => {
		const a = box("a", 0, 0)
		const b = box("b", 300, 0)
		expect(resolveConnectors([conn], byId(a, b)).get("c")).toMatchObject({
			p0: { x: 100, y: 30 },
			p1: { x: 300, y: 30 },
		})
		const moved = { ...b, x: 500, y: 100 }
		expect(resolveConnectors([conn], byId(a, moved)).get("c").p1).toEqual({ x: 500, y: 130 })
	})

	it("follows a rotated shape, ends and directions both", () => {
		const a = box("a", 0, 0)
		const b = box("b", 300, 0, 100, 60, { rotation: 180 })
		const r = resolveConnectors([conn], byId(a, b)).get("c")
		near(r.p1.x, 400) // b's west anchor, turned half a circle about its centre (350, 30)
		near(r.p1.y, 30)
		near(r.d1.x, 1)
	})

	it("follows a resize", () => {
		const a = box("a", 0, 0, 200, 60)
		const b = box("b", 300, 0)
		expect(resolveConnectors([conn], byId(a, b)).get("c").p0).toEqual({ x: 200, y: 30 })
	})

	it("gives a free end the direction of the other end, and a free point stays put", () => {
		const free = link("f", { objectId: "a", anchor: "e" }, { x: 400, y: 30 })
		const r = resolveConnectors([free], byId(box("a", 0, 0))).get("f")
		expect(r.p1).toEqual({ x: 400, y: 30 })
		near(r.d1.x, -1)
	})

	it("skips a connector whose shape is gone", () => {
		expect(resolveConnectors([conn], byId(box("a", 0, 0))).has("c")).toBe(false)
	})
})

describe("sharing an anchor", () => {
	it("spreads several connectors along the side, evenly and centred", () => {
		const a = box("a", 0, 0, 100, 100)
		const b = box("b", 300, 0)
		const c = box("c", 300, 200)
		const d = box("d", 300, 400)
		const links = ["b", "c", "d"].map((to, i) =>
			link(`k${i}`, { objectId: "a", anchor: "e" }, { objectId: to, anchor: "w" }),
		)
		const ys = links.map((l) => resolveConnectors(links, byId(a, b, c, d)).get(l.id).p0.y)
		expect(ys[1]).toBe(50)
		near(ys[1] - ys[0], 14)
		near(ys[2] - ys[1], 14)
	})

	it("leaves a lone connector on the anchor and never moves a corner", () => {
		const a = box("a", 0, 0)
		const solo = link("s", { objectId: "a", anchor: "e" }, { x: 300, y: 30 })
		expect(resolveConnectors([solo], byId(a)).get("s").p0).toEqual({ x: 100, y: 30 })
		const corners = [0, 1].map((i) =>
			link(`x${i}`, { objectId: "a", anchor: "se" }, { x: 300 + i, y: 300 }),
		)
		const r = resolveConnectors(corners, byId(a))
		expect(r.get("x0").p0).toEqual(r.get("x1").p0)
	})

	it("fans out along the side of a turned shape", () => {
		const a = box("a", 0, 0, 100, 100, { rotation: 90 })
		const links = [0, 1].map((i) =>
			link(`k${i}`, { objectId: "a", anchor: "e" }, { x: 500, y: i }),
		)
		const r = resolveConnectors(links, byId(a))
		near(Math.abs(r.get("k0").p0.x - r.get("k1").p0.x), 14) // the east side now runs along x
		near(r.get("k0").p0.y, r.get("k1").p0.y)
	})
})

describe("routes", () => {
	const axisAligned = (points) =>
		points.slice(1).every((p, i) => p.x === points[i].x || p.y === points[i].y)
	const E = { x: 1, y: 0 }
	const W = { x: -1, y: 0 }
	const S = { x: 0, y: 1 }
	const N = { x: 0, y: -1 }

	it("routes an elbow between facing sides with one step in the middle", () => {
		const points = elbowPoints({ x: 100, y: 30 }, E, { x: 300, y: 130 }, W)
		expect(points).toEqual([
			{ x: 100, y: 30 },
			{ x: 200, y: 30 },
			{ x: 200, y: 130 },
			{ x: 300, y: 130 },
		])
	})

	it("turns once between a horizontal exit and a vertical entry", () => {
		const points = elbowPoints({ x: 100, y: 30 }, E, { x: 300, y: 200 }, N)
		expect(points).toEqual([
			{ x: 100, y: 30 },
			{ x: 300, y: 30 },
			{ x: 300, y: 200 },
		])
	})

	it("steps out and around when the sides do not face each other", () => {
		const points = elbowPoints({ x: 100, y: 30 }, E, { x: 20, y: 130 }, W)
		expect(points).toHaveLength(6)
		expect(axisAligned(points)).toBe(true)
		expect(points[1].x).toBeGreaterThan(100) // leaves to the east first
		const vertical = elbowPoints({ x: 50, y: 60 }, S, { x: 50, y: -40 }, N)
		expect(axisAligned(vertical)).toBe(true)
	})

	it("is always made of right angles", () => {
		for (const [p0, d0, p1, d1] of [
			[{ x: 0, y: 0 }, E, { x: 0, y: 0 }, W],
			[{ x: 0, y: 0 }, S, { x: 200, y: 0 }, S],
			[{ x: 0, y: 0 }, N, { x: 5, y: 300 }, N],
			[{ x: 0, y: 0 }, E, { x: 100, y: 100 }, E],
		]) {
			expect(axisAligned(elbowPoints(p0, d0, p1, d1))).toBe(true)
		}
	})

	it("describes a straight connector with its middle and end directions", () => {
		const path = connectorPath(link("c", {}, {}, { geometry: "straight" }), {
			p0: { x: 0, y: 0 },
			p1: { x: 100, y: 0 },
			d0: E,
			d1: W,
		})
		expect(path.mid).toEqual({ x: 50, y: 0 })
		expect(path.endDir).toEqual({ x: 1, y: 0 })
		expect(path.startDir).toEqual({ x: -1, y: 0 })
		expect(path.d).toBe("M0 0 L100 0")
		expect(pathBounds(path)).toEqual({ x: 0, y: 0, w: 100, h: 0 })
	})

	it("curves, and a bend moves the middle sideways by three quarters of itself", () => {
		const resolved = { p0: { x: 0, y: 0 }, p1: { x: 200, y: 0 }, d0: E, d1: W }
		const flat = connectorPath(link("c", {}, {}, { geometry: "curved", bend: 0 }), resolved)
		near(flat.mid.y, 0)
		const bent = connectorPath(link("c", {}, {}, { geometry: "curved", bend: 80 }), resolved)
		near(Math.abs(bent.mid.y), 60)
		expect(bent.d.startsWith("M0 0 C")).toBe(true)
		expect(curveControls(resolved.p0, E, resolved.p1, W, 0)).toHaveLength(4)
	})

	it("finds the bend that puts the middle under a point", () => {
		const resolved = { p0: { x: 0, y: 0 }, p1: { x: 200, y: 0 }, d0: E, d1: W }
		const bend = bendFor({}, resolved, { x: 100, y: 45 })
		const path = connectorPath({ geometry: "curved", bend }, resolved)
		near(path.mid.y, 45, 3)
	})

	it("measures the distance to a connector", () => {
		const path = connectorPath(
			{ geometry: "straight" },
			{ p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 }, d0: E, d1: W },
		)
		expect(distanceToPath(path, { x: 50, y: 7 })).toBe(7)
		expect(distanceToPath(path, { x: 150, y: 0 })).toBe(50)
		expect(connectorHit(path, { x: 50, y: 4 }, 5)).toBe(true)
		expect(connectorHit(path, { x: 50, y: 9 }, 5)).toBe(false)
	})
})

describe("curved lines that go round cards", () => {
	const card = (id, x, y, w = 160, h = 100) => ({
		id,
		kind: "shape",
		shape: "rectangle",
		x,
		y,
		w,
		h,
		rotation: 0,
		z: 1,
	})
	const curve = (from, to, extra = {}) => ({
		id: "c",
		from: { objectId: from[0], anchor: from[1] },
		to: { objectId: to[0], anchor: to[1] },
		geometry: "curved",
		heads: { start: "none", end: "arrow" },
		bend: 0,
		...extra,
	})
	const pathOf = (connector, cards) => {
		const byId = new Map(cards.map((c) => [c.id, c]))
		return connectorPath(connector, resolveConnectors([connector], byId).get("c"))
	}
	// points of a path that lie strictly inside a card
	const inside = (path, c, margin = 2) =>
		path.points.filter(
			(p) =>
				p.x > c.x + margin &&
				p.x < c.x + c.w - margin &&
				p.y > c.y + margin &&
				p.y < c.y + c.h - margin,
		)

	it("does not fold back through its own card when the other end is behind it", () => {
		// leaves the right edge of a, but b is to the left and below
		const a = card("a", 400, 0)
		const b = card("b", 0, 300)
		const path = pathOf(curve(["a", "e"], ["b", "e"]), [a, b])
		expect(inside(path, a)).toEqual([])
		expect(inside(path, b)).toEqual([])
		expect(path.points[0].x).toBe(560) // it still starts at the anchor
	})

	it("steers round a card that sits in the way, and stays clear of it", () => {
		const a = card("a", 0, 0)
		const b = card("b", 600, 0)
		const wall = card("w", 280, -60, 120, 220)
		const straight = pathOf(curve(["a", "e"], ["b", "w"]), [a, b])
		expect(inside(straight, wall).length).toBeGreaterThan(0) // without the card, the curve runs where it stands
		const clear = pathOf(curve(["a", "e"], ["b", "w"]), [a, b, wall])
		expect(inside(clear, wall, -10)).toEqual([]) // not even within the margin
		expect(pathBounds(clear).h).toBeGreaterThan(pathBounds(straight).h) // it went round
	})

	it("keeps the plain curve when nothing is in the way, and ignores frames and its own cards", () => {
		const a = card("a", 0, 0)
		const b = card("b", 600, 0)
		const frame = { ...card("f", 100, -200, 800, 500), kind: "frame" }
		const plain = pathOf(curve(["a", "e"], ["b", "w"]), [a, b])
		expect(pathOf(curve(["a", "e"], ["b", "w"]), [a, b, frame]).d).toBe(plain.d)
	})

	it("uses a bend the person set exactly as it is", () => {
		const a = card("a", 0, 0)
		const b = card("b", 600, 0)
		const wall = card("w", 280, -60, 120, 220)
		const set = pathOf(curve(["a", "e"], ["b", "w"], { bend: 30 }), [a, b, wall])
		const alone = pathOf(curve(["a", "e"], ["b", "w"], { bend: 30 }), [a, b])
		expect(set.d).toBe(alone.d)
	})

	it("is cheap to ask: a board of many cards still gives a path", () => {
		const cards = [card("a", 0, 0), card("b", 600, 0)]
		for (let i = 0; i < 2000; i++)
			cards.push(card(`x${i}`, 2000 + (i % 50) * 200, Math.floor(i / 50) * 150))
		const start = Date.now()
		const path = pathOf(curve(["a", "e"], ["b", "w"]), cards)
		expect(path.points.length).toBeGreaterThan(10)
		expect(Date.now() - start).toBeLessThan(200)
	})

	it("changes the drawing key when a nearby card moves", () => {
		const a = card("a", 0, 0)
		const b = card("b", 600, 0)
		const make = (wall) => {
			const connector = curve(["a", "e"], ["b", "w"])
			const byId = new Map([a, b, wall].map((c) => [c.id, c]))
			return avoidanceKey(resolveConnectors([connector], byId).get("c"))
		}
		expect(make(card("w", 280, -60))).not.toBe(make(card("w", 280, 400)))
		expect(make(card("w", 5000, 5000))).toBe("") // too far to matter
	})
})
