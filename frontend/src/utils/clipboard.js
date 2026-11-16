// Copies text to the clipboard.
//
// The modern clipboard needs a secure page: https, or localhost. A site opened by plain http at an
// address on a private network (http://192.168.1.50/oqiva) has no ``navigator.clipboard`` at all, so
// "Copy" would always fail there. In that case the text is put in a field, selected, and copied with
// the older copy command, which still works on such pages.
//
// ``field`` is an input already on the page that holds the text (preferred inside a dialog, where
// focus must stay put); without one, a hidden field is made and removed.
export async function copyText(text, field = null, doc = globalThis.document) {
	try {
		const clip = globalThis.navigator?.clipboard
		if (clip?.writeText && globalThis.isSecureContext !== false) {
			await clip.writeText(text)
			return true
		}
	} catch {
		// refused (permission, or an unfocused page): try the older way
	}
	return legacyCopy(text, field, doc)
}

function legacyCopy(text, field, doc) {
	if (!doc?.execCommand) return false
	const own = !field
	const el = field || doc.createElement("textarea")
	const before = doc.activeElement
	if (own) {
		el.value = text
		el.setAttribute("readonly", "")
		el.setAttribute("aria-hidden", "true")
		el.style.cssText =
			"position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none"
		// inside the open dialog if there is one, so the dialog does not take the focus back
		;(before?.closest?.('[role="dialog"]') || doc.body).appendChild(el)
	}
	try {
		el.focus()
		el.select()
		el.setSelectionRange?.(0, String(el.value).length)
		return Boolean(doc.execCommand("copy"))
	} catch {
		return false
	} finally {
		if (own) el.remove()
		before?.focus?.()
	}
}
