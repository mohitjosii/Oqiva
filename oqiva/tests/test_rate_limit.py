"""The rate limit helper that lets Oqiva run on Frappe 16 releases from before ``user_based`` existed."""

from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from oqiva.utils import rate_limit as rl


def old_frappe_rate_limit(key=None, limit=5, seconds=86400, methods="ALL", ip_based=True, endpoint=None):
	"""Frappe's decorator as it was before ``user_based`` was added (only the signature matters here)."""

	def decorator(fn):
		fn.old_frappe_args = {"limit": limit, "seconds": seconds, "methods": methods, "ip_based": ip_based}
		return fn

	return decorator


class TestRateLimitCompat(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self._user = frappe.session.user
		self._request = getattr(frappe.local, "request", None)
		self._ip = getattr(frappe.local, "request_ip", None)
		self.tag = frappe.generate_hash(length=8)

	def tearDown(self):
		frappe.session.user = self._user
		frappe.local.request = self._request
		frappe.local.request_ip = self._ip
		super().tearDown()

	def as_user(self, user, method="POST", ip="10.0.0.1"):
		frappe.session.user = user
		frappe.local.request = SimpleNamespace(method=method)
		frappe.local.request_ip = ip

	def limited(self, limit=2, **kwargs):
		"""An endpoint limited by the helper as an old Frappe would see it. A fresh name each call,
		so counters left in the cache by an earlier run cannot interfere."""
		decorator = rl.make_rate_limit(old_frappe_rate_limit)(
			limit=limit, seconds=30, methods=["POST"], ip_based=False, user_based=True, **kwargs
		)
		tag = self.tag

		def endpoint():
			return "ok"

		endpoint.__qualname__ = f"endpoint_{tag}"
		return decorator(endpoint)

	def test_it_detects_whether_frappe_knows_user_based(self):
		"""Success: a decorator with the argument is detected as supporting it, one without as not."""

		def new_style(key=None, limit=5, user_based=False):
			return None

		self.assertTrue(rl.supports_user_based(new_style))
		self.assertFalse(rl.supports_user_based(old_frappe_rate_limit))
		# and the real decorator of whichever Frappe is installed is read without error
		self.assertIn(rl.supports_user_based(frappe.rate_limiter.rate_limit), (True, False))

	def test_new_frappe_gets_the_arguments_it_understands(self):
		"""Success: when Frappe supports user_based the call is passed straight through, user_based included."""
		calls = []

		def new_frappe_rate_limit(
			key=None, limit=5, seconds=86400, methods="ALL", ip_based=True, endpoint=None, user_based=False
		):
			calls.append(
				{
					"limit": limit,
					"seconds": seconds,
					"methods": methods,
					"ip_based": ip_based,
					"user_based": user_based,
				}
			)
			return "decorator"

		result = rl.make_rate_limit(new_frappe_rate_limit)(
			limit=7, seconds=60, methods=["POST"], ip_based=False, user_based=True
		)
		self.assertEqual(result, "decorator")
		self.assertEqual(
			calls, [{"limit": 7, "seconds": 60, "methods": ["POST"], "ip_based": False, "user_based": True}]
		)

	def test_old_frappe_never_receives_the_argument_it_does_not_know(self):
		"""Success: an address-based limit goes to the old decorator without user_based (the reported crash)."""
		decorated = rl.make_rate_limit(old_frappe_rate_limit)(limit=20, seconds=60, ip_based=True)(lambda: 1)
		self.assertEqual(
			decorated.old_frappe_args, {"limit": 20, "seconds": 60, "methods": "ALL", "ip_based": True}
		)

	def test_a_person_is_limited_and_another_person_is_not(self):
		"""Success: the helper counts per signed-in person, so one person cannot use up another's allowance."""
		endpoint = self.limited(limit=2)
		self.as_user(f"a{self.tag}@example.com")
		self.assertEqual(endpoint(), "ok")
		self.assertEqual(endpoint(), "ok")
		with self.assertRaises(frappe.RateLimitExceededError):
			endpoint()
		self.as_user(f"b{self.tag}@example.com")
		self.assertEqual(endpoint(), "ok")

	def test_other_methods_are_not_counted(self):
		"""Boundary: a GET is not limited by a limit that names only POST."""
		endpoint = self.limited(limit=1)
		self.as_user(f"c{self.tag}@example.com", method="GET")
		for _i in range(4):
			self.assertEqual(endpoint(), "ok")

	def test_a_call_outside_a_request_is_not_limited(self):
		"""Boundary: a background job or a test calling the function directly has no request to count."""
		endpoint = self.limited(limit=1)
		frappe.local.request = None
		for _i in range(3):
			self.assertEqual(endpoint(), "ok")

	def test_guests_are_counted_by_address_when_asked(self):
		"""Boundary: a guest has no account, so the address stands in when the limit allows it."""
		decorator = rl.make_rate_limit(old_frappe_rate_limit)(
			limit=1, seconds=30, methods=["POST"], ip_based=True, user_based=True
		)

		def endpoint():
			return "ok"

		endpoint.__qualname__ = f"guest_endpoint_{self.tag}"
		limited = decorator(endpoint)
		self.as_user("Guest", ip=f"203.0.113.{int(self.tag[:2], 16) % 250}")
		self.assertEqual(limited(), "ok")
		with self.assertRaises(frappe.RateLimitExceededError):
			limited()

	def test_the_limit_can_be_a_function(self):
		"""Boundary: like Frappe's, the allowance may be given as a callable."""
		endpoint = self.limited(limit=lambda: 1)
		self.as_user(f"d{self.tag}@example.com")
		endpoint()
		with self.assertRaises(frappe.RateLimitExceededError):
			endpoint()

	def test_every_endpoint_module_imports_with_an_old_frappe_decorator(self):
		"""Success: the modules that use the helper import cleanly even when Frappe's decorator is the old one."""
		import importlib
		import sys

		names = ["board", "share", "comment", "version", "export", "ai"]
		old_helper = rl.make_rate_limit(old_frappe_rate_limit)
		saved = {n: sys.modules.get(f"oqiva.api.{n}") for n in names}
		try:
			with patch.object(rl, "rate_limit", old_helper):
				for n in names:
					sys.modules.pop(f"oqiva.api.{n}", None)
					module = importlib.import_module(f"oqiva.api.{n}")
					self.assertTrue(hasattr(module, "__name__"))
		finally:
			for n, module in saved.items():
				if module is not None:
					sys.modules[f"oqiva.api.{n}"] = module
