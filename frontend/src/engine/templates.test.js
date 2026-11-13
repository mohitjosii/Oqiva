import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { parseDocument } from "./model/schema"

// The template files the app seeds: each one must be a document the editor opens unchanged.
const DIR = path.resolve(__dirname, "../../../oqiva/seed/templates")
const files = fs.readdirSync(DIR).filter((name) => name.endsWith(".json"))
const CATEGORIES = new Set([
	"Basics",
	"Flowcharts",
	"Architecture",
	"Mind maps",
	"Planning",
	"UX / UI",
	"Engineering",
	"Business",
	"Product",
	"Meetings",
	"Marketing",
	"People",
])

describe("seed templates", () => {
	it("has the catalogue and the starter boards", () => {
		expect(files.length).toBeGreaterThanOrEqual(37)
		for (const slug of [
			"blank",
			"user-signup-flow",
			"retrospective",
			"customer-journey",
			"kanban-board",
		])
			expect(files).toContain(`${slug}.json`)
	})

	for (const name of files) {
		it(`${name} is a complete, clean document`, () => {
			const file = JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"))
			expect(file.slug).toBe(name.replace(".json", ""))
			expect(file.name).toBeTruthy()
			expect(CATEGORIES.has(file.category), file.category).toBe(true)
			expect(Array.isArray(file.tags)).toBe(true)
			const { document, issues } = parseDocument(file.document)
			expect(issues).toEqual([])
			expect(document.objects.length).toBe(file.document.objects.length) // nothing was dropped
			expect(document.connectors.length).toBe(file.document.connectors.length)
			const ids = new Set(document.objects.map((o) => o.id))
			for (const line of document.connectors) {
				for (const end of [line.from, line.to])
					if (end.objectId) expect(ids.has(end.objectId)).toBe(true)
			}
			expect(JSON.stringify(document).length).toBeLessThan(200_000)
		})
	}

	it("is deterministic: the files carry fixed, unique ids", () => {
		for (const name of files) {
			const file = JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"))
			const ids = file.document.objects.map((o) => o.id)
			expect(new Set(ids).size, name).toBe(ids.length)
			for (const id of ids) expect(typeof id).toBe("string")
		}
		const kanban = JSON.parse(fs.readFileSync(path.join(DIR, "kanban-board.json"), "utf8"))
		expect(kanban.document.objects.filter((o) => o.kind === "frame")).toHaveLength(5)
	})
})
