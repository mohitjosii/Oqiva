"""Resolve what a user is to a workspace, project or board.

Every function raises OqivaNotFound when the record is missing, trashed (unless
asked for), or the user has no relationship to it. Nothing here caches: access must
reflect the database on every request.
"""

import frappe

from oqiva.access.rules import SHARE_RANK, AccessContext
from oqiva.exceptions import OqivaNotFound


def share_level(read: int, write: int, comment: int) -> str | None:
	"""Map DocShare flags to a share level."""
	if write:
		return "edit"
	if comment:
		return "comment"
	return "view" if read else None


def best_share(*levels: str | None) -> str | None:
	"""The most permissive of several share levels."""
	live = [level for level in levels if level]
	return max(live, key=SHARE_RANK.__getitem__) if live else None


def docshare_level(user: str, board: str) -> str | None:
	"""The level a DocShare row gives ``user`` on ``board``."""
	fields = ["read", "write"]
	if frappe.get_meta("DocShare").has_field("comment"):
		fields.append("comment")
	row = frappe.db.get_value(
		"DocShare",
		{"share_doctype": "Oqiva Board", "share_name": board, "user": user},
		fields,
		as_dict=True,
	)
	if not row:
		return None
	return share_level(row.read, row.write, row.get("comment") or 0)


def live_link_level(user: str, board: str) -> str | None:
	"""The level a redeemed share link gives ``user``. Links arrive in Phase 5."""
	return None


def workspace_role(user: str, workspace: str) -> str | None:
	"""The user's role in a live workspace, or None."""
	return frappe.db.get_value("Oqiva Workspace Member", {"workspace": workspace, "user": user}, "role")


def workspace_context(user: str, workspace: str, include_deleted: bool = False) -> AccessContext:
	"""Context for a workspace. Non-members get OqivaNotFound."""
	row = frappe.db.get_value(
		"Oqiva Workspace",
		workspace,
		["owner_user", "personal_of", "is_deleted"],
		as_dict=True,
	)
	if not row or (row.is_deleted and not include_deleted):
		raise OqivaNotFound()
	role = workspace_role(user, workspace)
	if not role:
		raise OqivaNotFound()
	return AccessContext(
		user=user,
		role=role,
		is_owner=row.owner_user == user,
		is_personal=bool(row.personal_of),
	)


def project_context(
	user: str, project: str, include_trashed: bool = False
) -> tuple[AccessContext, frappe._dict]:
	"""Context and row for a project."""
	row = frappe.db.get_value(
		"Oqiva Project",
		project,
		["name", "workspace", "project_name", "is_trashed", "archived_on"],
		as_dict=True,
	)
	if not row or (row.is_trashed and not include_trashed):
		raise OqivaNotFound()
	return workspace_context(user, row.workspace), row


_BOARD_FIELDS = [
	"name",
	"workspace",
	"project",
	"title",
	"created_by_user",
	"is_trashed",
	"archived_on",
	"revision",
]


def board_context(user: str, board: str, include_trashed: bool = False) -> tuple[AccessContext, frappe._dict]:
	"""Context and row for a board.

	The caller needs a workspace role or a share. A Guest in the workspace with no
	share is treated as unrelated.
	"""
	row = frappe.db.get_value("Oqiva Board", board, _BOARD_FIELDS, as_dict=True)
	if not row or (row.is_trashed and not include_trashed):
		raise OqivaNotFound()
	workspace = frappe.db.get_value(
		"Oqiva Workspace", row.workspace, ["owner_user", "personal_of", "is_deleted"], as_dict=True
	)
	if not workspace or workspace.is_deleted:
		raise OqivaNotFound()
	role = workspace_role(user, row.workspace)
	share = best_share(docshare_level(user, board), live_link_level(user, board))
	ctx = AccessContext(
		user=user,
		role=role,
		share=share,
		is_creator=row.created_by_user == user,
		is_owner=workspace.owner_user == user,
		is_personal=bool(workspace.personal_of),
	)
	# A Guest with no share has no relationship to the board.
	if ctx.role_rank < 1 and ctx.share is None:
		raise OqivaNotFound()
	return ctx, row
