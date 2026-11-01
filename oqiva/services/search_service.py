"""Search across the boards and projects a user can see."""

import frappe

from oqiva.utils.text import clean_line

MIN_LENGTH = 2
MAX_LENGTH = 100
BOARD_FIELDS = ["name", "title", "description", "workspace", "project", "modified"]
PROJECT_FIELDS = ["name", "project_name", "description", "workspace", "color", "icon"]


def _like(text: str) -> str:
	"""A LIKE pattern matching ``text`` literally: %, _ and \\ are escaped."""
	escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
	return f"%{escaped}%"


def query(user: str, text: str, limit: int = 20) -> dict:
	"""Boards and projects matching ``text``.

	The query goes through frappe.get_list, so the caller's workspace and share
	scope is applied before anything is matched. Nothing outside it can appear.
	"""
	term = clean_line(text, "Search", MAX_LENGTH, required=False) or ""
	if len(term) < MIN_LENGTH:
		return {"boards": [], "projects": []}
	limit = max(1, min(int(limit), 50))
	pattern = _like(term)
	boards = frappe.get_list(
		"Oqiva Board",
		user=user,
		filters={"is_trashed": 0},
		or_filters=[["title", "like", pattern], ["description", "like", pattern]],
		fields=BOARD_FIELDS,
		order_by="modified desc",
		limit_page_length=limit,
	)
	projects = frappe.get_list(
		"Oqiva Project",
		user=user,
		filters={"is_trashed": 0},
		or_filters=[["project_name", "like", pattern], ["description", "like", pattern]],
		fields=PROJECT_FIELDS,
		order_by="modified desc",
		limit_page_length=limit,
	)
	return {"boards": boards, "projects": projects}
