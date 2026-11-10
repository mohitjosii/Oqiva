"""Notification endpoints (the bell and the notifications page)."""

import frappe

from oqiva.api import current_user
from oqiva.services import notification_service


@frappe.whitelist()
def list_notifications(limit: int = 20, start: int = 0, unread_only: bool = False) -> dict:
	"""The caller's notifications, newest first, with the number still unread."""
	return notification_service.list_for(current_user(), limit, start, bool(unread_only))


@frappe.whitelist()
def unread_count() -> dict:
	"""How many notifications the caller has not read."""
	return {"unread": notification_service.unread_count(current_user())}


@frappe.whitelist(methods=["POST"])
def mark_read(name: str) -> dict:
	"""Mark one notification as read."""
	return notification_service.mark_read(current_user(), name)


@frappe.whitelist(methods=["POST"])
def mark_all_read() -> dict:
	"""Mark every notification as read."""
	return notification_service.mark_all_read(current_user())
