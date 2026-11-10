"""Pushing events to browsers through Frappe's realtime layer.

Every push waits for the transaction to commit (``after_commit=True``), so a browser never
hears about a change that was then rolled back.
"""

import frappe


def push_to_user(user: str, event: str, message: dict) -> None:
	frappe.publish_realtime(event, message, user=user, after_commit=True)


def push_to_board(board: str, event: str, message: dict) -> None:
	"""Tell everyone who has the board open. The relay's room is not reachable from Python, so
	this goes to a Frappe room named for the board, which the relay's clients also join."""
	frappe.publish_realtime(event, message, room=f"oqiva:board:{board}", after_commit=True)


def access_changed(user: str, board: str | None = None, workspace: str | None = None) -> None:
	"""Someone's access changed: their open boards re-check it and may drop to read-only."""
	push_to_user(user, "oqiva:access_changed", {"board": board, "workspace": workspace})


def resync(board: str) -> None:
	"""Everyone with the board open should fetch it again: it changed in a way no live update carries
	(the server restored it, or a save too large for the live link went over HTTP)."""
	push_to_board(board, "oqiva:resync", {"board": board})
