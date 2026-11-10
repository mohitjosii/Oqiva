"""Workspaces: create, list, rename, delete, personal workspace."""

import frappe
from frappe import _
from frappe.query_builder.functions import Count
from frappe.utils import now_datetime

from oqiva.access import require, resolve
from oqiva.access.guard import service_write
from oqiva.services import member_service
from oqiva.utils import realtime
from oqiva.utils.text import clean_line, slugify


def _free_slug(base: str) -> str:
	taken = set(
		frappe.get_all("Oqiva Workspace", filters={"slug": ["like", f"{base}%"]}, pluck="slug", limit=500)
	)
	if base not in taken:
		return base
	suffix = 2
	while f"{base}-{suffix}" in taken:
		suffix += 1
	return f"{base}-{suffix}"


def create_workspace(user: str, workspace_name: str, personal: bool = False) -> str:
	"""Create a workspace owned by ``user`` and return its name."""
	name = clean_line(workspace_name, _("Workspace name"), 120)
	base = slugify(name)[:40]
	doc = service_write(frappe.new_doc("Oqiva Workspace"))
	doc.update(
		{
			"workspace_name": name,
			"slug": _free_slug(base),
			"owner_user": user,
			"personal_of": user if personal else None,
		}
	)
	try:
		frappe.db.savepoint("oqiva_workspace_insert")
		doc.insert(ignore_permissions=True)
	except frappe.UniqueValidationError:
		if personal:
			raise
		frappe.db.rollback(save_point="oqiva_workspace_insert")
		doc = service_write(frappe.new_doc("Oqiva Workspace"))
		doc.update(
			{
				"workspace_name": name,
				"slug": f"{base}-{frappe.generate_hash(length=6)}",
				"owner_user": user,
			}
		)
		doc.insert(ignore_permissions=True)
	member_service.add_member_row(doc.name, user, "Owner")
	return doc.name


def ensure_personal_workspace(user: str) -> str:
	"""Return the user's personal workspace, creating it once.

	``personal_of`` is unique, so two first visits at the same moment cannot both
	create one.
	"""
	existing = frappe.db.get_value("Oqiva Workspace", {"personal_of": user, "is_deleted": 0}, "name")
	if existing:
		return existing
	name = _("{0}'s workspace").format(frappe.utils.get_fullname(user))
	frappe.db.savepoint("oqiva_personal_workspace")
	try:
		return create_workspace(user, name[:120], personal=True)
	except frappe.UniqueValidationError:
		frappe.db.rollback(save_point="oqiva_personal_workspace")
		return frappe.db.get_value("Oqiva Workspace", {"personal_of": user}, "name")


def list_for_user(user: str) -> list[dict]:
	"""The user's live workspaces, personal first."""
	memberships = frappe.get_all(
		"Oqiva Workspace Member", filters={"user": user}, fields=["workspace", "role"], limit_page_length=0
	)
	if not memberships:
		return []
	roles = {m.workspace: m.role for m in memberships}
	rows = frappe.get_all(
		"Oqiva Workspace",
		filters={"name": ["in", list(roles)], "is_deleted": 0},
		fields=["name", "workspace_name", "slug", "owner_user", "personal_of"],
		limit_page_length=0,
	)
	member = frappe.qb.DocType("Oqiva Workspace Member")
	counts = dict(
		frappe.qb.from_(member)
		.select(member.workspace, Count(member.name))
		.where(member.workspace.isin([r.name for r in rows]))
		.groupby(member.workspace)
		.run()
	)
	result = [
		{
			"name": r.name,
			"workspace_name": r.workspace_name,
			"slug": r.slug,
			"role": roles[r.name],
			"is_personal": bool(r.personal_of),
			"is_owner": r.owner_user == user,
			"member_count": counts.get(r.name, 1),
		}
		for r in rows
	]
	return sorted(result, key=lambda w: (not w["is_personal"], w["workspace_name"].lower()))


def rename_workspace(user: str, workspace: str, workspace_name: str) -> dict:
	"""Rename a workspace. Admins and the Owner only."""
	ctx = resolve.workspace_context(user, workspace)
	require(ctx, "workspace:update")
	doc = service_write(frappe.get_doc("Oqiva Workspace", workspace))
	doc.workspace_name = workspace_name
	doc.save(ignore_permissions=True)
	return {"name": doc.name, "workspace_name": doc.workspace_name}


def delete_workspace(user: str, workspace: str) -> dict:
	"""Soft-delete a workspace. Only its Owner may, and never a personal one."""
	ctx = resolve.workspace_context(user, workspace)
	require(ctx, "workspace:delete")
	members = frappe.get_all("Oqiva Workspace Member", filters={"workspace": workspace}, pluck="user")
	frappe.db.set_value("Oqiva Workspace", workspace, {"is_deleted": 1, "deleted_on": now_datetime()})
	for member in members:
		realtime.access_changed(member, workspace=workspace)
	return {"name": workspace}
