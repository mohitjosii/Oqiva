"""Pictures on boards, and the board's thumbnail.

A picture is a private File attached to its board, so Frappe's own file permission check
(which asks the board's permission hook) decides who may fetch it. The document stores only
the file's URL, never the picture. Only PNG, JPEG, GIF and WebP are accepted, recognised by
their first bytes rather than the name or the type the browser claims; SVG is refused because
it can carry script.
"""

import uuid

import frappe
from frappe import _

from oqiva.access import may, require, resolve
from oqiva.constants import BOARD_DOCTYPE, THUMBNAIL_MAX_BYTES
from oqiva.exceptions import OqivaError, OqivaForbidden, OqivaLimitExceeded, OqivaNotFound
from oqiva.services import audit_service
from oqiva.utils.settings import get_setting

SIGNATURES = (
	(b"\x89PNG\r\n\x1a\n", ".png", "image/png"),
	(b"\xff\xd8\xff", ".jpg", "image/jpeg"),
	(b"GIF87a", ".gif", "image/gif"),
	(b"GIF89a", ".gif", "image/gif"),
)


def sniff_image(content: bytes) -> tuple[str, str] | None:
	"""The extension and type of a supported picture, or None."""
	for magic, ext, mime in SIGNATURES:
		if content.startswith(magic):
			return ext, mime
	if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
		return ".webp", "image/webp"
	return None


def storage_used(workspace: str) -> int:
	"""Bytes of files attached to the workspace's boards. Worked out when asked, so it can't drift."""
	boards = frappe.get_all(BOARD_DOCTYPE, filters={"workspace": workspace}, pluck="name")
	if not boards:
		return 0
	file = frappe.qb.DocType("File")
	row = (
		frappe.qb.from_(file)
		.select(frappe.query_builder.functions.Sum(file.file_size))
		.where(file.attached_to_doctype == BOARD_DOCTYPE)
		.where(file.attached_to_name.isin(boards))
		.run()
	)
	return int(row[0][0] or 0)


def _store(row, content: bytes, ext: str, **extra):
	file = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{uuid.uuid4().hex}{ext}",  # never the name the user gave
			"is_private": 1,
			"attached_to_doctype": BOARD_DOCTYPE,
			"attached_to_name": row.name,
			"content": content,
			**extra,
		}
	)
	file.flags.ignore_permissions = True
	file.insert()
	return file


def upload_image(user: str, board: str, content: bytes) -> dict:
	"""Store a picture for a board. Returns the URL to put in an image object."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:edit")
	if not content:
		raise OqivaError(_("No picture was sent."))
	if len(content) > get_setting("upload_max_bytes"):
		raise OqivaLimitExceeded(_("That picture is too large."))
	kind = sniff_image(content)
	if not kind:
		audit_service.record("upload.rejected", user, BOARD_DOCTYPE, row.name, {"reason": "type"})
		raise OqivaError(_("Only PNG, JPEG, GIF and WebP pictures can be added."))
	if storage_used(row.workspace) + len(content) > get_setting("workspace_storage_bytes"):
		raise OqivaLimitExceeded(_("This workspace has run out of storage."))
	file = _store(row, content, kind[0])
	return {"src": file.file_url, "file": file.name, "size": len(content), "content_type": kind[1]}


def save_thumbnail(user: str, board: str, content: bytes) -> dict:
	"""Replace the board's thumbnail with a small PNG."""
	ctx, row = resolve.board_context(user, board)
	require(ctx, "board:edit")
	if not content or len(content) > THUMBNAIL_MAX_BYTES:
		raise OqivaError(_("The thumbnail is missing or too large."))
	kind = sniff_image(content)
	if not kind or kind[1] != "image/png":
		raise OqivaError(_("A thumbnail must be a PNG."))
	previous = frappe.db.get_value(BOARD_DOCTYPE, row.name, "thumbnail")
	file = _store(row, content, ".png")
	frappe.db.set_value(BOARD_DOCTYPE, row.name, "thumbnail", file.file_url, update_modified=False)
	if previous and previous != file.file_url:
		_drop_file(previous, row.name)
	return {"thumbnail": file.file_url}


def _drop_file(url: str, board: str) -> None:
	"""Delete an old thumbnail's file, only if it is one of this board's own."""
	names = frappe.get_all(
		"File",
		filters={"file_url": url, "attached_to_doctype": BOARD_DOCTYPE, "attached_to_name": board},
		pluck="name",
	)
	for name in names:
		frappe.delete_doc("File", name, ignore_permissions=True, force=True)


def check_images(user: str, document: dict) -> None:
	"""Refuse a document whose pictures are not ones this user may use.

	A picture must be a private file attached to a board the user can view. That lets a
	copy of a picture travel between a person's own boards, and stops a document pointing
	at someone else's file.
	"""
	sources = {o["src"] for o in document["objects"] if isinstance(o, dict) and o.get("kind") == "image"}
	if not sources:
		return
	rows = frappe.get_all(
		"File",
		filters={"file_url": ["in", list(sources)], "is_private": 1},
		fields=["file_url", "attached_to_doctype", "attached_to_name"],
	)
	allowed: dict[str, bool] = {}
	found = set()
	for row in rows:
		if row.attached_to_doctype != BOARD_DOCTYPE or not row.attached_to_name:
			continue
		if row.attached_to_name not in allowed:
			allowed[row.attached_to_name] = _may_view(user, row.attached_to_name)
		if allowed[row.attached_to_name]:
			found.add(row.file_url)
	if sources - found:
		raise OqivaError(_("A picture on this board is not available."))


def _may_view(user: str, board: str) -> bool:
	try:
		ctx, _row = resolve.board_context(user, board)
	except OqivaNotFound, OqivaForbidden:
		return False
	return may(ctx, "board:view")
