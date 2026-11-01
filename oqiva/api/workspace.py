"""Workspace and membership endpoints."""

import frappe

from oqiva.api import current_user
from oqiva.services import invite_service, member_service, workspace_service


@frappe.whitelist()
def list_workspaces() -> list[dict]:
	"""The signed-in user's workspaces."""
	return workspace_service.list_for_user(current_user())


@frappe.whitelist(methods=["POST"])
def create_workspace(workspace_name: str) -> dict:
	"""Create a workspace owned by the signed-in user."""
	user = current_user()
	name = workspace_service.create_workspace(user, workspace_name)
	return next(w for w in workspace_service.list_for_user(user) if w["name"] == name)


@frappe.whitelist(methods=["POST"])
def rename_workspace(workspace: str, workspace_name: str) -> dict:
	"""Rename a workspace."""
	return workspace_service.rename_workspace(current_user(), workspace, workspace_name)


@frappe.whitelist(methods=["POST"])
def delete_workspace(workspace: str) -> dict:
	"""Delete a workspace the user owns."""
	return workspace_service.delete_workspace(current_user(), workspace)


@frappe.whitelist(methods=["POST"])
def leave_workspace(workspace: str) -> dict:
	"""Leave a workspace."""
	return member_service.leave_workspace(current_user(), workspace)


@frappe.whitelist()
def list_members(workspace: str) -> list[dict]:
	"""Members of a workspace."""
	return member_service.list_members(current_user(), workspace)


@frappe.whitelist(methods=["POST"])
def invite_member(workspace: str, email: str, role: str = "Member") -> dict:
	"""Invite a person by email."""
	return invite_service.invite(current_user(), workspace, email, role)


@frappe.whitelist(methods=["POST"])
def change_member_role(workspace: str, user: str, role: str) -> dict:
	"""Change a member's role."""
	return member_service.change_role(current_user(), workspace, user, role)


@frappe.whitelist(methods=["POST"])
def remove_member(workspace: str, user: str) -> dict:
	"""Remove a member."""
	return member_service.remove_member(current_user(), workspace, user)
