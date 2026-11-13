"""A sweep over every whitelisted endpoint (Phase 13, P13.01).

The per-feature tests prove each rule one at a time. This sweep proves nobody was forgotten: it lists
every endpoint the app exposes, and for each one checks that

* a signed-out caller is refused (except the few anonymous share-link endpoints, which are named),
* a stranger who holds the id of someone else's workspace, project, board, comment or link gets
  exactly "not found", never "forbidden" and never data (T2.1 to T2.4), and
* a new endpoint cannot be added without being put in one list or the other here.
"""

import importlib
import inspect
import pkgutil

import frappe
from frappe.tests import IntegrationTestCase

import oqiva.api as api_package
from oqiva.api import board as board_api
from oqiva.api import comment as comment_api
from oqiva.exceptions import OqivaNotFound
from oqiva.services import link_service, version_service
from oqiva.tests.test_document import doc
from oqiva.tests.utils import make_world


def endpoints() -> dict:
	"""Every whitelisted function in oqiva.api, by "module.function"."""
	found = {}
	for info in pkgutil.iter_modules(api_package.__path__):
		module = importlib.import_module(f"oqiva.api.{info.name}")
		for name, function in inspect.getmembers(module, inspect.isfunction):
			if function in frappe.whitelisted and function.__module__ == module.__name__:
				found[f"{info.name}.{name}"] = function
	return found


# Anonymous on purpose: they take a secret link token, never a record name.
GUEST_ENDPOINTS = {"share.link_file", "share.redeem_link", "share.view_shared"}

# Signed-in, but about the caller's own things or nobody's in particular: there is no record for a
# stranger to name.
OWN_OR_GLOBAL = {
	"ai.generate_diagram",  # an optional board is checked in test_ai.py
	"ai.result",  # keyed by the caller's own name
	"ai.status",
	"board.create_board",  # a workspace is named: see SCOPED
	"boot.get_boot",
	"boot.mark_welcomed",  # about the caller only
	"notification.list_notifications",
	"notification.mark_all_read",
	"notification.mark_read",  # only the caller's own rows match
	"notification.unread_count",
	"search.query",  # scoped before matching: test_search.py
	"template.get_template",
	"template.list_templates",
	"workspace.create_workspace",
	"workspace.list_workspaces",
	"board.list_boards",  # scoped to the caller: test_boards.py
	"board.upload_image",  # reads an upload; checked in test_files.py
	"board.save_thumbnail",  # reads an upload; checked in test_files.py
}


class TestEveryEndpointIsAccountedFor(IntegrationTestCase):
	def test_a_new_endpoint_must_be_added_to_the_sweep(self):
		found = set(endpoints())
		self.assertTrue(len(found) > 60, "the sweep found too few endpoints to be real")
		listed = GUEST_ENDPOINTS | OWN_OR_GLOBAL | set(SCOPED)
		self.assertEqual(
			found - listed,
			set(),
			"endpoints with no entry in the security sweep: add each to SCOPED (it names a record) "
			"or to OWN_OR_GLOBAL (it does not), and write its access test",
		)
		self.assertEqual(listed - found, set(), "the sweep lists an endpoint that no longer exists")

	def test_every_endpoint_has_typed_arguments_a_return_type_and_a_docstring(self):
		"""Frappe casts arguments from their type hints; without them a "0" or "False" stays a string."""
		for name, function in endpoints().items():
			signature = inspect.signature(function)
			for parameter in signature.parameters.values():
				self.assertIsNot(parameter.annotation, inspect.Parameter.empty, f"{name}.{parameter.name}")
			self.assertIsNot(signature.return_annotation, inspect.Signature.empty, f"{name}: return type")
			self.assertTrue((function.__doc__ or "").strip(), f"{name}: docstring")

	def test_the_anonymous_ones_are_the_only_ones_a_guest_may_call(self):
		for name, function in endpoints().items():
			self.assertEqual(
				function in frappe.guest_methods, name in GUEST_ENDPOINTS, f"{name}: guest access"
			)

	def test_every_other_endpoint_refuses_a_signed_out_caller(self):
		frappe.set_user("Guest")
		try:
			for name, function in endpoints().items():
				if name in GUEST_ENDPOINTS:
					continue
				stand_in = {"int": 1, "bool": True, "dict": {}, "list": []}
				args = [
					stand_in.get(getattr(p.annotation, "__name__", ""), "x")
					for p in inspect.signature(function).parameters.values()
					if p.default is p.empty
				]
				with self.assertRaises(frappe.PermissionError, msg=name):
					function(*args)
		finally:
			frappe.set_user("Administrator")


# endpoint -> how to call it with the ids of W1's things. Every call is made by a stranger.
SCOPED = {
	"board.archive_board": lambda w, x: ((w.board, True), {}),
	"board.duplicate_board": lambda w, x: ((w.board,), {}),
	"board.get_board": lambda w, x: ((w.board,), {}),
	"board.get_crdt_state": lambda w, x: ((w.board,), {}),
	"board.get_revision": lambda w, x: ((w.board,), {}),
	"board.import_board": lambda w, x: ((w.workspace, "{}"), {}),
	"board.load_document": lambda w, x: ((w.board,), {}),
	"board.move_board": lambda w, x: ((w.board, w.project), {}),
	"board.open_board": lambda w, x: ((w.board,), {}),
	"board.purge_board": lambda w, x: ((w.board, "Roadmap"), {}),
	"board.restore_board": lambda w, x: ((w.board,), {}),
	"board.save_document": lambda w, x: ((w.board, doc(), 1, "sweep", None), {}),
	"board.set_favorite": lambda w, x: ((w.board, True), {}),
	"board.trash_board": lambda w, x: ((w.board,), {}),
	"board.update_board": lambda w, x: ((w.board,), {"title": "Mine now"}),
	"comment.add_comment": lambda w, x: ((w.board, "hello", "point"), {"x": 1, "y": 1}),
	"comment.delete_comment": lambda w, x: ((x.comment,), {}),
	"comment.edit_comment": lambda w, x: ((x.comment, "changed"), {}),
	"comment.list_comments": lambda w, x: ((w.board,), {}),
	"comment.people": lambda w, x: ((w.board,), {}),
	"comment.reply": lambda w, x: ((x.comment, "reply"), {}),
	"comment.set_resolved": lambda w, x: ((x.comment, True), {}),
	"export.board_file": lambda w, x: ((w.board,), {}),
	"export.prepare": lambda w, x: ((w.board, "png"), {}),
	"project.archive_project": lambda w, x: ((w.project, True), {}),
	"project.create_project": lambda w, x: ((w.workspace, "Mine"), {}),
	"project.get_project": lambda w, x: ((w.project,), {}),
	"project.list_projects": lambda w, x: ((w.workspace,), {}),
	"project.restore_project": lambda w, x: ((w.project,), {}),
	"project.trash_project": lambda w, x: ((w.project,), {}),
	"project.update_project": lambda w, x: ((w.project,), {"project_name": "Mine"}),
	"realtime.authorize": None,  # answers {"access": None}, never an error: see the test below
	"share.add_person": lambda w, x: ((w.board, w.sharee, "view"), {}),
	"share.cancel_invite": lambda w, x: ((w.board, "x@example.com"), {}),
	"share.change_level": lambda w, x: ((w.board, w.sharee, "edit"), {}),
	"share.create_link": lambda w, x: ((w.board, "Viewer"), {}),
	"share.leave": lambda w, x: ((w.board,), {}),
	"share.list_links": lambda w, x: ((w.board,), {}),
	"share.list_shares": lambda w, x: ((w.board,), {}),
	"share.remove_person": lambda w, x: ((w.board, w.sharee), {}),
	"share.revoke_link": lambda w, x: ((x.link,), {}),
	"version.begin_restore": lambda w, x: ((w.board, 1), {}),
	"version.get_version": lambda w, x: ((w.board, 1), {}),
	"version.label_version": lambda w, x: ((w.board, 1, "mine"), {}),
	"version.list_versions": lambda w, x: ((w.board,), {}),
	"version.pin_version": lambda w, x: ((w.board, 1, True), {}),
	"version.restore_unopenable": lambda w, x: ((w.board, 1), {}),
	"version.save_version": lambda w, x: ((w.board, "mine"), {}),
	"workspace.change_member_role": lambda w, x: ((w.workspace, w.member, "Admin"), {}),
	"workspace.delete_workspace": lambda w, x: ((w.workspace,), {}),
	"workspace.invite_member": lambda w, x: ((w.workspace, "new@example.com", "Member"), {}),
	"workspace.leave_workspace": lambda w, x: ((w.workspace,), {}),
	"workspace.list_members": lambda w, x: ((w.workspace,), {}),
	"workspace.remove_member": lambda w, x: ((w.workspace, w.member), {}),
	"workspace.rename_workspace": lambda w, x: ((w.workspace, "Mine"), {}),
}


class TestStrangerGetsNotFoundFromEverything(IntegrationTestCase):
	"""T2.1 to T2.4 for every endpoint at once. The plan says 404 and never 403, so that a response
	never confirms that a record exists."""

	def setUp(self):
		super().setUp()
		self.w = make_world("sweep")
		frappe.set_user(self.w.member)
		made = comment_api.add_comment(self.w.board, "a thought", "point", x=1, y=1)
		self.extras = frappe._dict(
			comment=made["name"] if isinstance(made, dict) and "name" in made else made,
			link=link_service.create_link(self.w.member, self.w.board, "Viewer")["name"],
		)
		board_api.save_document(self.w.board, doc(), 1, "sweep-seed", None)
		version_service.save_named(self.w.member, self.w.board, "first")
		frappe.set_user(self.w.outsider)

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def test_every_scoped_endpoint_says_not_found_and_nothing_else(self):
		endpoint_map = endpoints()
		for name, build in SCOPED.items():
			if build is None:
				continue
			args, kwargs = build(self.w, self.extras)
			with self.assertRaises(OqivaNotFound, msg=f"{name}: a stranger must get not-found"):
				endpoint_map[name](*args, **kwargs)

	def test_the_realtime_check_tells_a_stranger_there_is_no_access(self):
		self.assertEqual(endpoints()["realtime.authorize"](self.w.board), {"access": None})


# What a person with only "view" access must never be able to do to the board, by any endpoint.
VIEWER_MAY_NOT = (
	"board.archive_board",
	"board.duplicate_board",
	"board.move_board",
	"board.purge_board",
	"board.restore_board",
	"board.save_document",
	"board.trash_board",
	"board.update_board",
	"comment.add_comment",
	"share.add_person",
	"share.change_level",
	"share.create_link",
	"share.list_links",
	"share.list_shares",
	"share.remove_person",
	"version.begin_restore",
	"version.get_version",
	"version.label_version",
	"version.pin_version",
	"version.restore_unopenable",
	"version.save_version",
)


class TestAViewerCanOnlyLook(IntegrationTestCase):
	"""T3.2 for every endpoint that changes a board or reaches beyond looking at it."""

	def setUp(self):
		super().setUp()
		from oqiva.tests.utils import share_board

		self.w = make_world("sweepv")
		self.viewer = self.w.sharee
		share_board(self.w.board, self.viewer, "view")
		frappe.set_user(self.w.member)
		made = comment_api.add_comment(self.w.board, "a thought", "point", x=1, y=1)
		self.extras = frappe._dict(comment=made["name"], link="unused")
		version_service.save_named(self.w.member, self.w.board, "first")
		frappe.set_user(self.viewer)

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def test_no_write_endpoint_works_for_a_viewer(self):
		from oqiva.exceptions import OqivaForbidden

		endpoint_map = endpoints()
		for name in VIEWER_MAY_NOT:
			args, kwargs = SCOPED[name](self.w, self.extras)
			with self.assertRaises(OqivaForbidden, msg=f"{name}: a viewer must be refused"):
				endpoint_map[name](*args, **kwargs)
