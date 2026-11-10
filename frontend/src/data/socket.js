import { initSocket } from "frappe-ui"

// One socket for the page, shared by every board opened in it. If it cannot be made, boards
// still work: they just are not live.
let socket
export function getSocket() {
	if (socket === undefined) {
		try {
			socket = initSocket({ port: window.frappe?.boot?.socketio_port })
		} catch {
			socket = null
		}
	}
	return socket
}
