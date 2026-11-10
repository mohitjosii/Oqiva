"""Sharing endpoints."""

import frappe
from frappe.rate_limiter import rate_limit

from oqiva.api import current_user
from oqiva.services import link_service, share_service


@frappe.whitelist()
def list_shares(board: str) -> dict:
	"""Who a board is shared with, and the invites still waiting."""
	return share_service.list_shares(current_user(), board)


@frappe.whitelist(methods=["POST"])
def add_person(board: str, person: str, level: str) -> dict:
	"""Share a board with a person by email or user name, at view, comment or edit."""
	return share_service.add_person(current_user(), board, person, level)


@frappe.whitelist(methods=["POST"])
def change_level(board: str, user: str, level: str) -> dict:
	"""Change how much a person may do."""
	return share_service.change_level(current_user(), board, user, level)


@frappe.whitelist(methods=["POST"])
def remove_person(board: str, user: str) -> dict:
	"""Stop sharing a board with a person."""
	return share_service.revoke(current_user(), board, user)


@frappe.whitelist(methods=["POST"])
def leave(board: str) -> dict:
	"""Give up a board that was shared with you."""
	return share_service.leave(current_user(), board)


@frappe.whitelist(methods=["POST"])
def cancel_invite(board: str, email: str) -> dict:
	"""Withdraw an invite that has not been taken up."""
	return share_service.cancel_invite(current_user(), board, email)


@frappe.whitelist(methods=["POST"])
def create_link(
	board: str, access: str, expires_in_days: int | None = None, allow_anonymous: bool = False
) -> dict:
	"""Make a share link. The secret address is returned this once."""
	return link_service.create_link(current_user(), board, access, expires_in_days, bool(allow_anonymous))


@frappe.whitelist()
def list_links(board: str) -> list[dict]:
	"""A board's links that are still in force (never their secrets)."""
	return link_service.list_links(current_user(), board)


@frappe.whitelist(methods=["POST"])
def revoke_link(link: str) -> dict:
	"""End a link, and the access everyone got through it."""
	return link_service.revoke_link(current_user(), link)


@frappe.whitelist(methods=["POST"], allow_guest=True)
@rate_limit(limit=20, seconds=60, ip_based=True)
def redeem_link(token: str) -> dict:
	"""Open a share link. Unknown, revoked and expired links all give the same not-found."""
	return link_service.redeem(frappe.session.user, token)


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=60, seconds=60, ip_based=True)
def view_shared(token: str) -> dict:
	"""The board behind an anonymous viewing link, for someone who is not signed in."""
	return link_service.view_shared(token)


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=300, seconds=60, ip_based=True)
def link_file(token: str, src: str) -> None:
	"""One picture of a board shared by an anonymous viewing link."""
	content_type, content = link_service.link_file(token, src)
	frappe.response["type"] = "download"
	frappe.response["filename"] = "picture"
	frappe.response["filecontent"] = content
	frappe.response["content_type"] = content_type
	frappe.response["display_content_as"] = "inline"
