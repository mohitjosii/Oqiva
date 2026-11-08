// Getting a finished file to the person: a download, or the browser's print dialog.

export function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob)
	const link = document.createElement("a")
	link.href = url
	link.download = filename
	link.style.display = "none"
	document.body.append(link)
	link.click()
	link.remove()
	setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const escapeHtml = (text) =>
	String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// Prints the board alone: it goes into a hidden frame, so none of the app's own screen is
// on the page.
export function printSvg(svg, title) {
	const frame = document.createElement("iframe")
	frame.setAttribute("aria-hidden", "true")
	frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"
	document.body.append(frame)
	const doc = frame.contentDocument
	doc.open()
	doc.write(
		`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
			"<style>@page{margin:10mm}html,body{margin:0;background:#fff}svg{display:block;max-width:100%;height:auto}</style>" +
			`</head><body>${svg}</body></html>`,
	)
	doc.close()
	const clean = () => setTimeout(() => frame.remove(), 1000)
	frame.contentWindow.addEventListener("afterprint", clean)
	setTimeout(() => frame.remove(), 120_000) // some browsers never report that printing has finished
	setTimeout(() => {
		frame.contentWindow.focus()
		frame.contentWindow.print()
	}, 150)
}
