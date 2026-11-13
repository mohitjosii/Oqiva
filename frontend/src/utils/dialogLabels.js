// frappe-ui's dialogs have a close button that is only an "x" icon, with no name a screen reader can say.
// Every dialog in the app is one of them, so this names that button for all of them, as each opens.

const CLOSE_LABEL = "Close"

function nameCloseButtons(root) {
	const dialogs = root.matches?.("[role='dialog']")
		? [root]
		: [...(root.querySelectorAll?.("[role='dialog']") ?? [])]
	for (const dialog of dialogs)
		for (const button of dialog.querySelectorAll("button")) {
			const named =
				button.textContent.trim() ||
				button.getAttribute("aria-label") ||
				button.getAttribute("title")
			if (!named && button.querySelector("svg"))
				button.setAttribute("aria-label", CLOSE_LABEL)
		}
}

export function labelDialogButtons(target = document.body) {
	if (typeof MutationObserver === "undefined") return null
	const observer = new MutationObserver((records) => {
		for (const record of records)
			for (const node of record.addedNodes) if (node.nodeType === 1) nameCloseButtons(node)
	})
	observer.observe(target, { childList: true, subtree: true })
	nameCloseButtons(target)
	return observer
}
