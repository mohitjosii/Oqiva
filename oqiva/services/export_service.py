"""Exporting a board. The picture or file is drawn in the browser from the same description
the editor uses; the server's part is to check the caller may export, keep a record, and
choose a safe file name."""

import re

import frappe
from frappe import _

from oqiva.access import require, resolve
from oqiva.constants import BOARD_DOCTYPE, EXPORT_FORMATS, EXPORT_SCOPES
from oqiva.exceptions import OqivaError
from oqiva.services import audit_service

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
