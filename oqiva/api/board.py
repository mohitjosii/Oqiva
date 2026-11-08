"""Board endpoints."""

import frappe
from frappe.rate_limiter import rate_limit

from oqiva.api import current_user
from oqiva.exceptions import OqivaError
from oqiva.services import board_service, document_service, file_service


@frappe.whitelist()
def list_boards(
	scope: str = "all",
	workspace: str | None = None,
	project: str | None = None,
	limit: int = 24,
	start: int = 0,
) -> dict:
	"""Boards for one home-area view: all, recent, favorites, shared, trash or archived."""
	return board_service.list_boards(current_user(), scope, workspace, project, limit, start)


@frappe.whitelist()
def get_board(board: str) -> dict:
	"""A board's details and the caller's capabilities."""
	return board_service.get_board(current_user(), board)


@frappe.whitelist(methods=["POST"])
def open_board(board: str) -> dict:
	"""Record that the caller opened a board, and return it."""
	return board_service.open_board(current_user(), board)


@frappe.whitelist(methods=["POST"])
def create_board(workspace: str, project: str | None = None, title: str | None = None) -> dict:
	"""Create an empty board."""
	return board_service.create_board(current_user(), workspace, project, title)


@frappe.whitelist(methods=["POST"])
def update_board(board: str, title: str | None = None, description: str | None = None) -> dict:
	"""Rename a board or change its description."""
	return board_service.update_board(current_user(), board, title, description)


@frappe.whitelist(methods=["POST"])
def move_board(board: str, project: str | None = None) -> dict:
	"""Move a board to a project, or to the workspace root."""
	return board_service.move_board(current_user(), board, project)


@frappe.whitelist(methods=["POST"])
def duplicate_board(board: str) -> dict:
	"""Copy a board."""
	return board_service.duplicate_board(current_user(), board)


@frappe.whitelist(methods=["POST"])
def archive_board(board: str, archived: bool = True) -> dict:
	"""Archive or unarchive a board."""
	return board_service.set_archived(current_user(), board, archived)


@frappe.whitelist(methods=["POST"])
def trash_board(board: str) -> dict:
	"""Move a board to Trash."""
	return board_service.trash_board(current_user(), board)


@frappe.whitelist(methods=["POST"])
def restore_board(board: str) -> dict:
	"""Restore a board from Trash."""
	return board_service.restore_board(current_user(), board)


@frappe.whitelist(methods=["POST"])
def purge_board(board: str, confirm_title: str) -> dict:
	"""Delete a trashed board permanently."""
	return board_service.purge_board(current_user(), board, confirm_title)


@frappe.whitelist(methods=["POST"])
def set_favorite(board: str, favorite: bool = True) -> dict:
	"""Star or unstar a board."""
	return board_service.set_favorite(current_user(), board, favorite)


@frappe.whitelist()
def load_document(board: str) -> dict:
	"""A board's content, revision and limits for the editor."""
	return document_service.load_document(current_user(), board)


@frappe.whitelist()
def get_revision(board: str) -> dict:
	"""A board's current revision and the id of the save that made it."""
	return document_service.get_revision(current_user(), board)


@frappe.whitelist(methods=["POST"])
def save_document(board: str, document: str, base_revision: int, save_id: str) -> dict:
	"""Save a board's content against the revision the client last saw."""
	return document_service.save_document(current_user(), board, document, base_revision, save_id)


def _sent_file() -> bytes:
	"""The bytes of the one file in this request."""
	sent = frappe.request.files.get("file") if frappe.request else None
	if not sent:
		raise OqivaError(frappe._("No file was sent."))
	return sent.read()


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=30, seconds=60, methods=["POST"], ip_based=False, user_based=True)
def upload_image(board: str) -> dict:
	"""Add a picture to a board. Send it as the multipart field ``file``."""
	return file_service.upload_image(current_user(), board, _sent_file())


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=10, seconds=60, methods=["POST"], ip_based=False, user_based=True)
def save_thumbnail(board: str) -> dict:
	"""Replace a board's thumbnail. Send a small PNG as the multipart field ``file``."""
	return file_service.save_thumbnail(current_user(), board, _sent_file())
