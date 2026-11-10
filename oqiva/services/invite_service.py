"""Inviting people to a workspace, and turning pending invites into membership."""

import frappe
from frappe import _
from frappe.exceptions import OutgoingEmailError
from frappe.utils import escape_html, get_url, validate_email_address

from oqiva.access import require, resolve
from oqiva.access.guard import service_write
from oqiva.constants import INVITE_ROLES
from oqiva.exceptions import OqivaConflict, OqivaError, OqivaForbidden, OqivaLimitExceeded
from oqiva.services import member_service

MAX_PENDING_INVITES = 100  # per workspace, so an invite box cannot be used to send mass email


def invite(actor: str, workspace: str, email: str, role: str) -> dict:
	"""Add a registered user at once, or record and email an invite for a new one."""
	if role not in INVITE_ROLES:
		raise OqivaError(_("Choose Admin, Member or Guest."))
	ctx = resolve.workspace_context(actor, workspace)
	require(ctx, "workspace:invite")
	if role == "Admin" and ctx.role != "Owner":
		raise OqivaForbidden(_("Only the workspace owner can invite an Admin."))
	address = (validate_email_address((email or "").strip(), throw=True) or "").lower()
	existing = frappe.db.get_value("User", {"email": address}, ["name", "enabled"], as_dict=True)
	if existing:
		return _add_registered(workspace, existing, role)
	return _record_invite(actor, workspace, address, role)


def _add_registered(workspace: str, user, role: str) -> dict:
	member_service.assert_addable_user(user.name)
	if resolve.workspace_role(user.name, workspace):
		raise OqivaConflict(_("That person is already a member."))
	member_service.add_member_row(workspace, user.name, role)
	return {"status": "added", "user": user.name}


def _record_invite(actor: str, workspace: str, address: str, role: str) -> dict:
	row = frappe.db.get_value("Oqiva Pending Invite", {"email": address, "workspace": workspace}, "name")
	if row:
		frappe.db.set_value("Oqiva Pending Invite", row, {"role": role, "invited_by_user": actor})
	else:
		if frappe.db.count("Oqiva Pending Invite", {"workspace": workspace}) >= MAX_PENDING_INVITES:
			raise OqivaLimitExceeded(
				_("This workspace has too many pending invites. Wait for some to be accepted.")
			)
		doc = service_write(frappe.new_doc("Oqiva Pending Invite"))
		doc.update({"email": address, "workspace": workspace, "role": role, "invited_by_user": actor})
		doc.insert(ignore_permissions=True)
	return {
		"status": "invited",
		"email": address,
		"email_sent": _send_invite_email(actor, workspace, address),
	}


def _send_invite_email(actor: str, workspace: str, address: str) -> bool:
	"""Queue the invite email. The invite stands even if the site cannot send mail."""
	workspace_name = frappe.db.get_value("Oqiva Workspace", workspace, "workspace_name")
	inviter = frappe.utils.get_fullname(actor)
	message = _(
		"<p>{0} invited you to join <b>{1}</b> on Oqiva.</p>"
		"<p>Sign up or log in with this email address to join: <a href='{2}'>{2}</a></p>"
	).format(escape_html(inviter), escape_html(workspace_name), get_url("/oqiva"))
	try:
		frappe.sendmail(
			recipients=[address],
			subject=_("{0} invited you to {1} on Oqiva").format(inviter, workspace_name),
			message=message,
			reference_doctype="Oqiva Workspace",
			reference_name=workspace,
		)
	except OutgoingEmailError:
		return False
	return True


def convert_for_email(user: str, email: str | None) -> int:
	"""Turn the pending invites for ``email`` into memberships. Returns how many joined."""
	address = (email or "").strip().lower()
	if not address:
		return 0
	from oqiva.services import share_service

	share_service.convert_board_invites(user, address)
	invites = frappe.get_all(
		"Oqiva Pending Invite",
		filters={"email": address, "workspace": ["is", "set"]},
		fields=["name", "workspace", "role"],
		limit_page_length=0,
	)
	if not invites:
		return 0
	workspaces = [i.workspace for i in invites]
	live = set(
		frappe.get_all("Oqiva Workspace", filters={"name": ["in", workspaces], "is_deleted": 0}, pluck="name")
	)
	already = set(
		frappe.get_all(
			"Oqiva Workspace Member",
			filters={"user": user, "workspace": ["in", workspaces]},
			pluck="workspace",
		)
	)
	joined = 0
	for item in invites:
		if item.workspace in live and item.workspace not in already:
			member_service.add_member_row(item.workspace, user, item.role)
			joined += 1
	frappe.db.delete("Oqiva Pending Invite", {"name": ["in", [i.name for i in invites]]})
	return joined


def convert_for_new_user(doc, method=None) -> None:
	"""User after_insert hook: join the workspaces this email was invited to."""
	convert_for_email(doc.name, doc.email)


def convert_for_user(user: str) -> int:
	"""Convert invites for an existing user, run when the app boots."""
	return convert_for_email(user, frappe.db.get_value("User", user, "email"))
