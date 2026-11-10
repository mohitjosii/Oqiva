"""Idempotent app setup, run from after_install and after_migrate.

It runs from hooks rather than patches because a patch is marked done, not run, on a
fresh install. Everything here is safe to run repeatedly.
"""

import frappe

from oqiva.constants import APP_ROLES, BOARD_DOCTYPE, ROLE_USER, SETTINGS_DEFAULTS

# (doctype, fields, constraint name). A DocType JSON cannot declare a composite
# unique constraint, and on_doctype_update does not run on a normal migrate.
UNIQUE_CONSTRAINTS = (
	("Oqiva Workspace Member", ["workspace", "user"], "oqiva_unique_workspace_member"),
	("Oqiva Favorite", ["user", "board"], "oqiva_unique_favorite"),
	("Oqiva Board View", ["board", "user"], "oqiva_unique_board_view"),
	("Oqiva Pending Invite", ["email", "workspace"], "oqiva_unique_pending_invite"),
	("Oqiva Link Grant", ["share_link", "user"], "oqiva_unique_link_grant"),
)

INDEXES = (
	("Oqiva Comment", ["board", "resolved"], "oqiva_comment_board_resolved"),
	("Oqiva Comment", ["board", "shape_id"], "oqiva_comment_board_shape"),
	("Oqiva Board", ["workspace", "is_trashed", "modified"], "oqiva_board_workspace_state"),
	("Oqiva Board", ["project", "is_trashed"], "oqiva_board_project_state"),
	("Oqiva Project", ["workspace", "is_trashed"], "oqiva_project_workspace_state"),
	("Oqiva Board View", ["user", "last_opened_on"], "oqiva_board_view_user_recent"),
)


def ensure_setup(*args, **kwargs) -> None:
	"""Create roles, the board comment permission, constraints, indexes, settings, templates."""
	ensure_roles()
	ensure_comment_permission_type()
	ensure_constraints()
	ensure_indexes()
	ensure_settings()
	ensure_templates()
	frappe.clear_cache()


def ensure_roles() -> None:
	"""Create the Oqiva roles with the right desk access.

	Syncing a doctype that grants a role creates that role with Frappe's default
	(desk access on), so an existing role is corrected as well as a missing one made.
	"""
	for role, desk_access in APP_ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": desk_access}).insert(
				ignore_permissions=True
			)
		elif frappe.db.get_value("Role", role, "desk_access") != desk_access:
			doc = frappe.get_doc("Role", role)
			doc.desk_access = desk_access
			doc.save(ignore_permissions=True)


def ensure_comment_permission_type() -> None:
	"""Register the board "comment" permission so DocShare can carry a comment level."""
	if not frappe.db.exists("DocType", "Permission Type"):
		return
	if frappe.db.exists("Permission Type", {"doc_type": BOARD_DOCTYPE, "perm_type": "comment"}):
		return
	frappe.get_doc({"doctype": "Permission Type", "doc_type": BOARD_DOCTYPE, "perm_type": "comment"}).insert(
		ignore_permissions=True
	)


def ensure_constraints() -> None:
	"""Add the composite unique constraints. Setup must never break a migrate."""
	for doctype, fields, name in UNIQUE_CONSTRAINTS:
		try:
			frappe.db.add_unique(doctype, fields, constraint_name=name)
		except Exception:
			frappe.log_error(title=f"Oqiva: could not add unique constraint {name}")


def ensure_indexes() -> None:
	"""Add the composite indexes the home area queries rely on."""
	for doctype, fields, name in INDEXES:
		try:
			frappe.db.add_index(doctype, fields, index_name=name)
		except Exception:
			frappe.log_error(title=f"Oqiva: could not add index {name}")


def ensure_settings() -> None:
	"""Fill any Oqiva Settings value that has never been stored."""
	for fieldname, default in SETTINGS_DEFAULTS.items():
		stored = frappe.db.sql(
			"select value from tabSingles where doctype = %(doctype)s and field = %(field)s",
			{"doctype": "Oqiva Settings", "field": fieldname},
		)
		if not stored:
			frappe.db.set_single_value("Oqiva Settings", fieldname, default)


def ensure_templates() -> None:
	"""Load the template catalogue from the seed files. A failure must never break a migrate."""
	from oqiva.services import template_service

	try:
		template_service.seed_templates()
	except Exception:
		frappe.log_error(title="Oqiva: could not seed templates")


def grant_user_role(user: str) -> None:
	"""Give a signed-in user the Oqiva User role if they lack it."""
	if user in ("Guest", "Administrator") or ROLE_USER in frappe.get_roles(user):
		return
	if not frappe.db.get_single_value("Oqiva Settings", "auto_grant_role"):
		return
	doc = frappe.get_doc("User", user)
	doc.flags.ignore_permissions = True
	doc.add_roles(ROLE_USER)


def before_uninstall() -> None:
	"""Remove what Oqiva created outside its own doctypes."""
	frappe.db.delete("DocShare", {"share_doctype": BOARD_DOCTYPE})
	frappe.db.delete("Notification Log", {"document_type": ["like", "Oqiva %"]})
	for role, _desk in APP_ROLES:
		if frappe.db.exists("Role", role):
			frappe.db.delete("Has Role", {"role": role})
			frappe.delete_doc("Role", role, ignore_permissions=True, force=True)
