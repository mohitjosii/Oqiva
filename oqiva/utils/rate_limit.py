"""Per-user rate limits that work on every Frappe 16 release.

Frappe's ``rate_limit`` decorator only learned to count requests per signed-in person (``user_based``)
in late October 2026. A site on an earlier Frappe 16 refuses to import an endpoint that asks for it
("rate_limit() got an unexpected keyword argument 'user_based'"), which breaks the whole app. This
module uses Frappe's own decorator when it can do the job and does the same counting itself when it
cannot, so Oqiva installs on both.
"""

import inspect
from collections.abc import Callable
from functools import wraps

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit as frappe_rate_limit


def supports_user_based(decorator: Callable) -> bool:
	"""True when ``decorator`` (Frappe's ``rate_limit``) accepts ``user_based``."""
	return "user_based" in inspect.signature(decorator).parameters


def _own_user_limit(limit: int | Callable, seconds: int, methods: str | list, ip_based: bool) -> Callable:
	"""A decorator counting requests per signed-in person (per address for guests) in the cache,
	the way Frappe's does."""

	def decorator(fn):
		counter = f"{fn.__module__}.{fn.__qualname__}"

		@wraps(fn)
		def wrapper(*args, **kwargs):
			request = frappe.request
			if not request or (methods != "ALL" and request.method and request.method.upper() not in methods):
				return fn(*args, **kwargs)

			user = frappe.session.user
			if user and user != "Guest":
				identity = user
			else:
				identity = (getattr(frappe.local, "request_ip", None) if ip_based else None) or "Guest"

			key = frappe.cache.make_key(f"oqiva-rl:{counter}:{identity}:{seconds}")
			# nosemgrep -- a raw counter (INCRBY is atomic); make_key already prefixes the site name
			if not frappe.cache.get(key):
				frappe.cache.setex(key, seconds, 0)
			count = frappe.cache.incrby(key, 1)
			if count > (limit() if callable(limit) else limit):
				error = getattr(frappe, "RateLimitExceededError", None) or frappe.TooManyRequestsError
				frappe.throw(
					_("You hit the rate limit because of too many requests. Please try after sometime."),
					error,
				)
			return fn(*args, **kwargs)

		return wrapper

	return decorator


def make_rate_limit(base: Callable) -> Callable:
	"""Build ``rate_limit`` on top of Frappe's decorator ``base`` (a parameter so both cases can be tested)."""
	native = supports_user_based(base)

	def rate_limit(
		limit: int | Callable = 5,
		seconds: int = 24 * 60 * 60,
		methods: str | list = "ALL",
		ip_based: bool = True,
		user_based: bool = False,
	):
		if native:
			return base(
				limit=limit, seconds=seconds, methods=methods, ip_based=ip_based, user_based=user_based
			)
		if not user_based:
			return base(limit=limit, seconds=seconds, methods=methods, ip_based=ip_based)
		return _own_user_limit(limit, seconds, methods, ip_based)

	return rate_limit


rate_limit = make_rate_limit(frappe_rate_limit)
