"""The audit log: a record of events that are not document changes, such as an export."""

import json

import frappe
from frappe.utils import add_days, now_datetime

from oqiva.access.guard import service_write
from oqiva.constants import AUDIT_DOCTYPE, AUDIT_RETENTION_DAYS


def record(
	action: str,
	user: str,
	resource_type: str | None = None,
	resource_name: str | None = None,
	metadata: dict | None = None,
) -> None:
	"""Write one entry. Never raises: a failed log write must not break what it describes."""
	try:
		doc = frappe.get_doc(
			{
				"doctype": AUDIT_DOCTYPE,
				"action": action,
				"user": user,
				"resource_type": resource_type,
				"resource_name": resource_name,
				"ip": getattr(frappe.local, "request_ip", None),
				"metadata": json.dumps(metadata or {}),
			}
		)
		service_write(doc).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="Oqiva audit log write failed")


def prune_audit_log() -> None:
	"""Drop entries older than the retention period."""
	cutoff = add_days(now_datetime(), -AUDIT_RETENTION_DAYS)
	frappe.db.delete(AUDIT_DOCTYPE, {"creation": ["<", cutoff]})
	frappe.db.commit()  # nosemgrep -- a scheduled job owns its transaction
