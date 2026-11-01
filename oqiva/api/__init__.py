"""Whitelisted API. Each endpoint is thin: it names the caller and calls one service."""

import frappe


def current_user() -> str:
	"""The signed-in user. Guests are refused."""
	user = frappe.session.user
	if user == "Guest":
		raise frappe.PermissionError
	return user
