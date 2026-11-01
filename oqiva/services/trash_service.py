"""Scheduled clean-up: expired trash and old board views."""

import frappe
from frappe.utils import add_days, now_datetime

from oqiva.services import board_service
from oqiva.utils.settings import get_setting

BATCH = 500
VIEW_RETENTION_DAYS = 90


def purge_expired_trash() -> None:
	"""Delete boards and projects that have sat in Trash past the retention period."""
	cutoff = add_days(now_datetime(), -int(get_setting("trash_retention_days")))
	boards = frappe.get_all(
		"Oqiva Board", filters={"is_trashed": 1, "trashed_on": ["<", cutoff]}, pluck="name", limit=BATCH
	)
	for board in boards:
		board_service.delete_board_records(board)
	projects = frappe.get_all(
		"Oqiva Project", filters={"is_trashed": 1, "trashed_on": ["<", cutoff]}, pluck="name", limit=BATCH
	)
	for project in projects:
		delete_project_records(project)
	frappe.db.commit()  # nosemgrep -- a scheduled job owns its transaction


def delete_project_records(project: str) -> None:
	"""Delete a project. Boards still pointing at it move to the workspace root."""
	frappe.db.set_value("Oqiva Board", {"project": project}, "project", None, update_modified=False)
	frappe.db.set_value(
		"Oqiva Board", {"trashed_with_project": project}, "trashed_with_project", None, update_modified=False
	)
	frappe.delete_doc(
		"Oqiva Project",
		project,
		ignore_permissions=True,
		force=True,
		delete_permanently=True,
		flags={"oqiva_service": True},
	)


def prune_board_views() -> None:
	"""Forget board views older than the retention period."""
	cutoff = add_days(now_datetime(), -VIEW_RETENTION_DAYS)
	frappe.db.delete("Oqiva Board View", {"last_opened_on": ["<", cutoff]})
	frappe.db.commit()  # nosemgrep -- a scheduled job owns its transaction
