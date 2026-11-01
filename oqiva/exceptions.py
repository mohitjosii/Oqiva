"""Typed errors for Oqiva.

Services raise these and let them propagate. Frappe maps each to an HTTP status
and returns the class name as ``exc_type``, which the SPA switches on:
``OqivaNotFound`` is 404, ``OqivaForbidden`` is 403, the rest are 417.

A user with no relationship to a record always gets ``OqivaNotFound`` and never
``OqivaForbidden``, so a response never confirms that a record exists.
"""

import frappe
from frappe import _


class OqivaError(frappe.ValidationError):
	"""Base for every expected Oqiva failure."""

	code = "OQIVA_ERROR"

	def __init__(self, message: str | None = None):
		super().__init__(message or self.default_message())

	@classmethod
	def default_message(cls) -> str:
		return _("Something went wrong. Please try again.")


class OqivaNotFound(frappe.DoesNotExistError):
	"""The record is missing, trashed, or the caller has no relationship to it."""

	code = "OQIVA_NOT_FOUND"

	def __init__(self, message: str | None = None):
		super().__init__(message or _("That item could not be found."))


class OqivaForbidden(frappe.PermissionError):
	"""The caller can see the record but may not do this to it."""

	code = "OQIVA_FORBIDDEN"

	def __init__(self, message: str | None = None):
		super().__init__(message or _("You do not have permission to do that."))


class OqivaConflict(OqivaError):
	"""The request is valid but clashes with the current state."""

	code = "OQIVA_CONFLICT"


class OqivaLimitExceeded(OqivaError):
	"""A configured fair-use limit would be exceeded."""

	code = "OQIVA_LIMIT_EXCEEDED"


class OqivaStaleRevision(OqivaConflict):
	"""A save was made against a revision that is no longer the current one."""

	code = "OQIVA_STALE_REVISION"

	@classmethod
	def default_message(cls) -> str:
		return _("This board was changed somewhere else. Reload to see the latest version.")


class OqivaDocumentTooNew(OqivaError):
	"""The stored document was written by a newer version of the app."""

	code = "OQIVA_DOCUMENT_TOO_NEW"
