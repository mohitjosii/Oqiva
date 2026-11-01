"""Read Oqiva Settings with safe fallbacks."""

import frappe

from oqiva.constants import SETTINGS_DEFAULTS


def get_setting(fieldname: str) -> int:
	"""Return a setting, or its default when the stored value is missing.

	Frappe hands back a Long Int field as text, so every setting is converted to a number.
	"""
	value = frappe.db.get_single_value("Oqiva Settings", fieldname)
	return SETTINGS_DEFAULTS[fieldname] if value in (None, "") else int(value)
