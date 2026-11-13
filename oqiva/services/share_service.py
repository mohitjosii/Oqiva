"""Sharing a board with people (ARCHITECTURE sections 5.9 and 10).

A share is a core DocShare row on the board. Its level maps to rights as Draw does: view is
read, comment adds comment, edit adds write. Unlike Draw, edit never grants the right to share
again, so someone who was only shared a board cannot pass it on.
"""

import frappe
from frappe import _
from frappe.exceptions import OutgoingEmailError
from frappe.utils import escape_html, get_url, validate_email_address

from oqiva.access import may, require, resolve
from oqiva.access.guard import service_write
from oqiva.access.rules import AccessContext
from oqiva.constants import BOARD_DOCTYPE
from oqiva.exceptions import OqivaConflict, OqivaError, OqivaForbidden, OqivaLimitExceeded, OqivaNotFound
from oqiva.services import member_service, notification_service
from oqiva.utils import realtime

LEVELS = ("view", "comment", "edit")
RIGHTS = {
	"view": {"read": 1, "write": 0, "comment": 0},
	"comment": {"read": 1, "write": 0, "comment": 1},
	"edit": {"read": 1, "write": 1, "comment": 1},
}
MAX_SHARES_PER_BOARD = 200
MAX_PENDING_BOARD_INVITES = 50
LEVEL_WORDS = {"view": "view", "comment": "comment on", "edit": "edit"}


def _check_level(level: str) -> None:
	if level not in LEVELS:
		raise OqivaError(_("Choose view, comment or edit."))


def _write_share(board: str, user: str, level: str, owner: str) -> None:
	"""Create or change the DocShare row. Every right is given, so a downgrade really removes some."""
	frappe.share.add(
		BOARD_DOCTYPE,
		board,
		user=user,
		share=0,  # sharing again is never part of a share
		notify=0,
		flags={"ignore_share_permission": True},
		**RIGHTS[level],
	)
	name = frappe.db.get_value(
		"DocShare", {"share_doctype": BOARD_DOCTYPE, "share_name": board, "user": user}
	)
	if name:
		frappe.db.set_value("DocShare", name, "owner", owner, update_modified=False)


def _delete_share(name: str) -> None:
	"""Remove a DocShare row. The rules were checked by the caller, so the row's own permission
	check (which the person asking would fail) is skipped."""
	frappe.delete_doc(
		"DocShare", name, ignore_permissions=True, force=True, flags={"ignore_share_permission": True}
	)


def _share_row(board: str, user: str):
	return frappe.db.get_value(
		"DocShare",
		{"share_doctype": BOARD_DOCTYPE, "share_name": board, "user": user},
		["name", "owner"],
		as_dict=True,
	)


def _context_for_change(actor: str, board: str, row) -> AccessContext:
	"""The actor's context, knowing whether they created the share being changed."""
	ctx, _board = resolve.board_context(actor, board)
	return AccessContext(
		user=ctx.user,
		role=ctx.role,
		share=ctx.share,
		is_creator=ctx.is_creator,
		is_owner=ctx.is_owner,
		is_personal=ctx.is_personal,
		created_share=bool(row and row.owner == actor),
	)


def _find_target(person: str) -> tuple[str | None, str]:
	"""The user for a name or email, and the address to invite when there is none."""
	text = (person or "").strip()
	if not text:
		raise OqivaError(_("Enter an email address."))
	user = frappe.db.get_value("User", text, "name") or frappe.db.get_value(
		"User", {"email": text.lower()}, "name"
	)
	if user:
		return user, text.lower()
	address = (validate_email_address(text, throw=True) or "").lower()
	return None, address


def list_shares(actor: str, board: str) -> dict:
	"""Who has the board, for the Share dialog. Only people who may share can see it."""
	ctx, row = resolve.board_context(actor, board)
	require(ctx, "board:share")
	shares = frappe.get_all(
		"DocShare",
		filters={"share_doctype": BOARD_DOCTYPE, "share_name": board},
		fields=["user", "read", "write", "comment", "owner"],
		limit_page_length=0,
	)
	users = {
		u.name: u
		for u in frappe.get_all(
			"User",
			filters={"name": ["in", [s.user for s in shares]]},
			fields=["name", "full_name", "user_image", "enabled"],
			limit_page_length=0,
		)
	}
	people = []
	for share in shares:
		info = users.get(share.user)
		if not info or not info.enabled:
			continue
		level = resolve.share_level(share.read, share.write, share.get("comment") or 0)
		people.append(
			{
				"user": share.user,
				"full_name": info.full_name or share.user,
				"user_image": info.user_image,
				"level": level,
				"can_change": may(_context_for_change(actor, board, share), "share:modify"),
			}
		)
	people.sort(key=lambda p: p["full_name"].lower())
	invites = frappe.get_all(
		"Oqiva Pending Invite",
		filters={"board": board},
		fields=["email", "access"],
		limit_page_length=0,
	)
	return {"people": people, "invites": invites, "workspace": row.workspace}


def add_person(actor: str, board: str, person: str, level: str) -> dict:
	"""Share with a registered user at once, or invite an email address that has no account."""
	_check_level(level)
	ctx, row = resolve.board_context(actor, board)
	require(ctx, "board:share")
	user, address = _find_target(person)
	if user is None:
		return _invite(actor, row, address, level)
	member_service.assert_addable_user(user)
	if user == actor:
		raise OqivaError(_("You already have access to this board."))
	existing = _share_row(board, user)
	if existing:
		raise OqivaConflict(_("That person already has access. Change their level instead."))
	if (
		frappe.db.count("DocShare", {"share_doctype": BOARD_DOCTYPE, "share_name": board})
		>= MAX_SHARES_PER_BOARD
	):
		raise OqivaLimitExceeded(_("This board is shared with as many people as it can be."))
	_write_share(board, user, level, actor)
	_after_share(actor, board, row, user, level)
	return {"status": "shared", "user": user, "level": level}


def _after_share(actor: str, board: str, row, user: str, level: str) -> None:
	realtime.access_changed(user, board=board)
	notification_service.notify(
		user,
		"share",
		_("{0} shared the board {1} with you").format(frappe.utils.get_fullname(actor), row.title),
		board=board,
		from_user=actor,
		detail=_("You can {0} it.").format(LEVEL_WORDS[level]),
	)


def _invite(actor: str, row, address: str, level: str) -> dict:
	"""Record an invite for an email with no account; it turns into a share when they sign up."""
	existing = frappe.db.get_value("Oqiva Pending Invite", {"email": address, "board": row.name}, "name")
	if existing:
		frappe.db.set_value("Oqiva Pending Invite", existing, {"access": level, "invited_by_user": actor})
	else:
		if frappe.db.count("Oqiva Pending Invite", {"board": row.name}) >= MAX_PENDING_BOARD_INVITES:
			raise OqivaLimitExceeded(_("This board has too many waiting invites."))
		doc = service_write(frappe.new_doc("Oqiva Pending Invite"))
		doc.update({"email": address, "board": row.name, "access": level, "invited_by_user": actor})
		doc.insert(ignore_permissions=True)
	return {"status": "invited", "email": address, "email_sent": _send_invite_email(actor, row, address)}


def _send_invite_email(actor: str, row, address: str) -> bool:
	inviter = frappe.utils.get_fullname(actor)
	message = _(
		"<p>{0} shared the board <b>{1}</b> with you on Oqiva.</p>"
		"<p>Sign up or log in with this email address to open it: <a href='{2}'>{2}</a></p>"
	).format(escape_html(inviter), escape_html(row.title), get_url("/oqiva"))
	try:
		frappe.sendmail(
			recipients=[address],
			subject=_("{0} shared a board with you on Oqiva").format(inviter),
			message=message,
			reference_doctype=BOARD_DOCTYPE,
			reference_name=row.name,
		)
	except OutgoingEmailError:
		return False
	return True


def change_level(actor: str, board: str, user: str, level: str) -> dict:
	"""Raise or lower a person's access."""
	_check_level(level)
	share = _share_row(board, user)
	if not share:
		raise OqivaNotFound(_("That person does not have a share on this board."))
	ctx = _context_for_change(actor, board, share)
	require(ctx, "share:modify")
	_write_share(board, user, level, share.owner)
	realtime.access_changed(user, board=board)
	return {"user": user, "level": level}


def revoke(actor: str, board: str, user: str) -> dict:
	"""Take a share away. The person keeps any access they have through the workspace."""
	share = _share_row(board, user)
	if not share:
		raise OqivaNotFound(_("That person does not have a share on this board."))
	ctx = _context_for_change(actor, board, share)
	require(ctx, "share:revoke")
	_delete_share(share.name)
	realtime.access_changed(user, board=board)
	return {"user": user}


def leave(actor: str, board: str) -> dict:
	"""Stop having a board that was shared with you."""
	share = _share_row(board, actor)
	if not share:
		raise OqivaNotFound(_("This board is not shared with you."))
	_delete_share(share.name)
	return {"board": board}


def cancel_invite(actor: str, board: str, email: str) -> dict:
	"""Withdraw an invite that has not been taken up."""
	ctx, _row = resolve.board_context(actor, board)
	require(ctx, "board:share")
	name = frappe.db.get_value(
		"Oqiva Pending Invite", {"board": board, "email": (email or "").strip().lower()}
	)
	if not name:
		raise OqivaNotFound(_("That invite could not be found."))
	if not (
		ctx.role_rank >= 2
		or ctx.is_creator
		or frappe.db.get_value("Oqiva Pending Invite", name, "invited_by_user") == actor
	):
		raise OqivaForbidden()
	frappe.db.delete("Oqiva Pending Invite", {"name": name})
	return {"email": email}


def convert_board_invites(user: str, email: str) -> int:
	"""Turn invites for this email into shares. Returns how many were turned."""
	invites = frappe.get_all(
		"Oqiva Pending Invite",
		filters={"email": email, "board": ["is", "set"]},
		fields=["name", "board", "access", "invited_by_user"],
		limit_page_length=0,
	)
	trashed = dict(
		frappe.get_all(
			BOARD_DOCTYPE,
			filters={"name": ["in", [i.board for i in invites]]},
			fields=["name", "is_trashed"],
			as_list=True,
			limit_page_length=0,
		)
	)
	count = 0
	for invite in invites:
		live = trashed.get(invite.board) == 0
		if live and not _share_row(invite.board, user) and invite.access in LEVELS:
			_write_share(invite.board, user, invite.access, invite.invited_by_user or "Administrator")
			realtime.access_changed(user, board=invite.board)
			count += 1
	if invites:
		frappe.db.delete("Oqiva Pending Invite", {"name": ["in", [i.name for i in invites]]})
	return count
