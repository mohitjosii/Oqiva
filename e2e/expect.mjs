// A tiny stand-in for Playwright's expect, so these checks need only playwright-core.
const TIMEOUT = 8000

async function poll(check, describe) {
	const deadline = Date.now() + TIMEOUT
	let last = ""
	while (Date.now() < deadline) {
		try {
			if (await check()) return
		} catch (error) {
			last = error.message
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	throw new Error(`Timed out waiting for ${describe}${last ? ` (${last.split("\n")[0]})` : ""}`)
}

export function expect(subject) {
	return {
		toBeVisible: () => poll(() => subject.first().isVisible(), `${subject} to be visible`),
		toBeDisabled: () => poll(() => subject.first().isDisabled(), `${subject} to be disabled`),
		toHaveCount: (n) => poll(async () => (await subject.count()) === n, `${subject} to have count ${n}`),
		toHaveAttribute: (name, value) =>
			poll(async () => (await subject.getAttribute(name)) === value, `${subject} attribute ${name}=${value}`),
	}
}
