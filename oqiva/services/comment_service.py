"""Comments on boards (ARCHITECTURE sections 5.8 and 11).

A comment is pinned to a shape or to a point on the board. A thread is one comment and its
replies (one level only). Anyone who may comment can add and reply, and resolve or reopen a
thread. The author edits their own comment; the author or a workspace Admin deletes it. Deleting
is soft, so history is kept. Text is stored as plain text and shown as text, never as markup.
"""

import json
import math
import re

import frappe
from frappe import _
from frappe.utils import now_datetime, strip_html_tags

from oqiva.access import may, require, resolve
from oqiva.access.guard import service_write
from oqiva.access.rules import AccessContext
from oqiva.constants import (
	BOARD_DOCTYPE,
	COMMENT_DOCTYPE,
	MAX_COMMENT_CHARS,
	MAX_COMMENTS_PER_BOARD,
	MAX_REPLIES_PER_THREAD,
)
from oqiva.exceptions import OqivaError, OqivaLimitExceeded, OqivaNotFound
from oqiva.services import notification_service
from oqiva.utils import realtime

SHAPE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MENTION = re.compile(r"@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f‪-‮⁦-⁩]")


def clean_text(content) -> str:
	"""Plain text: tags removed, control and direction-changing characters dropped, trimmed."""
	if not isinstance(content, str):
		raise OqivaError(_("Write something first."))
	text = CONTROL.sub("", strip_html_tags(content).replace("\r\n", "\n").replace("\r", "\n")).strip()
	if not text:
		raise OqivaError(_("Write something first."))
	if len(text) > MAX_COMMENT_CHARS:
		raise OqivaLimitExceeded(_("A comment can be up to {0} characters.").format(MAX_COMMENT_CHARS))
	return text


def _audience(board: str, workspace: str) -> set[str]:
	"""People who can see the board by being a member, shared with, or holding a live link."""
	members = frappe.get_all(
		"Oqiva Workspace Member",
		filters={"workspace": workspace, "role": ["in", ["Owner", "Admin", "Member"]]},
		pluck="user",
	)
	shared = frappe.get_all(
		"DocShare", filters={"share_doctype": BOARD_DOCTYPE, "share_name": board, "read": 1}, pluck="user"
	)
	granted = frappe.get_all("Oqiva Link Grant", filters={"board": board}, pluck="user")
	return {*members, *shared, *granted}


def audience_people(actor: str, board: str) -> list[dict]:
	"""Who can be mentioned on a board, for the composer's suggestions."""
	ctx, row = resolve.board_context(actor, board)
	require(ctx, "board:view")
	names = [n for n in _audience(board, row.workspace) if n not in ("Guest", "Administrator")]
	users = frappe.get_all(
		"User",
		filters={"name": ["in", names], "enabled": 1},
		fields=["name", "email", "full_name", "user_image"],
		limit_page_length=0,
	)
	return sorted(
		[
			{"user": u.name, "email": u.email, "full_name": u.full_name or u.name, "user_image": u.user_image}
			for u in users
		],
		key=lambda p: p["full_name"].lower(),
	)


def resolve_mentions(content: str, board: str, workspace: str, author: str) -> list[str]:
	"""Users named with @email who really are in the board's audience (anyone else is ignored)."""
	wanted = {m.lower() for m in MENTION.findall(content)}
	if not wanted:
		return []
	audience = _audience(board, workspace)
	found = frappe.get_all(
		"User", filters={"email": ["in", list(wanted)], "enabled": 1}, fields=["name"], pluck="name"
	)
	return sorted({u for u in found if u in audience and u != author})


def _comment_row(name: str):
	row = frappe.db.get_value(COMMENT_DOCTYPE, name, "*", as_dict=True)
	if not row or row.is_deleted:
		raise OqivaNotFound()
	return row


def _context(actor: str, row) -> tuple[AccessContext, frappe._dict]:
	ctx, board = resolve.board_context(actor, row.board)
	return (
		AccessContext(
			user=ctx.user,
			role=ctx.role,
			share=ctx.share,
			is_creator=ctx.is_creator,
			is_owner=ctx.is_owner,
			is_personal=ctx.is_personal,
			is_author=row.author == actor,
		),
		board,
	)


def _push(board: str, op: str, comment: str, parent: str | None = None) -> None:
	realtime.push_to_board(
		board, "oqiva:comment", {"board": board, "op": op, "comment": comment, "parent": parent}
	)


# --- reading ---


def _people(names: set[str]) -> dict:
	users = frappe.get_all(
		"User",
		filters={"name": ["in", list(names)]},
		fields=["name", "full_name", "user_image"],
		limit_page_length=0,
	)
	return {
		u.name: {"user": u.name, "full_name": u.full_name or u.name, "user_image": u.user_image}
		for u in users
	}


def _describe(row, actor: str, ctx: AccessContext, people: dict) -> dict:
	mine = row.author == actor
	return {
		"name": row.name,
		"parent": row.parent_comment,
		"author": people.get(row.author) or {"user": row.author, "full_name": row.author, "user_image": None},
		"content": row.content,
		"anchor_type": row.anchor_type,
		"shape_id": row.shape_id,
		"x": row.board_x,
		"y": row.board_y,
		"mentions": json.loads(row.mentions) if row.mentions else [],
		"object_missing": bool(row.object_missing),
		"resolved": bool(row.resolved),
		"resolved_by": row.resolved_by,
		"resolved_on": row.resolved_on,
		"creation": row.creation,
		"edited": bool(row.modified and row.creation and (row.modified - row.creation).total_seconds() > 2),
		"can_edit": mine,
		"can_delete": mine or (ctx.role_rank >= 2),
	}


def list_comments(actor: str, board: str) -> list[dict]:
	"""Every live thread on a board: each top-level comment with its replies, oldest first."""
	ctx, _row = resolve.board_context(actor, board)
	require(ctx, "board:view")
	rows = frappe.get_all(
		COMMENT_DOCTYPE,
		filters={"board": board, "is_deleted": 0},
		fields=["*"],
		order_by="creation asc",
		limit_page_length=MAX_COMMENTS_PER_BOARD + 1,
	)
	people = _people({r.author for r in rows} | {r.resolved_by for r in rows if r.resolved_by})
	threads = {}
	for row in rows:
		if not row.parent_comment:
			threads[row.name] = {**_describe(row, actor, ctx, people), "replies": []}
	for row in rows:
		if row.parent_comment and row.parent_comment in threads:
			threads[row.parent_comment]["replies"].append(_describe(row, actor, ctx, people))
	return list(threads.values())


# --- writing ---


def _anchor(anchor_type: str, shape_id, x, y) -> dict:
	if anchor_type == "shape":
		if not isinstance(shape_id, str) or not SHAPE_ID.match(shape_id):
			raise OqivaError(_("That shape cannot be commented on."))
		return {"anchor_type": "shape", "shape_id": shape_id}
	if anchor_type == "point":
		for value in (x, y):
			if (
				isinstance(value, bool)
				or not isinstance(value, int | float)
				or not math.isfinite(value)
				or abs(value) > 1e6
			):
				raise OqivaError(_("That place cannot be commented on."))
		return {"anchor_type": "point", "board_x": float(x), "board_y": float(y)}
	raise OqivaError(_("Choose a shape or a point."))


def _insert(actor: str, board_row, content: str, extra: dict, parent: str | None) -> frappe._dict:
	if frappe.db.count(COMMENT_DOCTYPE, {"board": board_row.name, "is_deleted": 0}) >= MAX_COMMENTS_PER_BOARD:
		raise OqivaLimitExceeded(_("This board has as many comments as it can hold."))
	mentions = resolve_mentions(content, board_row.name, board_row.workspace, actor)
	doc = service_write(frappe.new_doc(COMMENT_DOCTYPE))
	doc.update(
		{
			"board": board_row.name,
			"parent_comment": parent,
			"author": actor,
			"content": content,
			"mentions": json.dumps(mentions),
			**extra,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc, mentions


def add_comment(
	actor: str,
	board: str,
	content: str,
	anchor_type: str,
	shape_id: str | None = None,
	x: float | None = None,
	y: float | None = None,
) -> dict:
	"""Start a thread, pinned to a shape or a point."""
	ctx, row = resolve.board_context(actor, board)
	require(ctx, "comment:create")
	text = clean_text(content)
	doc, mentions = _insert(actor, row, text, _anchor(anchor_type, shape_id, x, y), None)
	_notify(actor, row, doc, mentions, None)
	_push(row.name, "add", doc.name)
	return {"name": doc.name}


def reply(actor: str, comment: str, content: str) -> dict:
	"""Answer a thread. Replies are one level deep: you reply to the thread, not to a reply."""
	parent = _comment_row(comment)
	if parent.parent_comment:
		raise OqivaError(_("Reply to the first comment of the thread."))
	ctx, row = resolve.board_context(actor, parent.board)
	require(ctx, "comment:create")
	if (
		frappe.db.count(COMMENT_DOCTYPE, {"parent_comment": parent.name, "is_deleted": 0})
		>= MAX_REPLIES_PER_THREAD
	):
		raise OqivaLimitExceeded(_("This thread has as many replies as it can hold."))
	text = clean_text(content)
	doc, mentions = _insert(
		actor, row, text, {"anchor_type": parent.anchor_type, "shape_id": parent.shape_id}, parent.name
	)
	_notify(actor, row, doc, mentions, parent)
	_push(row.name, "add", doc.name, parent.name)
	return {"name": doc.name}


def _notify(actor: str, board_row, doc, mentions: list[str], parent) -> None:
	who = frappe.utils.get_fullname(actor)
	told = set()
	for user in mentions:
		told.add(user)
		notification_service.notify(
			user,
			"mention",
			_("{0} mentioned you in a comment on {1}").format(who, board_row.title),
			board=board_row.name,
			from_user=actor,
			detail=doc.content[:140],
		)
	if parent and parent.author not in told:
		notification_service.notify(
			parent.author,
			"reply",
			_("{0} replied to your comment on {1}").format(who, board_row.title),
			board=board_row.name,
			from_user=actor,
			detail=doc.content[:140],
		)


def edit_comment(actor: str, comment: str, content: str) -> dict:
	"""Change the text of your own comment."""
	row = _comment_row(comment)
	ctx, board = _context(actor, row)
	require(ctx, "comment:edit")
	text = clean_text(content)
	before = set(json.loads(row.mentions) if row.mentions else [])
	mentions = resolve_mentions(text, row.board, board.workspace, actor)
	frappe.db.set_value(COMMENT_DOCTYPE, row.name, {"content": text, "mentions": json.dumps(mentions)})
	for user in set(mentions) - before:  # only people newly mentioned are told
		notification_service.notify(
			user,
			"mention",
			_("{0} mentioned you in a comment on {1}").format(frappe.utils.get_fullname(actor), board.title),
			board=row.board,
			from_user=actor,
			detail=text[:140],
		)
	_push(row.board, "edit", row.name, row.parent_comment)
	return {"name": row.name}


def delete_comment(actor: str, comment: str) -> dict:
	"""Remove a comment (and, for a thread's first comment, the whole thread). The author or a workspace
	Admin may. The record is kept, marked deleted."""
	row = _comment_row(comment)
	ctx, _board = _context(actor, row)
	require(ctx, "comment:delete")
	names = [row.name]
	if not row.parent_comment:
		names += frappe.get_all(COMMENT_DOCTYPE, filters={"parent_comment": row.name}, pluck="name")
	frappe.db.set_value(COMMENT_DOCTYPE, {"name": ["in", names]}, "is_deleted", 1)
	_push(row.board, "delete", row.name, row.parent_comment)
	return {"name": row.name}


def set_resolved(actor: str, comment: str, resolved: bool) -> dict:
	"""Resolve or reopen a thread."""
	row = _comment_row(comment)
	if row.parent_comment:
		raise OqivaError(_("Resolve the thread from its first comment."))
	ctx, _board = _context(actor, row)
	require(ctx, "comment:resolve")
	values = (
		{"resolved": 1, "resolved_by": actor, "resolved_on": now_datetime()}
		if resolved
		else {
			"resolved": 0,
			"resolved_by": None,
			"resolved_on": None,
		}
	)
	frappe.db.set_value(COMMENT_DOCTYPE, row.name, values)
	_push(row.board, "resolve", row.name)
	return {"name": row.name, "resolved": bool(resolved)}


# --- keeping pins honest ---


def reconcile_missing(board: str, document: dict) -> bool:
	"""Flag comments on shapes that are no longer on the board, and clear the flag for shapes that
	came back. Run on every save. Returns whether anything changed."""
	ids = {
		o["id"] for o in document.get("objects", []) if isinstance(o, dict) and isinstance(o.get("id"), str)
	}
	changed = False
	pinned = frappe.get_all(
		COMMENT_DOCTYPE,
		filters={"board": board, "anchor_type": "shape", "is_deleted": 0},
		fields=["name", "shape_id", "object_missing"],
		limit_page_length=0,
	)
	for item in pinned:
		missing = 0 if item.shape_id in ids else 1
		if bool(item.object_missing) != bool(missing):
			frappe.db.set_value(COMMENT_DOCTYPE, item.name, "object_missing", missing, update_modified=False)
			changed = True
	if changed:
		_push(board, "refresh", "")
	return changed


def may_view_comments(actor: str, board: str) -> bool:
	try:
		ctx, _row = resolve.board_context(actor, board)
	except OqivaNotFound:
		return False
	return may(ctx, "board:view")
