"""Board lifecycle, lists, favourites and projects (T8.1 to T8.3)."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, now_datetime

from oqiva.exceptions import OqivaConflict, OqivaError, OqivaLimitExceeded, OqivaNotFound
from oqiva.services import board_service, project_service, trash_service
from oqiva.tests.utils import make_world, share_board


class TestBoardLifecycle(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("bd")

	def new_board(self, title="Scratch", project=None, user=None):
		return board_service.create_board(user or self.w.member, self.w.workspace, project, title)["name"]

	def test_create_gives_a_blank_editable_board(self):
		"""Success: a new board has a blank document, revision 1 and full capabilities."""
		board = board_service.create_board(self.w.member, self.w.workspace, None, "  My   board ")
		self.assertEqual(board["title"], "My board")
		self.assertEqual(board["revision"], 1)
		self.assertTrue(board["capabilities"]["can_edit"] and board["capabilities"]["can_trash"])
		document = frappe.parse_json(frappe.db.get_value("Oqiva Board", board["name"], "document"))
		self.assertEqual(document["schemaVersion"], 1)
		self.assertEqual(document["objects"], [])

	def test_default_title_and_validation(self):
		"""Boundary: a missing title becomes Untitled board; bad input is refused."""
		self.assertEqual(
			board_service.create_board(self.w.member, self.w.workspace)["title"], "Untitled board"
		)
		with self.assertRaises(OqivaError):
			board_service.create_board(self.w.member, self.w.workspace, None, "x" * 121)
		with self.assertRaises(OqivaError):
			board_service.create_board(self.w.member, self.w.workspace, "no-such-project")

	def test_project_must_belong_to_the_workspace(self):
		"""Failure: a board cannot be put in another workspace's project."""
		foreign = project_service.create_project(
			self.w.outsider, self.w.other_workspace, "Elsewhere", None, "red", None
		)
		with self.assertRaises(OqivaError):
			board_service.create_board(self.w.member, self.w.workspace, foreign["name"])
		with self.assertRaises(OqivaError):
			board_service.move_board(self.w.member, self.w.board, foreign["name"])

	def test_board_limit(self):
		"""Failure: a workspace at its board limit cannot add another (fair-use limit)."""
		frappe.db.set_single_value("Oqiva Settings", "max_boards_per_workspace", 1)
		self.addCleanup(frappe.db.set_single_value, "Oqiva Settings", "max_boards_per_workspace", 2000)
		with self.assertRaises(OqivaLimitExceeded):
			self.new_board("Over the limit")
		with self.assertRaises(OqivaLimitExceeded):
			board_service.duplicate_board(self.w.member, self.w.board)

	def test_rename_move_and_duplicate(self):
		"""Success: rename, move to the root and back, and duplicate keep the data right."""
		board = self.new_board("Original", self.w.project)
		board_service.update_board(self.w.member, board, title="Renamed", description="About it")
		moved = board_service.move_board(self.w.member, board, None)
		self.assertIsNone(moved["project"])
		board_service.move_board(self.w.member, board, self.w.project)
		copy = board_service.duplicate_board(self.w.member2, board)
		self.assertEqual(copy["title"], "Copy of Renamed")
		self.assertEqual(copy["project"], self.w.project)
		self.assertEqual(copy["creator_name"], frappe.utils.get_fullname(self.w.member2))
		self.assertNotEqual(copy["name"], board)

	def test_trash_restore_purge(self):
		"""Success: trash, restore, and a typed-name purge that removes every trace."""
		board = self.new_board("Doomed")
		board_service.set_favorite(self.w.member, board, True)
		board_service.open_board(self.w.member, board)
		share_board(board, self.w.sharee, "view")
		board_service.trash_board(self.w.member, board)
		with self.assertRaises(OqivaNotFound):
			board_service.open_board(self.w.member, board)
		self.assertTrue(board_service.get_board(self.w.member, board)["is_trashed"])
		board_service.restore_board(self.w.member, board)
		with self.assertRaises(OqivaConflict):
			board_service.purge_board(self.w.member, board, "Doomed")
		board_service.trash_board(self.w.member, board)
		with self.assertRaises(OqivaError):
			board_service.purge_board(self.w.member, board, "wrong name")
		board_service.purge_board(self.w.member, board, "Doomed")
		self.assertFalse(frappe.db.exists("Oqiva Board", board))
		self.assertFalse(frappe.db.exists("Oqiva Favorite", {"board": board}))
		self.assertFalse(frappe.db.exists("Oqiva Board View", {"board": board}))
		self.assertFalse(frappe.db.exists("DocShare", {"share_doctype": "Oqiva Board", "share_name": board}))

	def test_project_trash_cascades_and_restores_only_its_own_boards(self):
		"""Success: restoring a project brings back the boards trashed with it, not others (T8.1)."""
		project = project_service.create_project(
			self.w.admin, self.w.workspace, "Cascade", None, "green", None
		)["name"]
		with_project = self.new_board("Goes with project", project)
		trashed_earlier = self.new_board("Trashed alone", project)
		board_service.trash_board(self.w.member, trashed_earlier)
		project_service.trash_project(self.w.admin, project)
		self.assertTrue(frappe.db.get_value("Oqiva Board", with_project, "is_trashed"))
		project_service.restore_project(self.w.admin, project)
		self.assertFalse(frappe.db.get_value("Oqiva Board", with_project, "is_trashed"))
		self.assertTrue(frappe.db.get_value("Oqiva Board", trashed_earlier, "is_trashed"))
		self.assertFalse(frappe.db.get_value("Oqiva Project", project, "is_trashed"))

	def test_board_restored_under_a_trashed_project_returns_to_the_root(self):
		"""Boundary: restoring one board while its project is in Trash puts it at the root (T8.2)."""
		project = project_service.create_project(self.w.admin, self.w.workspace, "Gone", None, "red", None)[
			"name"
		]
		board = self.new_board("Orphan", project)
		project_service.trash_project(self.w.admin, project)
		restored = board_service.restore_board(self.w.admin, board)
		self.assertIsNone(restored["project"])
		self.assertFalse(restored["is_trashed"])

	def test_expired_trash_is_purged_and_recent_trash_kept(self):
		"""Success: the daily job deletes boards trashed 31 days ago, not 29 (T8.3)."""
		old = self.new_board("Old trash")
		fresh = self.new_board("Fresh trash")
		board_service.trash_board(self.w.member, old)
		board_service.trash_board(self.w.member, fresh)
		frappe.db.set_value("Oqiva Board", old, "trashed_on", add_days(now_datetime(), -31))
		frappe.db.set_value("Oqiva Board", fresh, "trashed_on", add_days(now_datetime(), -29))
		old_project = project_service.create_project(
			self.w.admin, self.w.workspace, "Old project", None, "gray", None
		)["name"]
		project_service.trash_project(self.w.admin, old_project)
		frappe.db.set_value("Oqiva Project", old_project, "trashed_on", add_days(now_datetime(), -40))
		with patch.object(frappe.db, "commit"):  # the job commits; the test must stay in its transaction
			trash_service.purge_expired_trash()
		self.assertFalse(frappe.db.exists("Oqiva Board", old))
		self.assertTrue(frappe.db.exists("Oqiva Board", fresh))
		self.assertFalse(frappe.db.exists("Oqiva Project", old_project))

	def test_archive_hides_from_the_default_list(self):
		"""Success: archived boards leave the main list and appear under archived."""
		board = self.new_board("Shelved")
		board_service.set_archived(self.w.member, board, True)

		def names(scope):
			return [
				b["name"] for b in board_service.list_boards(self.w.member, scope, self.w.workspace)["boards"]
			]

		self.assertNotIn(board, names("all"))
		self.assertIn(board, names("archived"))
		board_service.set_archived(self.w.member, board, False)
		self.assertIn(board, names("all"))

	def test_project_archive_and_edit(self):
		"""Success: projects can be edited and archived; bad colours are refused."""
		project = project_service.create_project(
			self.w.member, self.w.workspace, "Editable", "Text", "teal", "star"
		)
		updated = project_service.update_project(
			self.w.member, project["name"], project_name="Edited", description=""
		)
		self.assertEqual((updated["project_name"], updated["description"]), ("Edited", None))
		with self.assertRaises(OqivaError):
			project_service.update_project(self.w.member, project["name"], color="chartreuse")
		project_service.set_archived(self.w.admin, project["name"], True)
		listed = [p["name"] for p in project_service.list_projects(self.w.member, self.w.workspace)]
		self.assertNotIn(project["name"], listed)
		with_archived = [
			p["name"] for p in project_service.list_projects(self.w.member, self.w.workspace, True)
		]
		self.assertIn(project["name"], with_archived)

	def test_project_board_counts(self):
		"""Success: the project list reports live board counts to members only."""
		project = project_service.create_project(
			self.w.member, self.w.workspace, "Counted", None, "blue", None
		)["name"]
		self.new_board("One", project)
		gone = self.new_board("Two", project)
		board_service.trash_board(self.w.member, gone)
		counts = {
			p["name"]: p["board_count"]
			for p in project_service.list_projects(self.w.member, self.w.workspace)
		}
		self.assertEqual(counts[project], 1)
		guest_counts = {
			p["name"]: p["board_count"] for p in project_service.list_projects(self.w.guest, self.w.workspace)
		}
		self.assertEqual(guest_counts[project], 0)


class TestBoardLists(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("ls")
		cls.extra = [
			board_service.create_board(cls.w.member, cls.w.workspace, None, f"Board {i}")["name"]
			for i in range(5)
		]

	def names(self, user, scope, **kwargs):
		result = board_service.list_boards(user, scope, kwargs.pop("workspace", self.w.workspace), **kwargs)
		return [b["name"] for b in result["boards"]]

	def test_all_lists_newest_first_and_pages(self):
		"""Success: the main list is newest-first and reports another page."""
		page = board_service.list_boards(self.w.member, "all", self.w.workspace, limit=2)
		self.assertEqual(len(page["boards"]), 2)
		self.assertTrue(page["has_more"])
		second = board_service.list_boards(self.w.member, "all", self.w.workspace, limit=2, start=2)
		self.assertNotEqual({b["name"] for b in page["boards"]}, {b["name"] for b in second["boards"]})
		everything = board_service.list_boards(self.w.member, "all", self.w.workspace, limit=100)
		self.assertFalse(everything["has_more"])

	def test_rows_carry_what_the_tile_needs(self):
		"""Success: rows include project, favourite flag, creator and capabilities."""
		row = next(
			b
			for b in board_service.list_boards(self.w.member, "all", self.w.workspace)["boards"]
			if b["name"] == self.w.board
		)
		self.assertEqual(row["project_name"], "Platform")
		self.assertEqual(row["creator_name"], frappe.utils.get_fullname(self.w.member))
		self.assertFalse(row["is_favorite"])
		self.assertEqual(row["workspace_role"], "Member")
		self.assertTrue(row["capabilities"]["can_edit"])

	def test_project_filter(self):
		"""Success: filtering by project returns only that project's boards."""
		self.assertEqual(self.names(self.w.member, "all", project=self.w.project), [self.w.board])

	def test_favorites_toggle_is_idempotent_and_per_user(self):
		"""Success: starring twice keeps one row, and other users do not see it."""
		board = self.extra[0]
		board_service.set_favorite(self.w.member, board, True)
		board_service.set_favorite(self.w.member, board, True)
		self.assertEqual(frappe.db.count("Oqiva Favorite", {"user": self.w.member, "board": board}), 1)
		self.assertEqual(self.names(self.w.member, "favorites"), [board])
		self.assertEqual(self.names(self.w.member2, "favorites"), [])
		board_service.set_favorite(self.w.member, board, False)
		self.assertEqual(self.names(self.w.member, "favorites"), [])

	def test_recent_orders_by_the_users_own_opens(self):
		"""Success: Recent is ordered by when this user last opened each board."""
		first, second = self.extra[1], self.extra[2]
		board_service.open_board(self.w.member2, first)
		frappe.db.set_value(
			"Oqiva Board View",
			{"board": first, "user": self.w.member2},
			"last_opened_on",
			add_days(now_datetime(), -1),
		)
		board_service.open_board(self.w.member2, second)
		self.assertEqual(self.names(self.w.member2, "recent")[:2], [second, first])
		self.assertEqual(self.names(self.w.owner, "recent"), [])
		board_service.open_board(self.w.member2, first)
		self.assertEqual(frappe.db.count("Oqiva Board View", {"board": first, "user": self.w.member2}), 1)
		self.assertEqual(self.names(self.w.member2, "recent")[0], first)

	def test_shared_with_me_lists_only_boards_from_other_workspaces(self):
		"""Success: Shared lists boards shared with you where you are not a Member, newest first."""
		share_board(self.extra[3], self.w.sharee, "comment")
		shared = board_service.list_boards(self.w.sharee, "shared")["boards"]
		self.assertEqual([b["name"] for b in shared], [self.extra[3]])
		self.assertIsNone(shared[0]["workspace_role"])
		self.assertTrue(shared[0]["capabilities"]["can_comment"])
		self.assertFalse(shared[0]["capabilities"]["can_edit"])
		share_board(self.extra[4], self.w.member2, "edit")  # a Member of that workspace
		self.assertEqual(board_service.list_boards(self.w.member2, "shared")["boards"], [])

	def test_trash_list_is_for_members(self):
		"""Failure: Guests cannot open the Trash list; members see trashed boards."""
		board_service.trash_board(self.w.member, self.extra[4])
		self.assertIn(self.extra[4], self.names(self.w.member2, "trash"))
		with self.assertRaises(frappe.PermissionError):
			board_service.list_boards(self.w.guest, "trash", self.w.workspace)
		self.assertNotIn(self.extra[4], self.names(self.w.member, "all"))

	def test_bad_scope_and_missing_workspace(self):
		"""Failure: unknown lists and a missing workspace are rejected."""
		with self.assertRaises(OqivaError):
			board_service.list_boards(self.w.member, "everything", self.w.workspace)
		with self.assertRaises(OqivaError):
			board_service.list_boards(self.w.member, "all")
