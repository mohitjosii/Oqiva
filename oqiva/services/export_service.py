"""Exporting a board. The picture or file is drawn in the browser from the same description
the editor uses; the server's part is to check the caller may export, keep a record, and
choose a safe file name."""

import json
import re

import frappe
from frappe import _

from oqiva.access import require, resolve
from oqiva.constants import BOARD_DOCTYPE, EXPORT_FORMATS, EXPORT_SCOPES
from oqiva.exceptions import OqivaDocumentTooNew, OqivaError, OqivaLimitExceeded
from oqiva.services import audit_service
from oqiva.utils.settings import get_setting
from oqiva.utils.text import clean_line

EXTENSIONS = {"png": "png", "jpeg": "jpg", "svg": "svg", "pdf": "pdf", "print": None}


def safe_filename(title: str | None, extension: str | None) -> str:
	"""A file name that is safe on every system: letters, digits, spaces, dashes."""
	stem = re.sub(r"[^\w\- ]+", "", title or "", flags=re.UNICODE).strip().replace(" ", "-")[:80]
	stem = stem or "board"
	return f"{stem}.{extension}" if extension else stem


def prepare(user: str, board: str, format: str, scope: str = "board") -> dict:
	"""Check an export is allowed, record it, and say what to call the file."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:export")
	if format not in EXPORT_FORMATS or scope not in EXPORT_SCOPES:
		raise OqivaError(_("That export is not available."))
	title = frappe.db.get_value(BOARD_DOCTYPE, row.name, "title")
	audit_service.record("export", user, BOARD_DOCTYPE, row.name, {"format": format, "scope": scope})
	return {"filename": safe_filename(title, EXTENSIONS[format]), "format": format, "scope": scope}


# ----- the .oqiva.json file -----

FILE_FORMAT = "oqiva-board"
FILE_VERSION = 1
FILE_WRAPPER_BYTES = 8192  # room for the title and the other fields around the document


def board_file(user: str, board: str) -> dict:
	"""A board's content as an ``.oqiva.json`` file: its document with a small header, no comments,
	no collaboration state, no shares. Pictures are named in it but not carried."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:export")
	stored = frappe.db.get_value(
		BOARD_DOCTYPE, row.name, ["title", "document", "schema_version"], as_dict=True
	)
	try:
		document = json.loads(stored.document or "{}")
	except ValueError:
		raise OqivaError(_("This board's content cannot be exported."))
	body = {
		"format": FILE_FORMAT,
		"formatVersion": FILE_VERSION,
		"schemaVersion": document.get("schemaVersion", 1),
		"title": stored.title,
		"exportedOn": frappe.utils.now_datetime().isoformat(timespec="seconds"),
		"document": document,
	}
	audit_service.record("export", user, BOARD_DOCTYPE, row.name, {"format": "json", "scope": "board"})
	return {
		"filename": safe_filename(stored.title, "oqiva.json"),
		"content": json.dumps(body, ensure_ascii=False),
	}


def _without_pictures(document: dict) -> int:
	"""Take picture objects, and the lines attached to them, out of an imported document."""
	gone = {o["id"] for o in document["objects"] if isinstance(o, dict) and o.get("kind") == "image"}
	if not gone:
		return 0
	document["objects"] = [
		o for o in document["objects"] if not (isinstance(o, dict) and o.get("id") in gone)
	]

	def attached(end) -> bool:
		return isinstance(end, dict) and end.get("objectId") in gone

	document["connectors"] = [
		c
		for c in document["connectors"]
		if not (isinstance(c, dict) and (attached(c.get("from")) or attached(c.get("to"))))
	]
	return len(gone)


def read_board_file(content: str) -> dict:
	"""Check an uploaded ``.oqiva.json`` and return what a board needs: ``document`` (text),
	``title``, ``schema_version``, ``object_count`` and ``dropped_pictures``.

	Refuses a file that is not one of ours, is from a newer format, is over the size limit, or holds
	a document that would not be accepted on a save."""
	from oqiva.services.document_service import SUPPORTED_SCHEMA, parse_document

	if not isinstance(content, str) or not content.strip():
		raise OqivaError(_("Choose an Oqiva board file."))
	if len(content.encode("utf-8")) > get_setting("max_document_bytes") + FILE_WRAPPER_BYTES:
		raise OqivaLimitExceeded(_("This file is too large to import."))
	try:
		data = json.loads(content)
	except ValueError:
		raise OqivaError(_("This is not an Oqiva board file."))
	if not isinstance(data, dict) or data.get("format") != FILE_FORMAT:
		raise OqivaError(_("This is not an Oqiva board file."))
	file_version = data.get("formatVersion")
	if not isinstance(file_version, int) or isinstance(file_version, bool) or file_version < 1:
		raise OqivaError(_("This is not an Oqiva board file."))
	if file_version > FILE_VERSION:
		raise OqivaDocumentTooNew(_("This file was made by a newer version of Oqiva."))
	document = data.get("document")
	if not isinstance(document, dict):
		raise OqivaError(_("This file has no board in it."))
	if isinstance(document.get("schemaVersion"), int) and document["schemaVersion"] > SUPPORTED_SCHEMA:
		raise OqivaDocumentTooNew(_("This board was saved by a newer version of Oqiva."))
	for key in ("objects", "connectors"):
		document.setdefault(key, [])
		if not isinstance(document[key], list):
			raise OqivaError(_("This file's board is not valid."))
	dropped = _without_pictures(document)
	raw = json.dumps(document, ensure_ascii=False)
	parsed, count = parse_document(raw)
	title = data.get("title")
	return {
		"document": raw,
		"title": clean_line(title, _("Board name"), 120, required=False) if isinstance(title, str) else None,
		"schema_version": parsed["schemaVersion"],
		"object_count": count,
		"dropped_pictures": dropped,
	}
