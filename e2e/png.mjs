// A small solid-colour PNG made on the spot, so the browser checks need no picture files.
import { deflateSync } from "node:zlib"

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})
const crc32 = (buffer) => {
	let c = 0xffffffff
	for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
	const body = Buffer.concat([Buffer.from(type), data])
	const out = Buffer.alloc(body.length + 8)
	out.writeUInt32BE(data.length, 0)
	body.copy(out, 4)
	out.writeUInt32BE(crc32(body), body.length + 4)
	return out
}

export function makePng(width, height, [r, g, b]) {
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
	const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())])
	const raw = Buffer.concat(Array.from({ length: height }, () => row))
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	])
}
