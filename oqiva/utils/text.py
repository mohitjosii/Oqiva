"""Input cleaning for names and descriptions."""

import re
import unicodedata

from frappe import _

from oqiva.exceptions import OqivaError

# C0/C1 controls, zero-width and bidi override characters. Newline and tab are
# handled separately so descriptions may keep them.
_STRIP = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]")
_SPACES = re.compile(r"\s+")
_SLUG_JUNK = re.compile(r"[^a-z0-9]+")


def clean_line(value: str | None, label: str, max_length: int, required: bool = True) -> str | None:
	"""Normalise a single-line value: NFC, no control characters, collapsed spaces."""
	text = _SPACES.sub(" ", _STRIP.sub("", unicodedata.normalize("NFC", value or ""))).strip()
	if not text:
		if required:
			raise OqivaError(_("{0} is required.").format(label))
		return None
	if len(text) > max_length:
		raise OqivaError(_("{0} must be {1} characters or fewer.").format(label, max_length))
	return text


def clean_text(value: str | None, label: str, max_length: int) -> str | None:
	"""Normalise a multi-line value. Empty input gives None."""
	text = _STRIP.sub("", unicodedata.normalize("NFC", value or "")).strip()
	if not text:
		return None
	if len(text) > max_length:
		raise OqivaError(_("{0} must be {1} characters or fewer.").format(label, max_length))
	return text


def slugify(value: str) -> str:
	"""Lower-case ASCII slug, at most 48 characters. Empty input gives 'workspace'."""
	ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
	return _SLUG_JUNK.sub("-", ascii_text.lower()).strip("-")[:48] or "workspace"
