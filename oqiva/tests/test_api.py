"""The whitelisted API surface: boot, HTTP methods, and the typed errors it returns (T7.5)."""

import importlib
import inspect

import frappe
from frappe.tests import IntegrationTestCase

from oqiva.access.guard import service_write
from oqiva.api import board, boot, project, realtime, search, workspace
from oqiva.constants import ROLE_USER
from oqiva.exceptions import OqivaNotFound
from oqiva.tests.utils import make_user, make_world, share_board

API_MODULES = ("boot", "workspace", "project", "board", "search", "realtime")
READ_ONLY_ENDPOINTS = {
	"list_workspaces",
	"list_members",
	"list_projects",
	"get_project",
	"list_boards",
	"get_board",
	"query",
	"authorize",
}


def whitelisted_functions():
	for name in API_MODULES:
		module = importlib.import_module(f"oqiva.api.{name}")
		for fn_name, fn in inspect.getmembers(module, inspect.isfunction):
			if fn.__module__ == module.__name__ and fn in frappe.whitelisted:
				yield f"{name}.{fn_name}", fn_name, fn


class TestApiSurface(IntegrationTestCase):
	def test_every_endpoint_is_typed_and_documented(self):
		"""Boundary: each whitelisted function has type hints on every argument and a docstring."""
		found = list(whitelisted_functions())
		self.assertGreaterEqual(len(found), 30)
		for label, _name, fn in found:
			self.assertTrue(fn.__doc__, f"{label} has no docstring")
			for param in inspect.signature(fn).parameters.values():
				self.assertIsNot(
					param.annotation, inspect.Parameter.empty, f"{label}({param.name}) is untyped"
				)

	def test_only_reads_accept_get(self):
		"""Failure: every endpoint that changes state is POST only (T7.5)."""
		for label, fn_name, fn in whitelisted_functions():
			methods = set(frappe.allowed_http_methods_for_whitelisted_func[fn])
			if fn_name in READ_ONLY_ENDPOINTS:
				self.assertIn("GET", methods, label)
			else:
				self.assertEqual(methods, {"POST"}, f"{label} must be POST only")

	def test_guest_is_refused(self):
		"""Failure: no endpoint works for Guest."""
		frappe.set_user("Guest")
		self.addCleanup(frappe.set_user, "Administrator")
		with self.assertRaises(frappe.PermissionError):
			workspace.list_workspaces()
		with self.assertRaises(frappe.PermissionError):
			boot.get_boot()


class TestBoot(IntegrationTestCase):
	def test_boot_prepares_a_new_user(self):
		"""Success: first boot grants the role and creates exactly one personal workspace."""
		email = make_user("boot_first@oqiva.test", roles=())
		self.assertNotIn(ROLE_USER, frappe.get_roles(email))
		frappe.set_user(email)
		self.addCleanup(frappe.set_user, "Administrator")
		first = boot.get_boot()
		second = boot.get_boot()
		self.assertEqual(first["personal_workspace"], second["personal_workspace"])
		self.assertEqual(len(second["workspaces"]), 1)
		self.assertTrue(second["workspaces"][0]["is_personal"])
		self.assertIn(ROLE_USER, frappe.get_roles(email))
		self.assertEqual(first["user"]["name"], email)
		self.assertEqual(first["limits"]["max_objects_per_board"], 3000)
		self.assertFalse(first["is_admin"])

	def test_boot_joins_pending_invites(self):
		"""Success: an invite recorded for an existing user's email is applied on boot."""
		w = make_world("bt")
		person = make_user("boot_invited@oqiva.test")
		invite = service_write(
			frappe.get_doc(
				{
					"doctype": "Oqiva Pending Invite",
					"email": person,
					"workspace": w.workspace,
					"role": "Member",
				}
			)
		)
		invite.insert(ignore_permissions=True)
		frappe.set_user(person)
		self.addCleanup(frappe.set_user, "Administrator")
		names = [x["name"] for x in boot.get_boot()["workspaces"]]
		self.assertIn(w.workspace, names)


class TestApiAsUser(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("api")

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_round_trip_for_a_member(self):
		"""Success: create a project and board and list them through the API."""
		frappe.set_user(self.w.member)
		created = project.create_project(self.w.workspace, "Via API", color="violet")
		new_board = board.create_board(self.w.workspace, created["name"], "API board")
		listed = board.list_boards(workspace=self.w.workspace, project=created["name"])
		self.assertEqual([b["name"] for b in listed["boards"]], [new_board["name"]])
		self.assertEqual(board.get_board(new_board["name"])["title"], "API board")
		self.assertEqual(search.query("api board")["boards"][0]["name"], new_board["name"])
		self.assertTrue(any(w["name"] == self.w.workspace for w in workspace.list_workspaces()))

	def test_api_errors_are_typed_for_an_outsider(self):
		"""Failure: the API raises the not-found error, which Frappe returns as HTTP 404."""
		frappe.set_user(self.w.outsider)
		with self.assertRaises(OqivaNotFound) as caught:
			board.get_board(self.w.board)
		self.assertEqual(caught.exception.http_status_code, 404)

	def test_workspace_creation_returns_the_listing_row(self):
		"""Success: create_workspace returns the new workspace with the caller as Owner."""
		frappe.set_user(self.w.member)
		row = workspace.create_workspace("Fresh space")
		self.assertEqual((row["role"], row["is_owner"], row["is_personal"]), ("Owner", True, False))


class TestRealtimeAuthorize(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("rt")
		share_board(cls.w.board, cls.w.sharee, "view")

	def tearDown(self):
		frappe.set_user("Administrator")

	def level(self, user):
		frappe.set_user(user)
		return realtime.authorize(self.w.board)["access"]

	def test_levels_follow_the_rules_table(self):
		"""Success and failure: members edit, a view share views, outsiders and guests get nothing."""
		self.assertEqual(self.level(self.w.member), "edit")
		self.assertEqual(self.level(self.w.sharee), "view")
		self.assertIsNone(self.level(self.w.outsider))
		self.assertIsNone(self.level(self.w.guest))

	def test_unknown_board_looks_like_no_access(self):
		"""Boundary: a board that does not exist answers the same as one you cannot see."""
		frappe.set_user(self.w.member)
		self.assertEqual(realtime.authorize("does-not-exist"), {"access": None})


class TestUninstall(IntegrationTestCase):
	def test_before_uninstall_removes_what_oqiva_made_outside_its_doctypes(self):
		"""Success: shares, roles and role assignments are cleaned up (the transaction is rolled back after)."""
		from oqiva import setup

		w = make_world("un")
		share_board(w.board, w.sharee, "view")
		self.assertTrue(frappe.db.exists("DocShare", {"share_doctype": "Oqiva Board", "share_name": w.board}))
		setup.before_uninstall()
		self.assertFalse(frappe.db.exists("DocShare", {"share_doctype": "Oqiva Board"}))
		self.assertFalse(frappe.db.exists("Role", ROLE_USER))
		self.assertFalse(frappe.db.exists("Has Role", {"role": ROLE_USER}))
