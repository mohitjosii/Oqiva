import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { copyText } from "./clipboard"

const setClipboard = (value) =>
	Object.defineProperty(globalThis.navigator, "clipboard", { value, configurable: true })

describe("copyText", () => {
	beforeEach(() => {
		document.body.innerHTML = ""
		document.execCommand = vi.fn(() => true)
	})
	afterEach(() => {
		setClipboard(undefined)
		delete document.execCommand
		vi.unstubAllGlobals()
	})

	it("uses the modern clipboard when the page may", async () => {
		const writeText = vi.fn().mockResolvedValue()
		setClipboard({ writeText })
		expect(await copyText("hello")).toBe(true)
		expect(writeText).toHaveBeenCalledWith("hello")
		expect(document.execCommand).not.toHaveBeenCalled()
	})

	it("falls back to the copy command on a plain http page, where there is no clipboard", async () => {
		setClipboard(undefined)
		expect(await copyText("http://10.0.0.5/oqiva/s/abc")).toBe(true)
		expect(document.execCommand).toHaveBeenCalledWith("copy")
		expect(document.querySelectorAll("textarea")).toHaveLength(0) // the hidden field is removed
	})

	it("falls back when the clipboard refuses", async () => {
		setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) })
		expect(await copyText("hello")).toBe(true)
		expect(document.execCommand).toHaveBeenCalledWith("copy")
	})

	it("treats a page that is not a secure context as having no clipboard", async () => {
		const writeText = vi.fn().mockResolvedValue()
		setClipboard({ writeText })
		vi.stubGlobal("isSecureContext", false)
		expect(await copyText("hello")).toBe(true)
		expect(writeText).not.toHaveBeenCalled()
		expect(document.execCommand).toHaveBeenCalled()
	})

	it("copies from a field already on the page, and leaves it there", async () => {
		const input = document.createElement("input")
		input.value = "the link"
		document.body.append(input)
		const select = vi.spyOn(input, "select")
		expect(await copyText("the link", input)).toBe(true)
		expect(select).toHaveBeenCalled()
		expect(document.body.contains(input)).toBe(true)
	})

	it("says so when nothing can copy", async () => {
		document.execCommand = vi.fn(() => false)
		expect(await copyText("hello")).toBe(false)
		document.execCommand = vi.fn(() => {
			throw new Error("blocked")
		})
		expect(await copyText("hello")).toBe(false)
		delete document.execCommand
		expect(await copyText("hello")).toBe(false)
	})

	it("puts the hidden field inside an open dialog and gives the focus back", async () => {
		const dialog = document.createElement("div")
		dialog.setAttribute("role", "dialog")
		const button = document.createElement("button")
		dialog.append(button)
		document.body.append(dialog)
		button.focus()
		let parent = null
		document.execCommand = vi.fn(() => {
			parent = document.querySelector("textarea")?.parentElement
			return true
		})
		await copyText("x")
		expect(parent).toBe(dialog)
		expect(document.activeElement).toBe(button)
	})
})
