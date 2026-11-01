"""Boards: create, list, edit, move, duplicate, archive, trash, restore, purge."""

import frappe
from frappe import _
from frappe.utils import now_datetime

from oqiva.access import require, resolve
from oqiva.access.guard import service_write
from oqiva.access.rules import ROLE_RANK, AccessContext, capabilities
from oqiva.constants import BOARD_CHILD_DOCTYPES, BOARD_DOCTYPE
from oqiva.exceptions import OqivaConflict, OqivaError, OqivaForbidden, OqivaLimitExceeded
from oqiva.utils.settings import get_setting
from oqiva.utils.text import clean_line

LIST_FIELDS = [
	"name",
	"title",
	"description",
	"workspace",
	"project",
	"modified",
	"creation",
	"thumbnail",
	"object_count",
	"archived_on",
	"is_trashed",
	"trashed_on",
	"has_active_link",
	"created_by_user",
	"last_opened_on",
]
MAX_PAGE = 100
SCOPES = ("all", "recent", "favorites", "shared", "trash", "archived")


# ---------------------------------------------------------------------------
# reading
# ---------------------------------------------------------------------------


def _share_fields() -> list[str]:
	fields = ["share_name", "read", "write"]
	if frappe.get_meta("DocShare").has_field("comment"):
		fields.append("comment")
	return fields


def _decorate(user: str, rows: list) -> list[dict]:
	"""Add project, favourite, creator and capability data to board rows in bulk."""
	if not rows:
		return []
	names = [r.name for r in rows]
	workspaces = list({r.workspace for r in rows})
	roles = {
		m.workspace: m.role
		for m in frappe.get_all(
			"Oqiva Workspace Member",
			filters={"user": user, "workspace": ["in", workspaces]},
			fields=["workspace", "role"],
			limit_page_length=0,
		)
	}
	shares = {
		s.share_name: resolve.share_level(s.read, s.write, s.get("comment") or 0)
		for s in frappe.get_all(
			"DocShare",
			filters={"share_doctype": BOARD_DOCTYPE, "user": user, "share_name": ["in", names]},
			fields=_share_fields(),
			limit_page_length=0,
		)
	}
	favorites = set(
		frappe.get_all("Oqiva Favorite", filters={"user": user, "board": ["in", names]}, pluck="board")
	)
	project_ids = list({r.project for r in rows if r.project})
	projects = {
		p.name: p
		for p in frappe.get_all(
			"Oqiva Project",
			filters={"name": ["in", project_ids]},
			fields=["name", "project_name", "color", "icon"],
			limit_page_length=0,
		)
	}
	creators = {
		u.name: u.full_name
		for u in frappe.get_all(
			"User",
			filters={"name": ["in", list({r.created_by_user for r in rows if r.created_by_user})]},
			fields=["name", "full_name"],
			limit_page_length=0,
		)
	}
	result = []
	for row in rows:
		ctx = AccessContext(
			user=user,
			role=roles.get(row.workspace),
			share=shares.get(row.name),
			is_creator=row.created_by_user == user,
		)
		project = projects.get(row.project)
		result.append(
			{
				**row,
				"workspace_role": ctx.role,
				"project_name": project.project_name if project else None,
				"project_color": project.color if project else None,
				"is_favorite": row.name in favorites,
				"creator_name": creators.get(row.created_by_user),
				"capabilities": capabilities(ctx),
			}
		)
	return result


def _page(limit: int, start: int) -> tuple[int, int]:
	return max(1, min(int(limit), MAX_PAGE)), max(0, int(start))


def _fetch(user: str, filters: dict, order_by: str, limit: int, start: int) -> dict:
	"""Permission-applied board query with one extra row to detect another page."""
	rows = frappe.get_list(
		BOARD_DOCTYPE,
		user=user,
		filters=filters,
		fields=LIST_FIELDS,
		order_by=order_by,
		limit_start=start,
		limit_page_length=limit + 1,
	)
	return {"boards": _decorate(user, rows[:limit]), "has_more": len(rows) > limit}


def _names_from(rows: list[str], limit: int, start: int) -> list[str]:
	return rows[start : start + limit + 1]


def list_boards(
	user: str,
	scope: str = "all",
	workspace: str | None = None,
	project: str | None = None,
	limit: int = 24,
	start: int = 0,
) -> dict:
	"""Boards the user may see, for one home-area view."""
	if scope not in SCOPES:
		raise OqivaError(_("Unknown board list."))
	limit, start = _page(limit, start)
	if scope == "shared":
		return _list_shared(user, limit, start)
	if not workspace:
		raise OqivaError(_("Choose a workspace."))
	ctx = resolve.workspace_context(user, workspace)
	base = {"workspace": workspace, "is_trashed": 0, "archived_on": ["is", "not set"]}
	if scope == "trash":
		if ctx.role_rank < 1:
			raise OqivaForbidden()
		return _fetch(user, {"workspace": workspace, "is_trashed": 1}, "trashed_on desc", limit, start)
	if scope == "archived":
		filters = {"workspace": workspace, "is_trashed": 0, "archived_on": ["is", "set"]}
		return _fetch(user, filters, "archived_on desc", limit, start)
	if scope == "recent":
		return _list_ordered_by_user_rows(user, "Oqiva Board View", "last_opened_on desc", base, limit, start)
	if scope == "favorites":
		return _list_ordered_by_user_rows(user, "Oqiva Favorite", "creation desc", base, limit, start)
	if project:
		base["project"] = project
	return _fetch(user, base, "modified desc", limit, start)


def _list_ordered_by_user_rows(
	user: str, doctype: str, order_by: str, base: dict, limit: int, start: int
) -> dict:
	"""Boards listed in the order of the user's own view or favourite rows."""
	ordered = frappe.get_all(
		doctype, filters={"user": user}, pluck="board", order_by=order_by, limit_page_length=500
	)
	if not ordered:
		return {"boards": [], "has_more": False}
	rows = frappe.get_list(
		BOARD_DOCTYPE,
		user=user,
		filters={**base, "name": ["in", ordered]},
		fields=LIST_FIELDS,
		limit_page_length=0,
	)
	position = {name: i for i, name in enumerate(ordered)}
	rows.sort(key=lambda r: position[r.name])
	page = rows[start : start + limit + 1]
	return {"boards": _decorate(user, page[:limit]), "has_more": len(page) > limit}


def _list_shared(user: str, limit: int, start: int) -> dict:
	"""Boards shared with the user in workspaces where they are not a Member."""
	names = frappe.get_all(
		"DocShare",
		filters={"share_doctype": BOARD_DOCTYPE, "user": user, "read": 1},
		pluck="share_name",
		limit_page_length=0,
	)
	if not names:
		return {"boards": [], "has_more": False}
	rows = frappe.get_list(
		BOARD_DOCTYPE,
		user=user,
		filters={"name": ["in", names], "is_trashed": 0},
		fields=LIST_FIELDS,
		order_by="modified desc",
		limit_page_length=0,
	)
	decorated = [
		r
		for r in _decorate(user, rows)
		if ROLE_RANK.get(r["workspace_role"], -1) < 1 and r["created_by_user"] != user
	]
	page = decorated[start : start + limit + 1]
	return {"boards": page[:limit], "has_more": len(page) > limit}


def get_board(user: str, board: str) -> dict:
	"""One board's details and what the user may do with it."""
	ctx, row = resolve.board_context(user, board, include_trashed=True)
	require(ctx, "board:view")
	fields = [*LIST_FIELDS, "revision", "schema_version"]
	data = frappe.db.get_value(BOARD_DOCTYPE, row.name, fields, as_dict=True)
	detail = _decorate(user, [data])[0]
	detail["revision"] = data.revision
	detail["workspace_name"] = frappe.db.get_value("Oqiva Workspace", data.workspace, "workspace_name")
	return detail


def open_board(user: str, board: str) -> dict:
	"""Record that the user opened a board, then return it."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:view")
	now = now_datetime()
	view = frappe.db.get_value("Oqiva Board View", {"board": row.name, "user": user}, "name")
	if view:
		frappe.db.set_value("Oqiva Board View", view, "last_opened_on", now, update_modified=False)
	else:
		doc = service_write(frappe.new_doc("Oqiva Board View"))
		doc.update({"board": row.name, "user": user, "last_opened_on": now})
		try:
			frappe.db.savepoint("oqiva_board_view")
			doc.insert(ignore_permissions=True)
		except frappe.UniqueValidationError:
			frappe.db.rollback(save_point="oqiva_board_view")
	frappe.db.set_value(BOARD_DOCTYPE, row.name, "last_opened_on", now, update_modified=False)
	return get_board(user, row.name)


# ---------------------------------------------------------------------------
# writing
# ---------------------------------------------------------------------------


def _assert_project(workspace: str, project: str | None) -> None:
	if not project:
		return
	found = frappe.db.get_value("Oqiva Project", project, ["workspace", "is_trashed"], as_dict=True)
	if not found or found.workspace != workspace or found.is_trashed:
		raise OqivaError(_("That project is not available in this workspace."))


def _assert_room(workspace: str) -> None:
	live = frappe.db.count(BOARD_DOCTYPE, {"workspace": workspace, "is_trashed": 0})
	if live >= get_setting("max_boards_per_workspace"):
		raise OqivaLimitExceeded(_("This workspace has reached its board limit."))


def _insert_board(
	user: str, workspace: str, project: str | None, title: str, document: str, description: str | None = None
) -> str:
	from oqiva.constants import empty_document_json

	doc = service_write(frappe.new_doc(BOARD_DOCTYPE))
	doc.update(
		{
			"workspace": workspace,
			"project": project,
			"title": title,
			"description": description,
			"document": document or empty_document_json(),
			"revision": 1,
			"schema_version": 1,
			"created_by_user": user,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def create_board(user: str, workspace: str, project: str | None = None, title: str | None = None) -> dict:
	"""Create an empty board. Members and above."""
	ctx = resolve.workspace_context(user, workspace)
	require(ctx, "board:create")
	_assert_project(workspace, project)
	_assert_room(workspace)
	name = clean_line(title or _("Untitled board"), _("Board name"), 120)
	return get_board(user, _insert_board(user, workspace, project, name, ""))


def update_board(user: str, board: str, title: str | None = None, description: str | None = None) -> dict:
	"""Rename a board or change its description. ``None`` leaves a field unchanged."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:rename")
	doc = service_write(frappe.get_doc(BOARD_DOCTYPE, row.name))
	if title is not None:
		doc.title = title
	if description is not None:
		doc.description = description
	doc.save(ignore_permissions=True)
	return get_board(user, row.name)


def move_board(user: str, board: str, project: str | None = None) -> dict:
	"""Move a board to a project, or to the workspace root when ``project`` is empty."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:move")
	_assert_project(row.workspace, project)
	frappe.db.set_value(BOARD_DOCTYPE, row.name, "project", project or None)
	return get_board(user, row.name)


def duplicate_board(user: str, board: str) -> dict:
	"""Copy a board's content into a new board in the same place."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:duplicate")
	_assert_room(row.workspace)
	source = frappe.db.get_value(BOARD_DOCTYPE, row.name, ["document", "description"], as_dict=True)
	title = clean_line(_("Copy of {0}").format(row.title)[:120], _("Board name"), 120)
	name = _insert_board(user, row.workspace, row.project, title, source.document, source.description)
	return get_board(user, name)


def set_archived(user: str, board: str, archived: bool) -> dict:
	"""Archive or unarchive a board."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:archive")
	frappe.db.set_value(BOARD_DOCTYPE, row.name, "archived_on", now_datetime() if archived else None)
	return get_board(user, row.name)


def trash_board(user: str, board: str) -> dict:
	"""Move a board to Trash."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:trash")
	frappe.db.set_value(
		BOARD_DOCTYPE,
		row.name,
		{"is_trashed": 1, "trashed_on": now_datetime(), "trashed_with_project": None},
	)
	return {"name": row.name}


def restore_board(user: str, board: str) -> dict:
	"""Restore a trashed board. If its project is trashed it returns to the workspace root."""
	ctx, row = resolve.board_context(user, board, include_trashed=True)
	require(ctx, "board:restore")
	values = {"is_trashed": 0, "trashed_on": None, "trashed_with_project": None}
	if row.project and frappe.db.get_value("Oqiva Project", row.project, "is_trashed"):
		values["project"] = None
	frappe.db.set_value(BOARD_DOCTYPE, row.name, values)
	return get_board(user, row.name)


def purge_board(user: str, board: str, confirm_title: str) -> dict:
	"""Delete a trashed board for good. The caller must type its name."""
	ctx, row = resolve.board_context(user, board, include_trashed=True)
	require(ctx, "board:purge")
	if not row.is_trashed:
		raise OqivaConflict(_("Move this board to Trash before deleting it permanently."))
	if (confirm_title or "").strip() != row.title:
		raise OqivaError(_("Type the board name to confirm."))
	delete_board_records(row.name)
	return {"name": row.name}


def delete_board_records(board: str) -> None:
	"""Delete a board and every row that points at it."""
	for doctype, link_field in BOARD_CHILD_DOCTYPES:
		if frappe.db.table_exists(doctype):
			frappe.db.delete(doctype, {link_field: board})
	frappe.db.delete("DocShare", {"share_doctype": BOARD_DOCTYPE, "share_name": board})
	frappe.delete_doc(
		BOARD_DOCTYPE,
		board,
		ignore_permissions=True,
		force=True,
		delete_permanently=True,
		flags={"oqiva_service": True},
	)


def set_favorite(user: str, board: str, favorite: bool) -> dict:
	"""Star or unstar a board for the user."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:favourite")
	existing = frappe.db.get_value("Oqiva Favorite", {"user": user, "board": row.name}, "name")
	if favorite and not existing:
		doc = service_write(frappe.new_doc("Oqiva Favorite"))
		doc.update({"user": user, "board": row.name})
		try:
			frappe.db.savepoint("oqiva_favorite")
			doc.insert(ignore_permissions=True)
		except frappe.UniqueValidationError:
			frappe.db.rollback(save_point="oqiva_favorite")
	elif not favorite and existing:
		frappe.db.delete("Oqiva Favorite", {"name": existing})
	return {"name": row.name, "is_favorite": bool(favorite)}
