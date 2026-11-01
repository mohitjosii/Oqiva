"""Read Oqiva Settings with safe fallbacks."""

import frappe

from oqiva.constants import SETTINGS_DEFAULTS


def get_setting(fieldname: str):
	"""Return a setting, or its default when the stored value is missing."""
	value = frappe.db.get_single_value("Oqiva Settings", fieldname)
	return SETTINGS_DEFAULTS[fieldname] if value is None else value
