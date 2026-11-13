"""Read Oqiva Settings with safe fallbacks."""

import frappe

from oqiva.constants import SETTINGS_DEFAULTS


def get_setting(fieldname: str) -> int:
	"""Return a setting, or its default when the stored value is missing.

	Frappe hands back a Long Int field as text, so every setting is converted to a number.
	"""
	value = frappe.db.get_single_value("Oqiva Settings", fieldname)
	return SETTINGS_DEFAULTS[fieldname] if value in (None, "") else int(value)


def get_ai_settings() -> dict:
	"""The AI provider settings: ``provider`` (``none``, ``anthropic`` or ``gemini``), ``model`` and
	``api_key``. A blank model, or one that belongs to the other provider, becomes the provider's default.

	The key is stored encrypted (a Password field) and is only ever read here, on the server."""
	from frappe.utils.password import get_decrypted_password

	from oqiva.constants import AI_DEFAULT_MODELS, AI_MODEL_PREFIX, AI_PROVIDERS

	provider = frappe.db.get_single_value("Oqiva Settings", "ai_provider") or "none"
	provider = provider if provider in AI_PROVIDERS else "none"
	model = (frappe.db.get_single_value("Oqiva Settings", "ai_model") or "").strip()
	if provider != "none" and not model.startswith(AI_MODEL_PREFIX[provider]):
		model = AI_DEFAULT_MODELS[provider]
	return {
		"provider": provider,
		"model": model,
		"api_key": get_decrypted_password(
			"Oqiva Settings", "Oqiva Settings", "ai_api_key", raise_exception=False
		)
		or "",
	}
