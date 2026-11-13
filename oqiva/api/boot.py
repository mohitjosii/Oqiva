"""The call the SPA makes first. It sets the user up, then describes the app."""

import frappe

from oqiva import setup
from oqiva.api import current_user
from oqiva.services import invite_service, workspace_service
from oqiva.utils.settings import get_setting

WELCOMED_DEFAULT = "oqiva_welcomed"


def is_welcomed(user: str) -> bool:
	"""Has this person already been through the welcome page, on any device? Someone who already
	owns a board certainly has."""
	return bool(frappe.defaults.get_user_default(WELCOMED_DEFAULT, user)) or bool(
		frappe.db.exists("Oqiva Board", {"owner": user})
	)


def has_app_permission() -> bool:
	"""Show Oqiva on the apps screen to every signed-in user."""
	return frappe.session.user != "Guest"


@frappe.whitelist(methods=["POST"])
def get_boot() -> dict:
	"""Prepare the signed-in user and return what the SPA needs to start.

	It is a POST because it may write: the Oqiva User role, the personal workspace
	and any pending invites are set up here, on the user's first visit.
	"""
	user = current_user()
	setup.grant_user_role(user)
	personal = workspace_service.ensure_personal_workspace(user)
	invite_service.convert_for_user(user)
	info = frappe.db.get_value("User", user, ["full_name", "user_image", "email"], as_dict=True)
	return {
		"user": {
			"name": user,
			"full_name": info.full_name,
			"user_image": info.user_image,
			"email": info.email,
		},
		"workspaces": workspace_service.list_for_user(user),
		"personal_workspace": personal,
		"limits": {
			"max_objects_per_board": get_setting("max_objects_per_board"),
			"max_boards_per_workspace": get_setting("max_boards_per_workspace"),
			"trash_retention_days": get_setting("trash_retention_days"),
		},
		"is_admin": "Oqiva Admin" in frappe.get_roles(user),
		"welcomed": is_welcomed(user),
		"server_now": frappe.utils.now_datetime().replace(microsecond=0).isoformat(),
	}


@frappe.whitelist(methods=["POST"])
def mark_welcomed() -> dict:
	"""Remember that this person has seen the welcome page, so a new device does not show it again."""
	user = current_user()
	frappe.defaults.set_user_default(WELCOMED_DEFAULT, "1", user)
	return {"welcomed": True}
