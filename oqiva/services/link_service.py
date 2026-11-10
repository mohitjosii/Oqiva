"""Share links (ARCHITECTURE sections 5.9 and 10).

A link is a secret address. Only a keyed hash of the secret is stored, and the secret itself
is shown once, when the link is made. Redeeming a link, as a signed-in person, records a
grant that gives them the link's access for as long as the link stays live. Revoking a link
ends every grant at once. Anyone who is not allowed in gets the same not-found answer, so a
revoked link cannot be told apart from one that never existed.
"""

import hashlib
import hmac
import secrets

import frappe
from frappe import _
from frappe.utils import add_days, get_url, now_datetime

from oqiva.access import may, require, resolve
from oqiva.access.guard import service_write
from oqiva.access.rules import AccessContext
from oqiva.constants import BOARD_DOCTYPE, GRANT_DOCTYPE, LINK_ACCESS, LINK_DOCTYPE
from oqiva.exceptions import OqivaError, OqivaLimitExceeded, OqivaNotFound
from oqiva.services import audit_service, document_service
from oqiva.utils import realtime

MAX_LIVE_LINKS_PER_BOARD = 20
MAX_EXPIRY_DAYS = 365
HINT_LENGTH = 6


def hash_token(token: str) -> str:
	"""A keyed hash of a link secret. The key comes from the site's encryption key, so a
	copy of the table alone cannot be used to check guesses."""
	from frappe.utils.password import get_encryption_key

	key = hashlib.sha256(b"oqiva-share-link:" + get_encryption_key().encode()).digest()
	return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def link_url(token: str) -> str:
	return get_url(f"/oqiva/s/{token}")


def _live(link) -> bool:
	return bool(link and not link.revoked_on and not (link.expires_on and link.expires_on <= now_datetime()))


def _board_row(board: str):
	row = frappe.db.get_value(
		BOARD_DOCTYPE, board, ["name", "title", "workspace", "is_trashed", "document"], as_dict=True
	)
	if not row or row.is_trashed:
		return None
	if frappe.db.get_value("Oqiva Workspace", row.workspace, "is_deleted"):
		return None
	return row


def _link_fields():
	return ["name", "board", "access", "allow_anonymous", "expires_on", "revoked_on", "created_by_user"]


def _find_live(token: str):
	"""The live link and its board for a secret. Raises the same not-found for every kind of failure."""
	if not isinstance(token, str) or not 8 <= len(token) <= 200:
		raise OqivaNotFound()
	link = frappe.db.get_value(LINK_DOCTYPE, {"token_hash": hash_token(token)}, _link_fields(), as_dict=True)
	board = _board_row(link.board) if link else None
	if not _live(link) or not board:
		raise OqivaNotFound()
	return link, board


# --- making, listing and ending links ---


def create_link(
	actor: str,
	board: str,
	access: str,
	expires_in_days: int | None = None,
	allow_anonymous: bool = False,
) -> dict:
	"""Make a link. The secret is in the result and is never available again."""
	ctx, row = resolve.board_context(actor, board)
	require(ctx, "board:share")
	if access not in LINK_ACCESS:
		raise OqivaError(_("Choose Viewer, Commenter or Editor."))
	if allow_anonymous and access != "Viewer":
		raise OqivaError(_("Only a viewing link can be opened without signing in."))
	expires_on = None
	if expires_in_days not in (None, "", 0):
		days = int(expires_in_days)
		if not 1 <= days <= MAX_EXPIRY_DAYS:
			raise OqivaError(_("A link can last from 1 to {0} days.").format(MAX_EXPIRY_DAYS))
		expires_on = add_days(now_datetime(), days)
	live = [link for link in _links_of(board) if _live(link)]
	if len(live) >= MAX_LIVE_LINKS_PER_BOARD:
		raise OqivaLimitExceeded(_("This board has as many links as it can have. Revoke one first."))
	token = secrets.token_urlsafe(32)
	doc = service_write(frappe.new_doc(LINK_DOCTYPE))
	doc.update(
		{
			"board": row.name,
			"access": access,
			"token_hash": hash_token(token),
			"token_hint": token[:HINT_LENGTH],
			"allow_anonymous": 1 if allow_anonymous else 0,
			"expires_on": expires_on,
			"created_by_user": actor,
		}
	)
	doc.insert(ignore_permissions=True)
	audit_service.record(
		"link.created", actor, BOARD_DOCTYPE, row.name, {"access": access, "anonymous": bool(allow_anonymous)}
	)
	return {**_describe(doc.as_dict()), "token": token, "url": link_url(token)}


def _links_of(board: str):
	return frappe.get_all(
		LINK_DOCTYPE,
		filters={"board": board, "revoked_on": ["is", "not set"]},
		fields=[*_link_fields(), "token_hint", "last_used_on", "creation"],
		order_by="creation desc",
		limit_page_length=0,
	)


def _describe(link) -> dict:
	return {
		"name": link["name"],
		"access": link["access"],
		"token_hint": link.get("token_hint"),
		"allow_anonymous": bool(link.get("allow_anonymous")),
		"expires_on": link.get("expires_on"),
		"last_used_on": link.get("last_used_on"),
		"created_by_user": link.get("created_by_user"),
		"expired": bool(link.get("expires_on") and link["expires_on"] <= now_datetime()),
	}


def list_links(actor: str, board: str) -> list[dict]:
	"""Links that have not been revoked, newest first. Secrets are never listed."""
	ctx, _row = resolve.board_context(actor, board)
	require(ctx, "board:share")
	return [{**_describe(link), "can_revoke": _may_revoke(actor, board, link)} for link in _links_of(board)]


def _may_revoke(actor: str, board: str, link) -> bool:
	ctx, _row = resolve.board_context(actor, board)
	with_share = AccessContext(
		user=ctx.user,
		role=ctx.role,
		share=ctx.share,
		is_creator=ctx.is_creator,
		is_owner=ctx.is_owner,
		is_personal=ctx.is_personal,
		created_share=link.get("created_by_user") == actor,
	)
	return may(with_share, "share:revoke")


def revoke_link(actor: str, link_name: str) -> dict:
	"""End a link and every grant it gave."""
	link = frappe.db.get_value(LINK_DOCTYPE, link_name, _link_fields(), as_dict=True)
	if not link or link.revoked_on:
		raise OqivaNotFound()
	resolve.board_context(actor, link.board)  # a stranger gets not-found, like for any board
	if not _may_revoke(actor, link.board, link):
		from oqiva.exceptions import OqivaForbidden

		raise OqivaForbidden()
	frappe.db.set_value(LINK_DOCTYPE, link.name, {"revoked_on": now_datetime(), "token_hash": None})
	people = frappe.get_all(GRANT_DOCTYPE, filters={"share_link": link.name}, pluck="user")
	frappe.db.delete(GRANT_DOCTYPE, {"share_link": link.name})
	for user in people:
		realtime.access_changed(user, board=link.board)
	audit_service.record("link.revoked", actor, BOARD_DOCTYPE, link.board, {"grants_ended": len(people)})
	return {"name": link.name}


# --- using a link ---


def redeem(user: str, token: str) -> dict:
	"""Open a link. A signed-in person gets a grant; a visitor who is not signed in is told
	whether they may look anyway or must sign in."""
	try:
		link, board = _find_live(token)
	except OqivaNotFound:
		audit_service.record("link.rejected", user, BOARD_DOCTYPE, None, {"reason": "not live"})
		raise
	if user == "Guest":
		if link.allow_anonymous and link.access == "Viewer":
			_used(link.name)
			audit_service.record("link.redeemed", user, BOARD_DOCTYPE, board.name, {"anonymous": True})
			return {"board": board.name, "title": board.title, "anonymous": True}
		return {"login_required": True}
	_grant(link, board, user)
	audit_service.record("link.redeemed", user, BOARD_DOCTYPE, board.name, {"access": link.access})
	return {"board": board.name, "title": board.title, "access": LINK_ACCESS[link.access], "anonymous": False}


def _grant(link, board, user: str) -> None:
	if not frappe.db.exists(GRANT_DOCTYPE, {"share_link": link.name, "user": user}):
		doc = service_write(frappe.new_doc(GRANT_DOCTYPE))
		doc.update({"share_link": link.name, "board": board.name, "user": user, "granted_on": now_datetime()})
		doc.insert(ignore_permissions=True)
		realtime.access_changed(user, board=board.name)
	_used(link.name)


def _used(link_name: str) -> None:
	frappe.db.set_value(LINK_DOCTYPE, link_name, "last_used_on", now_datetime(), update_modified=False)


def _anonymous_link(token: str):
	link, board = _find_live(token)
	if not (link.allow_anonymous and link.access == "Viewer"):
		raise OqivaNotFound()
	return link, board


def view_shared(token: str) -> dict:
	"""What a visitor who is not signed in sees: the board, to look at and nothing more."""
	_link, board = _anonymous_link(token)
	document = board.document or ""
	try:
		document_service.parse_document(document, enforce_limits=False)
	except OqivaError:
		raise OqivaNotFound()
	return {
		"board": board.name,
		"title": board.title,
		"document": document,
		"capabilities": {
			"can_view": True,
			"can_comment": False,
			"can_edit": False,
			"can_export": False,
			"can_share": False,
		},
	}


def link_file(token: str, src: str) -> tuple[str, bytes]:
	"""One picture of a board shared by an anonymous link: its type and bytes."""
	from oqiva.services import file_service

	_link, board = _anonymous_link(token)
	return file_service.read_board_picture(board.name, src)
