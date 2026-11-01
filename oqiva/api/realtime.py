"""Authorisation for the realtime relay (realtime/handlers.js)."""

import frappe

from oqiva.access import resolve
from oqiva.access.rules import access_level
from oqiva.api import current_user
from oqiva.exceptions import OqivaNotFound


@frappe.whitelist()
def authorize(board: str) -> dict:
	"""The caller's access to a board's live room: edit, comment, view, or None.

	The relay calls this as the connected user. A board the caller cannot see gives
	None, exactly like one that does not exist.
	"""
	try:
		ctx, _row = resolve.board_context(current_user(), board)
	except OqivaNotFound:
		return {"access": None}
	return {"access": access_level(ctx)}
