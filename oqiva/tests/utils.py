"""Helpers shared by the Oqiva tests.

Tests create users and rows through the services, as the app does, and rely on
Frappe's per-class rollback for clean-up.
"""

from types import SimpleNamespace

import frappe

from oqiva.constants import ROLE_USER, SETTINGS_DEFAULTS
from oqiva.services import board_service, member_service, project_service, workspace_service


def make_user(email: str, roles: tuple[str, ...] = (ROLE_USER,)) -> str:
	"""Create an enabled user holding ``roles``. Idempotent."""
	if frappe.db.exists("User", email):
		return email
	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": email.split("@")[0],
			"send_welcome_email": 0,
			"enabled": 1,
		}
	)
	user.flags.no_welcome_mail = True
	for role in roles:
		user.append("roles", {"role": role})
	user.insert(ignore_permissions=True)
	return email


def make_world(tag: str = "t") -> SimpleNamespace:
	"""A workspace with one user per role, a project and a board.

	owner, admin, member, member2 and guest belong to ``workspace``. outsider belongs
	to a different workspace. ``board`` was created by ``member``.
	"""
	users = {
		name: make_user(f"{tag}_{name}@oqiva.test")
		for name in ("owner", "admin", "member", "member2", "guest", "outsider", "sharee")
	}
	workspace = workspace_service.create_workspace(users["owner"], f"{tag} team")
	for key, role in (("admin", "Admin"), ("member", "Member"), ("member2", "Member"), ("guest", "Guest")):
		member_service.add_member_row(workspace, users[key], role)
	other = workspace_service.create_workspace(users["outsider"], f"{tag} other")
	project = project_service.create_project(users["member"], workspace, "Platform", None, "blue", None)
	board = board_service.create_board(users["member"], workspace, project["name"], "Roadmap")
	return SimpleNamespace(
		**users,
		users=users,
		workspace=workspace,
		other_workspace=other,
		project=project["name"],
		board=board["name"],
	)


def share_board(board: str, user: str, level: str) -> None:
	"""Give ``user`` a DocShare on ``board`` at view, comment or edit level."""
	flags = {
		"view": {"read": 1, "comment": 0, "write": 0},
		"comment": {"read": 1, "comment": 1, "write": 0},
		"edit": {"read": 1, "comment": 1, "write": 1},
	}[level]
	frappe.share.add(
		"Oqiva Board", board, user=user, share=0, notify=0, flags={"ignore_share_permission": True}, **flags
	)


class RestoresSettings:
	"""Mix into a test case that changes Oqiva Settings: they are put back after every test.

	Frappe rolls the database back only when a test class ends, so a setting changed in one
	test would otherwise leak into the next.
	"""

	def setUp(self):
		super().setUp()
		self._saved_settings = {
			name: frappe.db.get_single_value("Oqiva Settings", name) for name in SETTINGS_DEFAULTS
		}

	def tearDown(self):
		for name, value in self._saved_settings.items():
			frappe.db.set_single_value("Oqiva Settings", name, value)
		super().tearDown()
