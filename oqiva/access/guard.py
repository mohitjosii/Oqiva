"""Write guard for Oqiva doctypes.

Rows are created and changed only by the services in ``oqiva.services``, which check
the caller against the rules table first. A controller calls ``assert_service_write``
so a write through ``/api/resource`` or the desk is refused even for a user whose
role would otherwise allow it.
"""

import frappe
from frappe import _

from oqiva.exceptions import OqivaForbidden


def service_write(doc):
	"""Mark ``doc`` as written by a service. Returns ``doc`` for chaining."""
	doc.flags.oqiva_service = True
	return doc


def assert_service_write(doc) -> None:
	"""Refuse a write that did not come from a service."""
	flags = frappe.flags
	if doc.flags.get("oqiva_service") or flags.in_install or flags.in_migrate or flags.in_patch:
		return
	if flags.in_import or flags.in_uninstall:
		return
	raise OqivaForbidden(_("{0} can only be changed through Oqiva.").format(_(doc.doctype)))
