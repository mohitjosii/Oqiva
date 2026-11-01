import { describe, expect, it } from "vitest"

// The engine must work without a server. It is given what it needs (a document, and
// functions to save it) and never calls the API, so it can be tested and reused on its own.
const sources = import.meta.glob("./**/*.{js,vue}", {
	query: "?raw",
	import: "default",
	eager: true,
})

const FORBIDDEN = [
	[/\/api\/method/, "a direct API path"],
	[/oqiva\.api\./, "an Oqiva API method"],
	[/createResource|createListResource|createDocumentResource/, "a frappe-ui resource"],
	[/import\s*\{[^}]*\bcall\b[^}]*\}\s*from\s*["']frappe-ui["']/, "frappe-ui's call"],
	[/from\s*["']@\/data\//, "app data modules"],
]

describe("engine boundary", () => {
	it("reads some source files", () => {
		expect(Object.keys(sources).length).toBeGreaterThan(20)
	})

	for (const [path, source] of Object.entries(sources)) {
		if (path.endsWith(".test.js")) continue
		it(`${path} does not talk to the server`, () => {
			for (const [pattern, what] of FORBIDDEN) {
				expect(source, `${path} uses ${what}`).not.toMatch(pattern)
			}
		})
	}
})
