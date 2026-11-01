"""Who can reach a board (T2.1, T2.2, T3.1 to T3.5, T3.8, T7.6)."""

import frappe
from frappe.tests import IntegrationTestCase

from oqiva.exceptions import OqivaForbidden, OqivaNotFound
from oqiva.services import board_service, member_service, project_service
from oqiva.tests.utils import make_user, make_world, share_board


class TestBoardAccess(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("acc")
		share_board(cls.w.board, cls.w.sharee, "view")

	def test_unrelated_user_gets_not_found_everywhere(self):
		"""Failure: an outsider is told nothing exists, whatever they try (T2.1)."""
		board, outsider = self.w.board, self.w.outsider
		calls = (
			lambda: board_service.get_board(outsider, board),
			lambda: board_service.open_board(outsider, board),
			lambda: board_service.update_board(outsider, board, title="Mine"),
			lambda: board_service.move_board(outsider, board, None),
			lambda: board_service.duplicate_board(outsider, board),
			lambda: board_service.set_archived(outsider, board, True),
			lambda: board_service.trash_board(outsider, board),
			lambda: board_service.restore_board(outsider, board),
			lambda: board_service.purge_board(outsider, board, "Roadmap"),
			lambda: board_service.set_favorite(outsider, board, True),
			lambda: board_service.create_board(outsider, self.w.workspace),
			lambda: board_service.list_boards(outsider, "all", self.w.workspace),
		)
		for call in calls:
			with self.assertRaises(OqivaNotFound):
				call()

	def test_unknown_board_is_indistinguishable(self):
		"""Boundary: a board that does not exist gives the same answer as one you cannot see."""
		with self.assertRaises(OqivaNotFound):
			board_service.get_board(self.w.member, "does-not-exist")

	def test_outsider_is_blocked_through_frappe_itself(self):
		"""Failure: the generic list and permission checks hide the board (T2.2)."""
		rows = frappe.get_list("Oqiva Board", user=self.w.outsider, filters={"workspace": self.w.workspace})
		self.assertEqual(rows, [])
		doc = frappe.get_doc("Oqiva Board", self.w.board)
		for ptype in ("read", "write", "delete", "share"):
			self.assertFalse(
				frappe.has_permission("Oqiva Board", ptype, doc=doc, user=self.w.outsider), ptype
			)
		self.assertTrue(frappe.has_permission("Oqiva Board", "read", doc=doc, user=self.w.member))

	def test_guest_without_a_share_sees_nothing(self):
		"""Failure: a workspace Guest cannot open boards nobody shared with them (T3.1)."""
		guest = make_user("acc_plain_guest@oqiva.test")
		member_service.add_member_row(self.w.workspace, guest, "Guest")
		with self.assertRaises(OqivaNotFound):
			board_service.get_board(guest, self.w.board)
		self.assertEqual(board_service.list_boards(guest, "all", self.w.workspace)["boards"], [])

	def test_guest_with_a_share_sees_only_that_board(self):
		"""Success: a share opens exactly one board to a Guest, read-only."""
		shared = board_service.create_board(self.w.member, self.w.workspace, None, "Shared with guest")[
			"name"
		]
		share_board(shared, self.w.guest, "view")
		detail = board_service.get_board(self.w.guest, shared)
		self.assertTrue(detail["capabilities"]["can_view"])
		self.assertFalse(detail["capabilities"]["can_edit"])
		with self.assertRaises(OqivaNotFound):
			board_service.get_board(self.w.guest, self.w.board)
		names = [
			b["name"] for b in board_service.list_boards(self.w.guest, "all", self.w.workspace)["boards"]
		]
		self.assertEqual(names, [shared])

	def test_viewer_share_cannot_change_anything(self):
		"""Failure: a view-only share is refused with forbidden, not not-found (T3.2)."""
		for call in (
			lambda: board_service.update_board(self.w.sharee, self.w.board, title="Nope"),
			lambda: board_service.move_board(self.w.sharee, self.w.board, None),
			lambda: board_service.duplicate_board(self.w.sharee, self.w.board),
			lambda: board_service.trash_board(self.w.sharee, self.w.board),
		):
			with self.assertRaises(OqivaForbidden):
				call()
		self.assertTrue(board_service.get_board(self.w.sharee, self.w.board)["capabilities"]["can_view"])

	def test_editor_share_edits_but_cannot_move_trash_or_duplicate(self):
		"""Success and failure: an Editor share renames, and nothing more (T3.4)."""
		editor = make_user("acc_editor@oqiva.test")
		share_board(self.w.board, editor, "edit")
		board_service.update_board(editor, self.w.board, description="Edited by share")
		for call in (
			lambda: board_service.move_board(editor, self.w.board, None),
			lambda: board_service.trash_board(editor, self.w.board),
			lambda: board_service.duplicate_board(editor, self.w.board),
		):
			with self.assertRaises(OqivaForbidden):
				call()

	def test_only_admins_and_creators_trash(self):
		"""Failure: a Member who did not create the board cannot trash it (T3.5)."""
		board = board_service.create_board(self.w.member, self.w.workspace, None, "Trash rules")["name"]
		with self.assertRaises(OqivaForbidden):
			board_service.trash_board(self.w.member2, board)
		board_service.trash_board(self.w.member, board)  # the creator
		board_service.restore_board(self.w.admin, board)  # an Admin
		board_service.trash_board(self.w.admin, board)
		self.assertTrue(frappe.db.get_value("Oqiva Board", board, "is_trashed"))

	def test_system_manager_without_membership_is_an_outsider(self):
		"""Failure: System Manager is not a back door into boards (T3.8)."""
		manager = make_user("acc_sysmgr@oqiva.test", ("System Manager",))
		with self.assertRaises(OqivaNotFound):
			board_service.get_board(manager, self.w.board)
		rows = frappe.get_list("Oqiva Board", user=manager, filters={"workspace": self.w.workspace})
		self.assertEqual(rows, [])
		doc = frappe.get_doc("Oqiva Board", self.w.board)
		self.assertFalse(frappe.has_permission("Oqiva Board", "read", doc=doc, user=manager))

	def test_writes_that_skip_the_services_are_refused(self):
		"""Failure: the doctypes refuse a direct write, even from Administrator (T7.6)."""
		frappe.set_user("Administrator")
		with self.assertRaises(OqivaForbidden):
			frappe.get_doc(
				{"doctype": "Oqiva Board", "workspace": self.w.workspace, "title": "Sneaky"}
			).insert()
		doc = frappe.get_doc("Oqiva Board", self.w.board)
		doc.title = "Changed directly"
		with self.assertRaises(OqivaForbidden):
			doc.save()
		with self.assertRaises(OqivaForbidden):
			frappe.delete_doc("Oqiva Board", self.w.board)

	def test_role_lookup_for_project_boundaries(self):
		"""Failure: a Guest can read a project but not create or trash one."""
		project = project_service.get_project(self.w.guest, self.w.project)
		self.assertEqual(project["project_name"], "Platform")
		with self.assertRaises(OqivaForbidden):
			project_service.create_project(self.w.guest, self.w.workspace, "Nope", None, "blue", None)
		with self.assertRaises(OqivaForbidden):
			project_service.trash_project(self.w.member, self.w.project)
