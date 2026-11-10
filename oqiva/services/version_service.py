"""Version history of a board (ARCHITECTURE section 7.4).

A version is a full copy of the board's document. Three kinds:

* **Auto**: taken inside a save, when the newest Auto version is older than the interval.
* **Named**: taken by a person ("Save version"), or an Auto version they gave a label to.
* **Pre-restore**: the board as it was just before a restore, so a restore can always be undone.

Retention keeps the newest ``version_retention`` automatic versions (Auto and Pre-restore)
and every Named or pinned one. Restore itself runs in the browser as one ordinary edit
(the server never writes a document behind a live room); the one server-side restore is for
a board whose stored content cannot be opened at all.
"""

import frappe
from frappe import _
from frappe.utils import add_to_date, get_datetime, now_datetime

from oqiva.access import require, resolve
from oqiva.access.guard import service_write
from oqiva.constants import BOARD_DOCTYPE
from oqiva.exceptions import OqivaConflict, OqivaError, OqivaLimitExceeded, OqivaNotFound
from oqiva.services import audit_service
from oqiva.utils import realtime
from oqiva.utils.settings import get_setting
from oqiva.utils.text import clean_line

VERSION_DOCTYPE = "Oqiva Board Version"
LIST_LIMIT = 200
MAX_KEPT = 200  # Named and pinned versions one board may hold
LABEL_LENGTH = 120
PRUNE_EVERY_SECONDS = 3600
AUTOMATIC = ("Auto", "Pre-restore")


def _next_number(board: str) -> int:
	"""The next version number. The caller holds the board's row lock, so two cannot collide."""
	newest = frappe.db.get_value(
		VERSION_DOCTYPE, {"board": board}, "version_number", order_by="version_number desc"
	)
	return int(newest or 0) + 1


def _insert(
	board: str,
	kind: str,
	document: str,
	revision: int,
	schema_version: int,
	object_count: int,
	user: str,
	label: str | None = None,
) -> int:
	doc = service_write(frappe.new_doc(VERSION_DOCTYPE))
	number = _next_number(board)
	doc.update(
		{
			"board": board,
			"version_number": number,
			"kind": kind,
			"label": label,
			"revision": revision,
			"schema_version": schema_version,
			"size_bytes": len(document.encode("utf-8")),
			"object_count": object_count,
			"created_by_user": user,
			"document": document,
		}
	)
	doc.insert(ignore_permissions=True)
	return number


def _lock_board(board: str) -> frappe._dict:
	return frappe.db.get_value(
		BOARD_DOCTYPE,
		board,
		["revision", "document", "schema_version", "object_count"],
		for_update=True,
		as_dict=True,
	)


def _same_as_newest(board: str, document: str) -> bool:
	"""True when the newest version already holds exactly this content, so there is nothing new to keep."""
	newest = frappe.db.get_value(
		VERSION_DOCTYPE,
		{"board": board},
		["size_bytes", "document"],
		order_by="version_number desc",
		as_dict=True,
	)
	return bool(newest and newest.size_bytes == len(document.encode("utf-8")) and newest.document == document)


def maybe_auto(
	board: str, document: str, revision: int, schema_version: int, object_count: int, user: str
) -> int | None:
	"""Inside a save (the board row is already locked): write an Auto version if it is time."""
	newest = frappe.db.get_value(
		VERSION_DOCTYPE, {"board": board, "kind": "Auto"}, "creation", order_by="creation desc"
	)
	interval = max(1, get_setting("auto_version_interval_min"))
	if newest and get_datetime(newest) > add_to_date(now_datetime(), minutes=-interval):
		return None
	if _same_as_newest(board, document):
		return None
	number = _insert(board, "Auto", document, revision, schema_version, object_count, user)
	_prune_if_due(board)
	return number


# ----- retention -----


def _prune_if_due(board: str) -> None:
	"""Prune after taking a version, at most once an hour per board."""
	key = f"oqiva:pruned:{board}"
	if frappe.cache.get_value(key):
		return
	prune(board)
	frappe.cache.set_value(key, 1, expires_in_sec=PRUNE_EVERY_SECONDS)


def prune(board: str) -> int:
	"""Delete automatic versions beyond the retention count. Named and pinned ones always stay."""
	keep = max(1, get_setting("version_retention"))
	rows = frappe.get_all(
		VERSION_DOCTYPE,
		filters={"board": board, "kind": ["in", AUTOMATIC], "pinned": 0},
		fields=["name"],
		order_by="version_number desc",
		limit_start=keep,
		limit_page_length=0,
	)
	for row in rows:
		frappe.delete_doc(
			VERSION_DOCTYPE, row.name, ignore_permissions=True, force=True, flags={"oqiva_service": True}
		)
	return len(rows)


def prune_all() -> None:
	"""Hourly: prune every board that holds more automatic versions than it may keep."""
	keep = max(1, get_setting("version_retention"))
	boards = frappe.db.sql(
		"""select board from `tabOqiva Board Version`
		where kind in ('Auto', 'Pre-restore') and pinned = 0
		group by board having count(*) > %s limit 500""",
		(keep,),
	)
	for (board,) in boards:
		prune(board)


# ----- reading -----


def _row_to_item(row) -> dict:
	return {
		"version_number": row.version_number,
		"kind": row.kind,
		"label": row.label,
		"pinned": bool(row.pinned),
		"revision": row.revision,
		"size_bytes": row.size_bytes,
		"object_count": row.object_count,
		"created": row.creation,
		"by": {"name": row.created_by_user, "full_name": row.full_name or row.created_by_user},
	}


def list_versions(user: str, board: str) -> dict:
	"""The history of a board, newest first, without the documents. Anyone who may view the board."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "version:list")
	rows = frappe.db.sql(
		"""select v.version_number, v.kind, v.label, v.pinned, v.revision, v.size_bytes,
			v.object_count, v.creation, v.created_by_user, u.full_name
		from `tabOqiva Board Version` v
		left join `tabUser` u on u.name = v.created_by_user
		where v.board = %s order by v.version_number desc limit %s""",
		(row.name, LIST_LIMIT),
		as_dict=True,
	)
	return {"versions": [_row_to_item(r) for r in rows]}


def _version_row(board: str, number: int, fields: list[str]):
	found = frappe.db.get_value(
		VERSION_DOCTYPE, {"board": board, "version_number": int(number)}, fields, as_dict=True
	)
	if not found:
		raise OqivaNotFound(_("That version does not exist."))
	return found


def get_version(user: str, board: str, version_number: int) -> dict:
	"""One version's content, to preview it. Editors only: old content can hold deleted material."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "version:preview")
	found = _version_row(row.name, version_number, ["document", "kind", "label", "schema_version"])
	return {
		"version_number": int(version_number),
		"kind": found.kind,
		"label": found.label,
		"schema_version": found.schema_version,
		"document": found.document,
	}


# ----- changing -----


def _kept_count(board: str) -> int:
	return frappe.db.count(VERSION_DOCTYPE, {"board": board, "kind": "Named"}) + frappe.db.count(
		VERSION_DOCTYPE, {"board": board, "kind": ["!=", "Named"], "pinned": 1}
	)


def save_named(user: str, board: str, label: str) -> dict:
	"""Keep the board as it is now under a name. The editor saves first, so this is what they see."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:edit")
	name = clean_line(label, _("Version name"), LABEL_LENGTH)
	if _kept_count(row.name) >= MAX_KEPT:
		raise OqivaLimitExceeded(_("This board already has as many named versions as it can keep."))
	current = _lock_board(row.name)
	if not current.document:
		raise OqivaConflict(_("There is nothing to keep yet."))
	number = _insert(
		row.name,
		"Named",
		current.document,
		current.revision,
		current.schema_version,
		current.object_count,
		user,
		name,
	)
	audit_service.record("version_named", user, BOARD_DOCTYPE, row.name, {"version": number})
	return {"version_number": number}


def set_label(user: str, board: str, version_number: int, label: str) -> dict:
	"""Name a version. Naming an automatic one keeps it, so it becomes a Named version."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:edit")
	name = clean_line(label, _("Version name"), LABEL_LENGTH)
	found = _version_row(row.name, version_number, ["name", "kind", "pinned"])
	values = {"label": name}
	if found.kind != "Named":
		if not found.pinned and _kept_count(row.name) >= MAX_KEPT:
			raise OqivaLimitExceeded(_("This board already has as many named versions as it can keep."))
		values["kind"] = "Named"
	frappe.db.set_value(VERSION_DOCTYPE, found.name, values)
	return {"version_number": int(version_number), "label": name}


def set_pinned(user: str, board: str, version_number: int, pinned: bool) -> dict:
	"""Pin a version so retention never removes it, or let it go."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:edit")
	found = _version_row(row.name, version_number, ["name", "kind", "pinned"])
	pinned = bool(pinned)
	if pinned and not found.pinned and found.kind != "Named" and _kept_count(row.name) >= MAX_KEPT:
		raise OqivaLimitExceeded(_("This board already has as many pinned versions as it can keep."))
	frappe.db.set_value(VERSION_DOCTYPE, found.name, "pinned", 1 if pinned else 0)
	return {"version_number": int(version_number), "pinned": pinned}


def _checked(document: str) -> None:
	from oqiva.services.document_service import parse_document

	try:
		parse_document(document, enforce_limits=False)
	except OqivaError:
		raise OqivaConflict(_("That version cannot be opened by this version of Oqiva."))


def begin_restore(user: str, board: str, version_number: int) -> dict:
	"""Start a restore: keep the board as it is now (Pre-restore) and return the version to apply.

	The browser applies the returned document to its own board as one edit, so people editing at
	the same time see it arrive like any other change and nobody's work is overwritten silently."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "version:restore")
	target = _version_row(row.name, version_number, ["document", "label", "kind", "schema_version"])
	_checked(target.document)
	current = _lock_board(row.name)
	pre = None
	if current.document:
		pre = _insert(
			row.name,
			"Pre-restore",
			current.document,
			current.revision,
			current.schema_version,
			current.object_count,
			user,
			_("Before restoring version {0}").format(int(version_number)),
		)
	audit_service.record(
		"version_restore", user, BOARD_DOCTYPE, row.name, {"version": int(version_number), "pre_restore": pre}
	)
	return {
		"version_number": int(version_number),
		"pre_restore": pre,
		"document": target.document,
	}


def restore_unopenable(user: str, board: str, version_number: int) -> dict:
	"""Put a version back on a board whose stored content cannot be opened at all.

	Only for that case: with nobody able to open the board there is no live room to protect, so the
	server may write it. A board that opens is restored from the editor instead."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "version:restore")
	from oqiva.services.document_service import parse_document

	current = _lock_board(row.name)
	try:
		parse_document(current.document or "", enforce_limits=False)
	except OqivaError:
		pass
	else:
		raise OqivaConflict(_("This board opens normally. Restore a version from its history panel."))
	target = _version_row(row.name, version_number, ["document", "schema_version", "revision"])
	document, count = _validated(target.document)
	frappe.db.set_value(
		BOARD_DOCTYPE,
		row.name,
		{
			"document": target.document,
			"crdt_state": "",
			"revision": current.revision + 1,
			"schema_version": document["schemaVersion"],
			"object_count": count,
			"last_save_id": None,
		},
	)
	realtime.resync(row.name)
	audit_service.record(
		"version_restore",
		user,
		BOARD_DOCTYPE,
		row.name,
		{"version": int(version_number), "server_side": True},
	)
	return {"revision": current.revision + 1}


def _validated(raw: str) -> tuple[dict, int]:
	from oqiva.services.document_service import parse_document

	try:
		return parse_document(raw, enforce_limits=False)
	except OqivaError:
		raise OqivaConflict(_("That version cannot be opened by this version of Oqiva."))
