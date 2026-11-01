"""Loading and saving a board's content.

A board's content is one JSON document (ARCHITECTURE section 15.2). It is saved whole, under
a row lock, against the revision the client last saw, so two people can never silently
overwrite each other. The server checks the document's shape and size but never draws
anything, so it validates structure, not appearance.
"""

import json
import math
import re

import frappe
from frappe import _

from oqiva.access import require, resolve
from oqiva.access.rules import capabilities
from oqiva.constants import BOARD_DOCTYPE, empty_document_json
from oqiva.exceptions import (
	OqivaDocumentTooNew,
	OqivaError,
	OqivaLimitExceeded,
	OqivaStaleRevision,
)
from oqiva.utils.settings import get_setting

SUPPORTED_SCHEMA = 1
ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
LIST_KEYS = ("objects", "connectors", "mindmaps", "flowcharts")
KNOWN_KINDS = ("shape", "text")
GRIDS = ("off", "dense", "sparse")
MODES = ("infinite", "preset")
MAX_TEXT_CHARS = 10_000
MAX_RUNS = 500


def _number(value, low: float, high: float) -> bool:
	return (
		isinstance(value, int | float)
		and not isinstance(value, bool)
		and math.isfinite(value)
		and low <= value <= high
	)


def _bad(object_id: str, problem: str):
	raise OqivaError(_("Object {0}: {1}").format(object_id, problem))


def _check_color(object_id: str, field: str, value, allow_none: bool = True) -> None:
	if value is None and allow_none:
		return
	if not isinstance(value, str) or not COLOR.match(value):
		_bad(object_id, _("{0} must be a hex colour.").format(field))


def _check_style(object_id: str, style) -> None:
	if style is None:
		return
	if not isinstance(style, dict):
		_bad(object_id, _("style must be an object."))
	for field in ("fill", "stroke"):
		if field in style:
			_check_color(object_id, field, style[field])
	for field, low, high in (("strokeWidth", 0, 20), ("opacity", 0, 1), ("radius", 0, 200)):
		if field in style and not _number(style[field], low, high):
			_bad(object_id, _("{0} is out of range.").format(field))


def _check_text(object_id: str, text) -> None:
	if text is None:
		return
	if not isinstance(text, dict) or not isinstance(text.get("paragraphs"), list):
		_bad(object_id, _("text must have paragraphs."))
	if "color" in text:
		_check_color(object_id, "text colour", text["color"])
	if "size" in text and not _number(text["size"], 1, 500):
		_bad(object_id, _("text size is out of range."))
	chars = runs = 0
	for paragraph in text["paragraphs"]:
		if not isinstance(paragraph, dict) or not isinstance(paragraph.get("runs"), list):
			_bad(object_id, _("each paragraph needs runs."))
		for run in paragraph["runs"]:
			if not isinstance(run, dict) or not isinstance(run.get("t"), str):
				_bad(object_id, _("each run needs text."))
			if "c" in run:
				_check_color(object_id, "run colour", run["c"])
			chars += len(run["t"])
			runs += 1
	if chars > MAX_TEXT_CHARS or runs > MAX_RUNS:
		_bad(object_id, _("the text is too long."))


def _check_object(item, seen: set) -> None:
	if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not ID.match(item["id"]):
		raise OqivaError(_("An object has a missing or invalid id."))
	object_id = item["id"]
	if object_id in seen:
		_bad(object_id, _("the id is used twice."))
	seen.add(object_id)
	if item.get("kind") not in KNOWN_KINDS:
		return  # an object kind from a newer version is kept untouched
	for field, low, high in (
		("x", -1e6, 1e6),
		("y", -1e6, 1e6),
		("w", 1, 1e5),
		("h", 1, 1e5),
		("rotation", -1e7, 1e7),
		("z", -1e9, 1e9),
	):
		if not _number(item.get(field), low, high):
			_bad(object_id, _("{0} is missing or out of range.").format(field))
	_check_style(object_id, item.get("style"))
	_check_text(object_id, item.get("text"))


def _check_canvas(canvas) -> None:
	if canvas is None:
		return
	if not isinstance(canvas, dict):
		raise OqivaError(_("The canvas settings must be an object."))
	if canvas.get("background") is not None:
		_check_color("canvas", "background", canvas["background"])
	if canvas.get("grid", "off") not in GRIDS or canvas.get("mode", "infinite") not in MODES:
		raise OqivaError(_("The canvas settings are not valid."))


def _count(document: dict) -> int:
	nodes = sum(len(m.get("nodes", [])) for m in document["mindmaps"] if isinstance(m, dict))
	flow_nodes = sum(len(c.get("nodes", [])) for c in document["flowcharts"] if isinstance(c, dict))
	return len(document["objects"]) + len(document["connectors"]) + nodes + flow_nodes


def parse_document(raw: str, enforce_limits: bool = True) -> tuple[dict, int]:
	"""Check a document and return it with its object count.

	``enforce_limits`` is off when reading what is already stored, so lowering a limit
	never makes an existing board unopenable.
	"""
	if enforce_limits and len(raw.encode("utf-8")) > get_setting("max_document_bytes"):
		raise OqivaLimitExceeded(_("This board is too large to save."))
	try:
		document = json.loads(raw)
	except TypeError, ValueError:
		raise OqivaError(_("The board's content is not valid."))
	if not isinstance(document, dict):
		raise OqivaError(_("The board's content is not a document."))
	version = document.get("schemaVersion")
	if not isinstance(version, int) or isinstance(version, bool) or version < 0:
		raise OqivaError(_("The board's content has no version."))
	if version > SUPPORTED_SCHEMA:
		raise OqivaDocumentTooNew(_("This board was saved by a newer version of Oqiva."))
	for key in LIST_KEYS:
		document.setdefault(key, [])
		if not isinstance(document[key], list):
			raise OqivaError(_("{0} must be a list.").format(key))
	_check_canvas(document.get("canvas"))
	seen: set = set()
	for item in document["objects"]:
		_check_object(item, seen)
	count = _count(document)
	if enforce_limits and count > get_setting("max_objects_per_board"):
		raise OqivaLimitExceeded(_("This board has too many objects."))
	return document, count


def load_document(user: str, board: str) -> dict:
	"""A board's content for the editor, or a recovery reason when it cannot be opened."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:view")
	stored = frappe.db.get_value(
		BOARD_DOCTYPE, row.name, ["document", "revision", "schema_version"], as_dict=True
	)
	document = stored.document or empty_document_json()
	recovery = None
	try:
		parse_document(document, enforce_limits=False)
	except OqivaDocumentTooNew:
		recovery, document = "too_new", None
	except OqivaError:
		frappe.logger("oqiva").warning("Board %s holds an invalid document", row.name)
		recovery, document = "corrupt", None
	return {
		"board": row.name,
		"title": row.title,
		"document": document,
		"revision": stored.revision,
		"recovery": recovery,
		"capabilities": capabilities(ctx),
		"limits": {
			"max_objects_per_board": get_setting("max_objects_per_board"),
			"max_document_bytes": get_setting("max_document_bytes"),
		},
	}


def get_revision(user: str, board: str) -> dict:
	"""The board's current revision and the id of the save that produced it."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:view")
	return frappe.db.get_value(BOARD_DOCTYPE, row.name, ["revision", "last_save_id"], as_dict=True)


def save_document(user: str, board: str, document: str, base_revision: int, save_id: str) -> dict:
	"""Save a board's content.

	``base_revision`` is the revision the client last saw. If someone else saved since, this
	raises OqivaStaleRevision and writes nothing. ``save_id`` makes a retry safe: if a save
	reached the server but its reply was lost, sending it again returns the same result
	instead of a false conflict.
	"""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:edit")
	if not isinstance(save_id, str) or not ID.match(save_id):
		raise OqivaError(_("A save needs an id."))
	parsed, count = parse_document(document)
	# The row lock is what makes "check the revision, then write" one step. Without it two
	# saves could both read revision N and both write N+1.
	current = frappe.db.get_value(
		BOARD_DOCTYPE, row.name, ["revision", "last_save_id"], for_update=True, as_dict=True
	)
	if current.last_save_id == save_id:
		return {"revision": current.revision, "replayed": True}
	if int(base_revision) != current.revision:
		raise OqivaStaleRevision()
	revision = current.revision + 1
	frappe.db.set_value(
		BOARD_DOCTYPE,
		row.name,
		{
			"document": document,
			"revision": revision,
			"schema_version": parsed["schemaVersion"],
			"object_count": count,
			"last_save_id": save_id,
		},
	)
	return {"revision": revision, "replayed": False}
