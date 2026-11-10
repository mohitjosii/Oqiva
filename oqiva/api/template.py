"""Template endpoints. Creating a board from a template is ``board.create_board``."""

import frappe

from oqiva.api import current_user
from oqiva.services import template_service


@frappe.whitelist()
def list_templates(category: str | None = None, query: str | None = None) -> dict:
	"""Published templates, filtered by category and search text, with every category."""
	return template_service.list_templates(current_user(), category, query)


@frappe.whitelist()
def get_template(slug: str) -> dict:
	"""One published template's details and a small preview of its content."""
	return template_service.get_template(current_user(), slug)
