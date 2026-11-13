"""AI diagram generation endpoints."""

import frappe
from frappe.rate_limiter import rate_limit

from oqiva.api import current_user
from oqiva.constants import AI_RATE_LIMIT_PER_MINUTE
from oqiva.services import ai_service


@frappe.whitelist()
def status() -> dict:
	"""Whether diagram generation is switched on, so the editor can show or hide its entry point."""
	return ai_service.status(current_user())


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=AI_RATE_LIMIT_PER_MINUTE, seconds=60, methods=["POST"], ip_based=False, user_based=True)
def generate_diagram(prompt: str, kind: str = "flowchart", board: str | None = None) -> dict:
	"""Queue a diagram for a description. Returns the request to wait for; the answer arrives as a
	realtime event and can be read with ``result``."""
	return ai_service.request_diagram(current_user(), prompt, kind, board)


@frappe.whitelist()
def result(request_id: str) -> dict:
	"""Where a request stands: pending, done (with the description) or error."""
	return ai_service.result(current_user(), request_id)
