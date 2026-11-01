// Stable ids for objects and saves. Not secret: they only need to be unique and safe to
// use in a URL, a DOM id and a Python dict key (letters, digits, _ and -).

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

export function newId(length = 12) {
	const bytes = new Uint8Array(length)
	globalThis.crypto.getRandomValues(bytes)
	let id = ""
	for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length]
	return id
}

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
