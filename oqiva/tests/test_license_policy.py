"""The dependency licence allow-list (task P1.11)."""

import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_licenses.py"


def load_policy():
	spec = importlib.util.spec_from_file_location("check_licenses", SCRIPT)
	module = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(module)
	return module


class TestLicensePolicy(unittest.TestCase):
	def setUp(self):
		self.policy = load_policy()

	def test_permissive_licences_pass(self):
		"""Success: MIT-compatible licences and dual licences with a permissive option."""
		for expression in (
			"MIT",
			"ISC",
			"Apache-2.0",
			"(MPL-2.0 OR Apache-2.0)",
			"(MIT AND BSD-3-Clause)",
			"(MIT AND Zlib)",
		):
			self.assertTrue(self.policy.acceptable(expression), expression)

	def test_copyleft_and_unknown_licences_fail(self):
		"""Failure: copyleft, proprietary and unknown licences are rejected."""
		for expression in (
			"GPL-3.0",
			"AGPL-3.0-or-later",
			"LGPL-2.1",
			"MPL-2.0",
			"UNLICENSED",
			"(GPL-3.0 AND MIT)",
			"",
		):
			self.assertFalse(self.policy.acceptable(expression), expression)

	def test_every_shipped_dependency_is_allowed(self):
		"""Success: the frontend as installed passes the policy."""
		frontend = SCRIPT.parent.parent / "frontend" / "node_modules"
		if not frontend.exists():
			self.skipTest("frontend dependencies are not installed")
		rejected = [p for p in self.policy.shipped_packages() if not self.policy.acceptable(p[2])]
		self.assertEqual(rejected, [])
