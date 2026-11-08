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
from oqiva.services import file_service
from oqiva.utils.settings import get_setting

SUPPORTED_SCHEMA = 1
ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
LIST_KEYS = ("objects", "connectors", "mindmaps", "flowcharts")
KNOWN_KINDS = ("shape", "text", "image", "table")
IMAGE_SRC = re.compile(r"^/private/files/[A-Za-z0-9._%()+~-]{1,200}$")
GEOMETRIES = ("straight", "elbow", "curved")
HEADS = ("none", "arrow", "open", "dot")
ANCHORS = ("n", "ne", "e", "se", "s", "sw", "w", "nw")
DASHES = ("solid", "dashed", "dotted")
TABLE_MAX_ROWS = 30
TABLE_MAX_COLS = 20
TABLE_MAX_CELL_CHARS = 50_000  # all the text in one table together
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


def _check_table(object_id: str, table) -> None:
	if not isinstance(table, dict):
		_bad(object_id, _("a table needs its cells."))
	row_heights, col_widths = table.get("rowH"), table.get("colW")
	for name, sizes, most in (("rows", row_heights, TABLE_MAX_ROWS), ("columns", col_widths, TABLE_MAX_COLS)):
		if not isinstance(sizes, list) or not 1 <= len(sizes) <= most:
			_bad(object_id, _("a table has between 1 and {0} {1}.").format(most, name))
		if not all(_number(size, 20, 2000) for size in sizes):
			_bad(object_id, _("a table's {0} are out of range.").format(name))
	for name in ("cells", "fills"):
		grid = table.get(name)
		if (
			not isinstance(grid, list)
			or len(grid) != len(row_heights)
			or any(not isinstance(row, list) or len(row) != len(col_widths) for row in grid)
		):
			_bad(object_id, _("a table's {0} do not match its rows and columns.").format(name))
	for row in table["fills"]:
		for fill in row:
			_check_color(object_id, "cell fill", fill)
	chars = 0
	for row in table["cells"]:
		for cell in row:
			_check_text(object_id, cell)
			if cell:
				chars += sum(len(run["t"]) for paragraph in cell["paragraphs"] for run in paragraph["runs"])
	if chars > TABLE_MAX_CELL_CHARS:
		_bad(object_id, _("the table's text is too long."))


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
	for flip in ("flipX", "flipY"):
		if flip in item and not isinstance(item[flip], bool):
			_bad(object_id, _("{0} must be true or false.").format(flip))
	if "groupId" in item and not (isinstance(item["groupId"], str) and ID.match(item["groupId"])):
		_bad(object_id, _("the group id is not valid."))
	if item["kind"] == "image":
		if not isinstance(item.get("src"), str) or not IMAGE_SRC.match(item["src"]):
			_bad(object_id, _("a picture must come from this board's files."))
		if "alt" in item and not (isinstance(item["alt"], str) and len(item["alt"]) <= 200):
			_bad(object_id, _("the picture description is too long."))
	if item["kind"] == "table":
		_check_table(object_id, item.get("table"))


def _check_end(connector_id: str, end) -> None:
	if not isinstance(end, dict):
		_bad(connector_id, _("a line end must be an object."))
	if "objectId" in end:
		if (
			not (isinstance(end["objectId"], str) and ID.match(end["objectId"]))
			or end.get("anchor") not in ANCHORS
		):
			_bad(connector_id, _("a line end is attached to something invalid."))
	elif not (_number(end.get("x"), -1e6, 1e6) and _number(end.get("y"), -1e6, 1e6)):
		_bad(connector_id, _("a free line end needs a position."))


def _check_connector(item, seen: set) -> None:
	if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not ID.match(item["id"]):
		raise OqivaError(_("A line has a missing or invalid id."))
	connector_id = item["id"]
	if connector_id in seen:
		_bad(connector_id, _("the id is used twice."))
	seen.add(connector_id)
	_check_end(connector_id, item.get("from"))
	_check_end(connector_id, item.get("to"))
	if item.get("geometry", "straight") not in GEOMETRIES:
		_bad(connector_id, _("the line shape is not recognised."))
	heads = item.get("heads", {})
	if not isinstance(heads, dict) or any(heads.get(end, "none") not in HEADS for end in ("start", "end")):
		_bad(connector_id, _("an arrowhead is not recognised."))
	if "bend" in item and not _number(item["bend"], -5000, 5000):
		_bad(connector_id, _("bend is out of range."))
	if not _number(item.get("z", 0), -1e9, 1e9):
		_bad(connector_id, _("z is out of range."))
	style = item.get("style")
	_check_style(connector_id, style)
	if isinstance(style, dict) and style.get("dash", "solid") not in DASHES:
		_bad(connector_id, _("the dash style is not recognised."))
	label = item.get("label")
	if label is not None and not (
		isinstance(label, dict) and isinstance(label.get("text"), str) and len(label["text"]) <= 200
	):
		_bad(connector_id, _("a line label is not valid."))


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
	for item in document["connectors"]:
		_check_connector(item, seen)
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
			"upload_max_bytes": get_setting("upload_max_bytes"),
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
	file_service.check_images(user, parsed)
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
