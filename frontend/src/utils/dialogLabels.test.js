import { describe, expect, it } from "vitest"
import { labelDialogButtons } from "./dialogLabels"

const dialog = (html) => {
	const el = document.createElement("div")
	el.setAttribute("role", "dialog")
	el.innerHTML = html
	return el
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("naming the close button of a dialog", () => {
	it("names an icon-only button in a dialog that opens later, and leaves named ones alone", async () => {
		const host = document.createElement("div")
		document.body.append(host)
		const observer = labelDialogButtons(host)
		const open = dialog(
			'<button id="x"><svg></svg></button><button id="ok">Save</button><button id="l" aria-label="Back"><svg></svg></button><button id="t" title="Help"><svg></svg></button>',
		)
		host.append(open)
		await flush()
		expect(open.querySelector("#x").getAttribute("aria-label")).toBe("Close")
		expect(open.querySelector("#ok").hasAttribute("aria-label")).toBe(false)
		expect(open.querySelector("#l").getAttribute("aria-label")).toBe("Back")
		expect(open.querySelector("#t").hasAttribute("aria-label")).toBe(false)
		observer.disconnect()
	})

	it("does not touch buttons outside dialogs", async () => {
		const host = document.createElement("div")
		document.body.append(host)
		const observer = labelDialogButtons(host)
		host.innerHTML = '<button id="y"><svg></svg></button>'
		await flush()
		expect(host.querySelector("#y").hasAttribute("aria-label")).toBe(false)
		observer.disconnect()
	})
})
