"""Projects: create, edit, archive, trash, restore."""

import frappe
from frappe import _
from frappe.query_builder.functions import Count
from frappe.utils import now_datetime

from oqiva.access import require, resolve
from oqiva.access.guard import service_write
from oqiva.constants import PROJECT_COLORS
from oqiva.exceptions import OqivaError

_FIELDS = [
	"name",
	"workspace",
	"project_name",
	"description",
	"color",
	"icon",
	"archived_on",
	"is_trashed",
	"trashed_on",
	"modified",
]


def _check_color(color: str) -> str:
	if color not in PROJECT_COLORS:
		raise OqivaError(_("Choose one of the available colours."))
	return color


def list_projects(user: str, workspace: str, include_archived: bool = False) -> list[dict]:
	"""Live projects of a workspace the user belongs to, with board counts."""
	ctx = resolve.workspace_context(user, workspace)
	require(ctx, "project:view")
	filters = {"workspace": workspace, "is_trashed": 0}
	if not include_archived:
		filters["archived_on"] = ["is", "not set"]
	rows = frappe.get_all(
		"Oqiva Project", filters=filters, fields=_FIELDS, order_by="project_name asc", limit_page_length=0
	)
	counts = {}
	if rows and ctx.role_rank >= 1:  # a Guest is not told how many boards they cannot see
		board = frappe.qb.DocType("Oqiva Board")
		counts = dict(
			frappe.qb.from_(board)
			.select(board.project, Count(board.name))
			.where(board.project.isin([r.name for r in rows]) & (board.is_trashed == 0))
			.groupby(board.project)
			.run()
		)
	return [{**r, "board_count": counts.get(r.name, 0)} for r in rows]


def get_project(user: str, project: str) -> dict:
	"""One project the user can see."""
	ctx, row = resolve.project_context(user, project)
	require(ctx, "project:view")
	return frappe.db.get_value("Oqiva Project", row.name, _FIELDS, as_dict=True)


def create_project(
	user: str, workspace: str, project_name: str, description: str | None, color: str, icon: str | None
) -> dict:
	"""Create a project. Members and above."""
	ctx = resolve.workspace_context(user, workspace)
	require(ctx, "project:create")
	doc = service_write(frappe.new_doc("Oqiva Project"))
	doc.update(
		{
			"workspace": workspace,
			"project_name": project_name,
			"description": description,
			"color": _check_color(color),
			"icon": icon,
			"created_by_user": user,
		}
	)
	doc.insert(ignore_permissions=True)
	return get_project(user, doc.name)


def update_project(
	user: str,
	project: str,
	project_name: str | None = None,
	description: str | None = None,
	color: str | None = None,
	icon: str | None = None,
) -> dict:
	"""Edit a project. ``None`` leaves a field unchanged; an empty string clears it."""
	ctx, row = resolve.project_context(user, project)
	require(ctx, "project:update")
	doc = service_write(frappe.get_doc("Oqiva Project", row.name))
	if project_name is not None:
		doc.project_name = project_name
	if description is not None:
		doc.description = description
	if color is not None:
		doc.color = _check_color(color)
	if icon is not None:
		doc.icon = icon
	doc.save(ignore_permissions=True)
	return get_project(user, doc.name)


def set_archived(user: str, project: str, archived: bool) -> dict:
	"""Archive or unarchive a project."""
	ctx, row = resolve.project_context(user, project)
	require(ctx, "project:archive")
	frappe.db.set_value("Oqiva Project", row.name, "archived_on", now_datetime() if archived else None)
	return get_project(user, row.name)


def trash_project(user: str, project: str) -> dict:
	"""Move a project to Trash together with its live boards.

	Each board is marked with the project so a restore brings back exactly those.
	"""
	ctx, row = resolve.project_context(user, project)
	require(ctx, "project:trash")
	now = now_datetime()
	frappe.db.set_value("Oqiva Project", row.name, {"is_trashed": 1, "trashed_on": now})
	frappe.db.set_value(
		"Oqiva Board",
		{"project": row.name, "is_trashed": 0},
		{"is_trashed": 1, "trashed_on": now, "trashed_with_project": row.name},
	)
	return {"name": row.name}


def restore_project(user: str, project: str) -> dict:
	"""Restore a trashed project and the boards that were trashed with it."""
	ctx, row = resolve.project_context(user, project, include_trashed=True)
	require(ctx, "project:restore")
	frappe.db.set_value("Oqiva Project", row.name, {"is_trashed": 0, "trashed_on": None})
	frappe.db.set_value(
		"Oqiva Board",
		{"trashed_with_project": row.name},
		{"is_trashed": 0, "trashed_on": None, "trashed_with_project": None},
	)
	return get_project(user, row.name)
