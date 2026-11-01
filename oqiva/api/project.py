"""Project endpoints."""

import frappe

from oqiva.api import current_user
from oqiva.services import project_service


@frappe.whitelist()
def list_projects(workspace: str, include_archived: bool = False) -> list[dict]:
	"""Projects of a workspace."""
	return project_service.list_projects(current_user(), workspace, include_archived)


@frappe.whitelist()
def get_project(project: str) -> dict:
	"""One project."""
	return project_service.get_project(current_user(), project)


@frappe.whitelist(methods=["POST"])
def create_project(
	workspace: str,
	project_name: str,
	description: str | None = None,
	color: str = "blue",
	icon: str | None = None,
) -> dict:
	"""Create a project."""
	return project_service.create_project(current_user(), workspace, project_name, description, color, icon)


@frappe.whitelist(methods=["POST"])
def update_project(
	project: str,
	project_name: str | None = None,
	description: str | None = None,
	color: str | None = None,
	icon: str | None = None,
) -> dict:
	"""Edit a project."""
	return project_service.update_project(current_user(), project, project_name, description, color, icon)


@frappe.whitelist(methods=["POST"])
def archive_project(project: str, archived: bool = True) -> dict:
	"""Archive or unarchive a project."""
	return project_service.set_archived(current_user(), project, archived)


@frappe.whitelist(methods=["POST"])
def trash_project(project: str) -> dict:
	"""Move a project and its boards to Trash."""
	return project_service.trash_project(current_user(), project)


@frappe.whitelist(methods=["POST"])
def restore_project(project: str) -> dict:
	"""Restore a project and the boards trashed with it."""
	return project_service.restore_project(current_user(), project)
