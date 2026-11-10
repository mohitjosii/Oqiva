"""Notifications: Notification Log entries, which respect each person's Notification Settings
and feed the bell in the app."""

import frappe
from frappe.utils import escape_html

from oqiva.constants import BOARD_DOCTYPE

TYPES = {"share": "Share", "mention": "Mention", "reply": "Alert", "access": "Alert", "workspace": "Alert"}


def notify(
	to: str,
	kind: str,
	subject: str,
	board: str | None = None,
	from_user: str | None = None,
	detail: str | None = None,
) -> None:
	"""Tell ``to`` about something. Never tells people about their own actions, nor a disabled
	account, and never raises: a failed notification must not undo what it describes."""
	if not to or to == from_user or to in ("Guest", "Administrator"):
		return
	if not frappe.db.get_value("User", to, "enabled"):
		return
	try:
		doc = frappe.get_doc(
			{
				"doctype": "Notification Log",
				"subject": subject,
				"for_user": to,
				"from_user": from_user,
				"type": TYPES.get(kind, "Alert"),
				"document_type": BOARD_DOCTYPE if board else None,
				"document_name": board,
				"email_content": escape_html(detail) if detail else None,
			}
		)
		doc.insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="Oqiva notification failed")


# --- reading them back (the bell and the notifications page) ---

MAX_PAGE = 50


def _mine(user: str, **extra) -> dict:
	return {"for_user": user, "document_type": BOARD_DOCTYPE, **extra}


def unread_count(user: str) -> int:
	return frappe.db.count("Notification Log", _mine(user, read=0))


def list_for(user: str, limit: int = 20, start: int = 0, unread_only: bool = False) -> dict:
	"""A person's Oqiva notifications, newest first. The board's title is given only while they can
	still open the board, so a notification never keeps a revoked board's name alive."""
	from oqiva.access import resolve
	from oqiva.exceptions import OqivaNotFound

	limit = max(1, min(int(limit), MAX_PAGE))
	start = max(0, int(start))
	filters = _mine(user, **({"read": 0} if unread_only else {}))
	rows = frappe.get_all(
		"Notification Log",
		filters=filters,
		fields=["name", "subject", "type", "from_user", "document_name", "read", "creation", "email_content"],
		order_by="creation desc",
		limit_start=start,
		limit_page_length=limit + 1,
	)
	senders = {
		u.name: u.full_name
		for u in frappe.get_all(
			"User",
			filters={"name": ["in", list({r.from_user for r in rows if r.from_user})]},
			fields=["name", "full_name"],
			limit_page_length=0,
		)
	}
	titles: dict[str, str | None] = {}
	items = []
	for row in rows[:limit]:
		board = row.document_name
		if board and board not in titles:
			try:
				resolve.board_context(user, board)
				titles[board] = frappe.db.get_value(BOARD_DOCTYPE, board, "title")
			except OqivaNotFound:
				titles[board] = None
		items.append(
			{
				"name": row.name,
				"subject": row.subject,
				"type": row.type,
				"from_name": senders.get(row.from_user) or row.from_user,
				"board": board if titles.get(board) is not None else None,
				"board_title": titles.get(board),
				"detail": row.email_content,
				"read": bool(row.read),
				"creation": row.creation,
			}
		)
	return {"items": items, "has_more": len(rows) > limit, "unread": unread_count(user)}


def mark_read(user: str, name: str) -> dict:
	"""Mark one of the person's own notifications as read."""
	frappe.db.set_value("Notification Log", {"name": name, **_mine(user)}, "read", 1, update_modified=False)
	return {"unread": unread_count(user)}


def mark_all_read(user: str) -> dict:
	frappe.db.set_value("Notification Log", _mine(user, read=0), "read", 1, update_modified=False)
	return {"unread": 0}
