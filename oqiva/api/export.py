"""Export endpoint."""

import frappe

from oqiva.api import current_user
from oqiva.services import export_service
from oqiva.utils.rate_limit import rate_limit


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=20, seconds=60, methods=["POST"], ip_based=False, user_based=True)
def prepare(board: str, format: str, scope: str = "board") -> dict:
	"""Check that the caller may export, record it, and return a safe file name."""
	return export_service.prepare(current_user(), board, format, scope)


@frappe.whitelist()
@rate_limit(limit=20, seconds=60, methods=["GET", "POST"], ip_based=False, user_based=True)
def board_file(board: str) -> dict:
	"""A board as an ``.oqiva.json`` file: its name and its text."""
	return export_service.board_file(current_user(), board)
