"""Workspace membership: add, list, change role, remove."""

import frappe
from frappe import _

from oqiva.access import require, resolve
from oqiva.access.guard import service_write
from oqiva.access.rules import ROLE_RANK, can_manage_member
from oqiva.constants import INVITE_ROLES
from oqiva.exceptions import OqivaConflict, OqivaError, OqivaForbidden, OqivaNotFound


def add_member_row(workspace: str, user: str, role: str) -> str:
	"""Insert a membership row. Callers have already checked who may do this."""
	doc = service_write(frappe.new_doc("Oqiva Workspace Member"))
	doc.update({"workspace": workspace, "user": user, "role": role})
	doc.insert(ignore_permissions=True)
	return doc.name


def assert_addable_user(user: str) -> None:
	"""The target must be a real, enabled user."""
	if user in ("Guest", "Administrator"):
		raise OqivaError(_("That user cannot be added."))
	if not frappe.db.get_value("User", user, "enabled"):
		raise OqivaNotFound(_("That user could not be found."))


def list_members(actor: str, workspace: str) -> list[dict]:
	"""Members of a workspace the actor belongs to, Owner first."""
	ctx = resolve.workspace_context(actor, workspace)
	require(ctx, "workspace:view")
	rows = frappe.get_all(
		"Oqiva Workspace Member",
		filters={"workspace": workspace},
		fields=["user", "role", "creation"],
		limit_page_length=0,
	)
	users = {
		u.name: u
		for u in frappe.get_all(
			"User",
			filters={"name": ["in", [r.user for r in rows]]},
			fields=["name", "full_name", "user_image", "enabled"],
			limit_page_length=0,
		)
	}
	members = [
		{
			"user": r.user,
			"role": r.role,
			"full_name": (users.get(r.user) or {}).get("full_name") or r.user,
			"user_image": (users.get(r.user) or {}).get("user_image"),
			"enabled": bool((users.get(r.user) or {}).get("enabled")),
			"joined_on": r.creation,
		}
		for r in rows
	]
	return sorted(members, key=lambda m: (-ROLE_RANK[m["role"]], m["full_name"].lower()))


def _target_member(workspace: str, user: str) -> frappe._dict:
	row = frappe.db.get_value(
		"Oqiva Workspace Member", {"workspace": workspace, "user": user}, ["name", "role"], as_dict=True
	)
	if not row:
		raise OqivaNotFound(_("That member could not be found."))
	return row


def change_role(actor: str, workspace: str, user: str, role: str) -> dict:
	"""Change another member's role."""
	if role not in INVITE_ROLES:
		raise OqivaError(_("Choose Admin, Member or Guest."))
	ctx = resolve.workspace_context(actor, workspace)
	require(ctx, "member:change_role")
	target = _target_member(workspace, user)
	if not can_manage_member(ctx, target.role, role):
		raise OqivaForbidden()
	frappe.db.set_value("Oqiva Workspace Member", target.name, "role", role)
	return {"user": user, "role": role}


def remove_member(actor: str, workspace: str, user: str) -> dict:
	"""Remove another member. A member leaves through leave_workspace."""
	if user == actor:
		raise OqivaConflict(_("Use Leave workspace to remove yourself."))
	ctx = resolve.workspace_context(actor, workspace)
	require(ctx, "member:remove")
	target = _target_member(workspace, user)
	if not can_manage_member(ctx, target.role):
		raise OqivaForbidden()
	service_write(frappe.get_doc("Oqiva Workspace Member", target.name)).delete(ignore_permissions=True)
	return {"user": user}


def leave_workspace(actor: str, workspace: str) -> dict:
	"""Remove the actor from a workspace. The Owner cannot leave."""
	ctx = resolve.workspace_context(actor, workspace)
	require(ctx, "workspace:leave")
	row = _target_member(workspace, actor)
	service_write(frappe.get_doc("Oqiva Workspace Member", row.name)).delete(ignore_permissions=True)
	return {"workspace": workspace}
