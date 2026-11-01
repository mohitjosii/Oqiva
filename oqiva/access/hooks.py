"""Frappe permission hooks.

Hooks can only deny: the DocPerm layer must allow first. Oqiva User gets read on the
doctypes, and these functions narrow that to what the rules table allows. Writes
never reach a role check, because services write with ignore_permissions after
checking the rules themselves, and the controllers refuse any other write.
"""

import frappe

from oqiva.access.rules import may
from oqiva.exceptions import OqivaNotFound

BOARD_ACTIONS = {
	"read": "board:view",
	"export": "board:export",
	"print": "board:view",
	"report": "board:view",
	"write": "board:edit",
	"comment": "comment:create",
	"share": "board:share",
	"delete": "board:purge",
}

READ_ONLY_PTYPES = ("read", "report", "export", "print")


def _is_unrestricted(user: str) -> bool:
	return user == "Administrator"


def _member_workspaces_sql(user: str, roles: tuple[str, ...]) -> str:
	"""SQL selecting the live workspaces in which ``user`` holds one of ``roles``."""
	role_list = ", ".join(frappe.db.escape(role) for role in roles)
	return (
		"select m.workspace from `tabOqiva Workspace Member` m "
		"inner join `tabOqiva Workspace` w on w.name = m.workspace "
		"where m.user = {user} and w.is_deleted = 0 and m.role in ({roles})"
	).format(user=frappe.db.escape(user), roles=role_list)


def board_has_permission(doc, ptype=None, user=None, debug=False):
	"""Deny a board operation the rules table does not allow."""
	from oqiva.access import resolve

	user = user or frappe.session.user
	if _is_unrestricted(user):
		return True
	if user == "Guest":
		return False
	if doc.is_new():
		return resolve.workspace_role(user, doc.workspace) in ("Owner", "Admin", "Member")
	action = BOARD_ACTIONS.get(ptype)
	if not action:
		return False
	try:
		ctx, _row = resolve.board_context(user, doc.name, include_trashed=True)
	except OqivaNotFound:
		return False
	return may(ctx, action)


def _member_only(workspace: str | None, ptype: str | None, user: str | None) -> bool:
	from oqiva.access import resolve

	user = user or frappe.session.user
	if _is_unrestricted(user):
		return True
	if user == "Guest" or ptype not in READ_ONLY_PTYPES or not workspace:
		return False
	return resolve.workspace_role(user, workspace) is not None


def workspace_has_permission(doc, ptype=None, user=None, debug=False):
	"""Members may read their workspace. Writes go through services."""
	return _member_only(doc.name, ptype, user)


def workspace_member_has_permission(doc, ptype=None, user=None, debug=False):
	"""Members may read the member list of their workspace."""
	return _member_only(doc.workspace, ptype, user)


def project_has_permission(doc, ptype=None, user=None, debug=False):
	"""Members, guests included, may read the projects of their workspace."""
	return _member_only(doc.workspace, ptype, user)


def own_row_has_permission(doc, ptype=None, user=None, debug=False):
	"""A user reads only their own favourites and board views."""
	user = user or frappe.session.user
	if _is_unrestricted(user):
		return True
	return ptype in READ_ONLY_PTYPES and doc.user == user


def invite_has_permission(doc, ptype=None, user=None, debug=False):
	"""Workspace admins read the pending invites of their workspace."""
	from oqiva.access import resolve

	user = user or frappe.session.user
	if _is_unrestricted(user):
		return True
	if ptype not in READ_ONLY_PTYPES:
		return False
	return resolve.workspace_role(user, doc.workspace) in ("Owner", "Admin")


def board_query_conditions(user=None, doctype=None) -> str:
	"""Boards in workspaces where the user is a Member or better.

	Boards shared with the user are added by Frappe's own DocShare handling.
	"""
	user = user or frappe.session.user
	if _is_unrestricted(user):
		return ""
	if user == "Guest":
		return "1=0"
	sub = _member_workspaces_sql(user, ("Owner", "Admin", "Member"))
	return "`tabOqiva Board`.`workspace` in ({0})".format(sub)


def project_query_conditions(user=None, doctype=None) -> str:
	"""Projects in any workspace the user belongs to."""
	user = user or frappe.session.user
	if _is_unrestricted(user):
		return ""
	if user == "Guest":
		return "1=0"
	sub = _member_workspaces_sql(user, ("Owner", "Admin", "Member", "Guest"))
	return "`tabOqiva Project`.`workspace` in ({0})".format(sub)


def workspace_query_conditions(user=None, doctype=None) -> str:
	"""Workspaces the user belongs to."""
	user = user or frappe.session.user
	if _is_unrestricted(user):
		return ""
	if user == "Guest":
		return "1=0"
	sub = _member_workspaces_sql(user, ("Owner", "Admin", "Member", "Guest"))
	return "`tabOqiva Workspace`.`name` in ({0})".format(sub)


def workspace_member_query_conditions(user=None, doctype=None) -> str:
	"""Member rows of the workspaces the user belongs to."""
	user = user or frappe.session.user
	if _is_unrestricted(user):
		return ""
	if user == "Guest":
		return "1=0"
	sub = _member_workspaces_sql(user, ("Owner", "Admin", "Member", "Guest"))
	return "`tabOqiva Workspace Member`.`workspace` in ({0})".format(sub)


def own_row_query_conditions(doctype: str, user: str | None) -> str:
	user = user or frappe.session.user
	if _is_unrestricted(user):
		return ""
	if user == "Guest":
		return "1=0"
	return "`tab{0}`.`user` = {1}".format(doctype, frappe.db.escape(user))


def favorite_query_conditions(user=None, doctype=None) -> str:
	"""A user lists only their own favourites."""
	return own_row_query_conditions("Oqiva Favorite", user)


def board_view_query_conditions(user=None, doctype=None) -> str:
	"""A user lists only their own board views."""
	return own_row_query_conditions("Oqiva Board View", user)


def invite_query_conditions(user=None, doctype=None) -> str:
	"""Pending invites of the workspaces the user administers."""
	user = user or frappe.session.user
	if _is_unrestricted(user):
		return ""
	if user == "Guest":
		return "1=0"
	sub = _member_workspaces_sql(user, ("Owner", "Admin"))
	return "`tabOqiva Pending Invite`.`workspace` in ({0})".format(sub)
