import { confirmDialog, toast } from "frappe-ui"
import { reactive } from "vue"
import { useRouter } from "vue-router"
import { api } from "@/data/api"
import { reloadProjects } from "@/data/projects"
import { messageFor } from "@/utils/errors"

// Everything a board tile's menu can do. Simple actions run straight away; the ones
// that need input (edit, move, permanent delete) open a dialog that the page renders
// with <BoardActionDialogs :actions="actions" />.
export function useBoardActions(onChanged = () => {}) {
	const router = useRouter()
	const dialog = reactive({ type: null, board: null })

	function open(type, board) {
		dialog.type = type
		dialog.board = board
	}

	function close() {
		dialog.type = null
		dialog.board = null
	}

	async function attempt(work, success) {
		try {
			const result = await work()
			if (success) toast.success(success)
			await onChanged()
			return result
		} catch (error) {
			toast.error(messageFor(error))
			return undefined
		}
	}

	const handlers = {
		open: (board) => router.push({ name: "board", params: { board: board.name } }),
		edit: (board) => open("edit", board),
		move: (board) => open("move", board),
		purge: (board) => open("purge", board),
		favorite: (board) =>
			attempt(() =>
				api("board.set_favorite", { board: board.name, favorite: !board.is_favorite }),
			),
		duplicate: (board) =>
			attempt(() => api("board.duplicate_board", { board: board.name }), "Board duplicated"),
		archive: (board) =>
			attempt(
				() => api("board.archive_board", { board: board.name, archived: true }),
				"Board archived",
			),
		unarchive: (board) =>
			attempt(
				() => api("board.archive_board", { board: board.name, archived: false }),
				"Board restored from the archive",
			),
		restore: (board) =>
			attempt(() => api("board.restore_board", { board: board.name }), "Board restored"),
		trash: (board) =>
			confirmDialog({
				title: "Move to Trash?",
				message: `"${board.title}" will move to Trash. You can restore it from there.`,
				onConfirm: ({ hideDialog }) => {
					hideDialog()
					return attempt(
						() => api("board.trash_board", { board: board.name }),
						"Moved to Trash",
					)
				},
			}),
	}

	function run(type, board) {
		return handlers[type]?.(board)
	}

	// Used by the dialogs, which close themselves on success.
	async function submit(work, success) {
		const result = await attempt(work, success)
		if (result !== undefined) {
			close()
			reloadProjects()
		}
		return result
	}

	return { dialog, run, close, submit }
}

export function menuFor(board, scope) {
	const caps = board.capabilities || {}
	if (scope === "trash") {
		return [
			{ type: "restore", label: "Restore", icon: "rotate-ccw", show: caps.can_trash },
			{
				type: "purge",
				label: "Delete permanently",
				icon: "trash-2",
				theme: "red",
				show: caps.can_trash,
			},
		].filter((item) => item.show)
	}
	return [
		{ type: "open", label: "Open", icon: "external-link", show: true },
		{
			type: "favorite",
			label: board.is_favorite ? "Remove from favorites" : "Add to favorites",
			icon: "star",
			show: true,
		},
		{ type: "edit", label: "Rename or describe", icon: "edit-2", show: caps.can_rename },
		{ type: "duplicate", label: "Duplicate", icon: "copy", show: caps.can_duplicate },
		{ type: "move", label: "Move to project", icon: "folder", show: caps.can_move },
		{
			type: board.archived_on ? "unarchive" : "archive",
			label: board.archived_on ? "Unarchive" : "Archive",
			icon: "archive",
			show: caps.can_trash,
		},
		{
			type: "trash",
			label: "Move to Trash",
			icon: "trash-2",
			theme: "red",
			show: caps.can_trash,
		},
	].filter((item) => item.show)
}
