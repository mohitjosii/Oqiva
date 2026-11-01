"""Search endpoint."""

import frappe

from oqiva.api import current_user
from oqiva.services import search_service


@frappe.whitelist()
def query(text: str, limit: int = 20) -> dict:
	"""Boards and projects the caller can see that match ``text``."""
	return search_service.query(current_user(), text, limit)
