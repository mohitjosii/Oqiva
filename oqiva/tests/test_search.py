"""Search never leaks (T2.5, T7.3)."""

from frappe.tests import IntegrationTestCase

from oqiva.services import board_service, project_service, search_service
from oqiva.tests.utils import make_world, share_board


class TestSearch(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("se")
		cls.secret = board_service.create_board(cls.w.member, cls.w.workspace, None, "Zebra migration plan")[
			"name"
		]
		board_service.update_board(cls.w.member, cls.secret, description="mentions quokka budget")
		project_service.create_project(
			cls.w.member, cls.w.workspace, "Zebra programme", "quokka work", "blue", None
		)

	def found(self, user, text):
		result = search_service.query(user, text)
		return [b["name"] for b in result["boards"]], [p["name"] for p in result["projects"]]

	def test_members_find_titles_descriptions_and_projects(self):
		"""Success: boards match by title or description, projects by name."""
		boards, projects = self.found(self.w.member2, "zebra")
		self.assertIn(self.secret, boards)
		self.assertEqual(len(projects), 1)
		self.assertIn(self.secret, self.found(self.w.member2, "quokka")[0])

	def test_outsiders_find_nothing(self):
		"""Failure: search is scoped before matching, so an outsider sees no hit (T2.5)."""
		self.assertEqual(self.found(self.w.outsider, "zebra"), ([], []))
		self.assertEqual(self.found(self.w.outsider, "quokka"), ([], []))

	def test_guests_find_only_shared_boards(self):
		"""Failure: a Guest finds nothing until a board is shared with them."""
		self.assertEqual(self.found(self.w.guest, "zebra")[0], [])
		share_board(self.secret, self.w.guest, "view")
		self.assertEqual(self.found(self.w.guest, "zebra")[0], [self.secret])

	def test_trashed_boards_are_not_found(self):
		"""Boundary: boards in Trash drop out of search."""
		board = board_service.create_board(self.w.member, self.w.workspace, None, "Yak shaving")["name"]
		self.assertIn(board, self.found(self.w.member, "yak")[0])
		board_service.trash_board(self.w.member, board)
		self.assertNotIn(board, self.found(self.w.member, "yak")[0])

	def test_wildcards_match_literally(self):
		"""Boundary: % and _ in the query do not act as wildcards (T7.3)."""
		self.assertEqual(self.found(self.w.member, "%%"), ([], []))
		self.assertEqual(self.found(self.w.member, "z_bra"), ([], []))
		literal = board_service.create_board(self.w.member, self.w.workspace, None, "Growth 100% plan")[
			"name"
		]
		self.assertEqual(self.found(self.w.member, "100%"), ([literal], []))

	def test_short_or_blank_queries_return_nothing(self):
		"""Boundary: a query under two characters returns nothing and costs nothing."""
		self.assertEqual(self.found(self.w.member, "z"), ([], []))
		self.assertEqual(self.found(self.w.member, "   "), ([], []))
