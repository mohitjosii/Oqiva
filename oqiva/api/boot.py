"""The call the SPA makes first. It sets the user up, then describes the app."""

import frappe

from oqiva import setup
from oqiva.api import current_user
from oqiva.services import invite_service, workspace_service
from oqiva.utils.settings import get_setting


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
		"server_now": frappe.utils.now_datetime().replace(microsecond=0).isoformat(),
	}
