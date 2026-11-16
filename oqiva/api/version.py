"""Version history endpoints."""

import frappe

from oqiva.api import current_user
from oqiva.services import version_service
from oqiva.utils.rate_limit import rate_limit


@frappe.whitelist()
def list_versions(board: str) -> dict:
	"""The versions of a board, newest first, without their content."""
	return version_service.list_versions(current_user(), board)


@frappe.whitelist()
def get_version(board: str, version_number: int) -> dict:
	"""One version's content, to preview it (editors only)."""
	return version_service.get_version(current_user(), board, version_number)


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=30, seconds=60, methods=["POST"], ip_based=False, user_based=True)
def save_version(board: str, label: str) -> dict:
	"""Keep the board as it is now under a name."""
	return version_service.save_named(current_user(), board, label)


@frappe.whitelist(methods=["POST"])
def label_version(board: str, version_number: int, label: str) -> dict:
	"""Name a version (an automatic one becomes a named, kept version)."""
	return version_service.set_label(current_user(), board, version_number, label)


@frappe.whitelist(methods=["POST"])
def pin_version(board: str, version_number: int, pinned: int = 1) -> dict:
	"""Pin a version so it is never removed, or unpin it."""
	return version_service.set_pinned(current_user(), board, version_number, bool(int(pinned)))


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=20, seconds=60, methods=["POST"], ip_based=False, user_based=True)
def begin_restore(board: str, version_number: int) -> dict:
	"""Keep the board as it is, and return the version for the editor to apply."""
	return version_service.begin_restore(current_user(), board, version_number)


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=10, seconds=60, methods=["POST"], ip_based=False, user_based=True)
def restore_unopenable(board: str, version_number: int) -> dict:
	"""Put a version back on a board whose stored content cannot be opened."""
	return version_service.restore_unopenable(current_user(), board, version_number)
