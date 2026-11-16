"""Comment endpoints."""

import frappe

from oqiva.api import current_user
from oqiva.services import comment_service
from oqiva.utils.rate_limit import rate_limit


@frappe.whitelist()
def list_comments(board: str) -> list[dict]:
	"""The threads on a board."""
	return comment_service.list_comments(current_user(), board)


@frappe.whitelist()
def people(board: str) -> list[dict]:
	"""Who can be mentioned on a board."""
	return comment_service.audience_people(current_user(), board)


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=30, seconds=60, methods=["POST"], ip_based=False, user_based=True)
def add_comment(
	board: str,
	content: str,
	anchor_type: str,
	shape_id: str | None = None,
	x: float | None = None,
	y: float | None = None,
) -> dict:
	"""Start a thread pinned to a shape or a point."""
	return comment_service.add_comment(current_user(), board, content, anchor_type, shape_id, x, y)


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=30, seconds=60, methods=["POST"], ip_based=False, user_based=True)
def reply(comment: str, content: str) -> dict:
	"""Reply to a thread."""
	return comment_service.reply(current_user(), comment, content)


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=30, seconds=60, methods=["POST"], ip_based=False, user_based=True)
def edit_comment(comment: str, content: str) -> dict:
	"""Change your own comment."""
	return comment_service.edit_comment(current_user(), comment, content)


@frappe.whitelist(methods=["POST"])
def delete_comment(comment: str) -> dict:
	"""Delete a comment you wrote (or any, as a workspace Admin)."""
	return comment_service.delete_comment(current_user(), comment)


@frappe.whitelist(methods=["POST"])
def set_resolved(comment: str, resolved: bool = True) -> dict:
	"""Resolve or reopen a thread."""
	return comment_service.set_resolved(current_user(), comment, bool(resolved))
