"""Shared constants for Oqiva."""

import json

ROLE_USER = "Oqiva User"
ROLE_ADMIN = "Oqiva Admin"
APP_ROLES = ((ROLE_USER, 0), (ROLE_ADMIN, 1))

WORKSPACE_ROLES = ("Owner", "Admin", "Member", "Guest")
INVITE_ROLES = ("Admin", "Member", "Guest")
PROJECT_COLORS = ("gray", "blue", "green", "orange", "red", "violet", "teal", "pink")

BOARD_DOCTYPE = "Oqiva Board"
LINK_DOCTYPE = "Oqiva Share Link"
COMMENT_DOCTYPE = "Oqiva Comment"
MAX_COMMENT_CHARS = 5000
MAX_COMMENTS_PER_BOARD = 2000
MAX_REPLIES_PER_THREAD = 200
GRANT_DOCTYPE = "Oqiva Link Grant"
LINK_ACCESS = {"Viewer": "view", "Commenter": "comment", "Editor": "edit"}
AUDIT_DOCTYPE = "Oqiva Audit Log"
THUMBNAIL_MAX_BYTES = 256 * 1024
AUDIT_RETENTION_DAYS = 365
EXPORT_FORMATS = ("png", "jpeg", "svg", "pdf", "print")
EXPORT_SCOPES = ("board", "selection")

# Defaults for Oqiva Settings. Read through utils.settings.get_setting so a missing
# row (fresh install, or a value an admin blanked) still gives a safe limit.
SETTINGS_DEFAULTS = {
	"auto_grant_role": 1,
	"max_objects_per_board": 3000,
	"max_document_bytes": 5 * 1024 * 1024,
	"max_boards_per_workspace": 2000,
	"workspace_storage_bytes": 2 * 1024**3,
	"upload_max_bytes": 10 * 1024 * 1024,
	"trash_retention_days": 30,
	"auto_version_interval_min": 10,
	"version_retention": 50,
	"realtime_reauth_seconds": 15,
}

# A new board starts from this document. The schema is owned by the canvas engine
# (ARCHITECTURE section 15.2); Phase 3 adds validation and migrations.
EMPTY_DOCUMENT = {
	"schemaVersion": 1,
	"canvas": {"mode": "infinite", "background": None, "grid": "off"},
	"theme": {"preset": "ocean"},
	"objects": [],
	"connectors": [],
	"mindmaps": [],
	"flowcharts": [],
}


def empty_document_json() -> str:
	return json.dumps(EMPTY_DOCUMENT, separators=(",", ":"))


# Doctypes holding rows that point at a board. Purging a board deletes their rows.
# Later phases append here (comments, versions, links, grants).
BOARD_CHILD_DOCTYPES = (
	("Oqiva Board View", "board"),
	("Oqiva Favorite", "board"),
	("Oqiva Link Grant", "board"),
	("Oqiva Share Link", "board"),
	("Oqiva Pending Invite", "board"),
	("Oqiva Comment", "board"),
)
