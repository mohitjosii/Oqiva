"""Access control: resolve who the caller is to a record, then apply the rules."""

from oqiva.access.rules import AccessContext, may
from oqiva.exceptions import OqivaForbidden


def require(ctx: AccessContext, action: str) -> None:
	"""Raise OqivaForbidden unless ``ctx`` may perform ``action``.

	Call this only after resolution succeeded, so the caller already has some
	relationship to the record and a 403 reveals nothing.
	"""
	if not may(ctx, action):
		raise OqivaForbidden()
