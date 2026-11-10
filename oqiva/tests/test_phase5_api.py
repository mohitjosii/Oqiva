"""The Phase 5 endpoints as a browser would reach them: role boundaries for shared people (T3.2-T3.4),
the redeem rate limit (T4.4), guests (T4.6), and the IDOR sweep over the new surface (T2.x)."""

import uuid

import frappe
from frappe.tests import IntegrationTestCase

from oqiva.api import board as board_api
from oqiva.api import comment as comment_api
from oqiva.api import export as export_api
from oqiva.api import notification as notification_api
from oqiva.api import realtime as realtime_api
from oqiva.api import share as share_api
from oqiva.constants import BOARD_DOCTYPE
from oqiva.exceptions import OqivaForbidden, OqivaNotFound
from oqiva.services import link_service
from oqiva.tests.test_document import doc, shape
from oqiva.tests.utils import make_user, make_world, share_board


class AsUser(IntegrationTestCase):
	def as_user(self, user):
		frappe.set_user(user)

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.local.request = None
		super().tearDown()


class TestSharedPeopleBoundaries(AsUser):
	"""T3.2, T3.3 and T3.4: what each share level may and may not do through the endpoints."""

	def setUp(self):
		super().setUp()
		self.w = make_world("p5")
		self.people = {}
		for level in ("view", "comment", "edit"):
			user = make_user(f"p5_{level}@oqiva.test")
			share_board(self.w.board, user, level)
			self.people[level] = user

	def revision(self):
		return frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "revision")

	def save(self, user, name):
		self.as_user(user)
		return board_api.save_document(self.w.board, doc(shape("a")), self.revision(), name)

	def test_t3_2_a_viewer_may_look_and_export_but_not_save_rename_or_comment(self):
		viewer = self.people["view"]
		self.as_user(viewer)
		self.assertEqual(board_api.get_board(self.w.board)["name"], self.w.board)
		self.assertEqual(export_api.prepare(self.w.board, "png")["format"], "png")
		self.assertEqual(realtime_api.authorize(self.w.board), {"access": "view"})
		with self.assertRaises(OqivaForbidden):
			self.save(viewer, "v1")
		with self.assertRaises(OqivaForbidden):
			board_api.update_board(self.w.board, title="New")
		with self.assertRaises(OqivaForbidden):
			comment_api.add_comment(self.w.board, "hi", "point", x=1, y=1)
		self.assertEqual(comment_api.list_comments(self.w.board), [])  # reading is fine

	def test_t3_3_a_commenter_comments_and_resolves_but_cannot_save(self):
		commenter = self.people["comment"]
		self.as_user(commenter)
		self.assertEqual(realtime_api.authorize(self.w.board), {"access": "comment"})
		made = comment_api.add_comment(self.w.board, "Looks odd", "point", x=1, y=2)
		self.assertTrue(comment_api.set_resolved(made["name"], True)["resolved"])
		with self.assertRaises(OqivaForbidden):
			self.save(commenter, "c1")

	def test_t3_4_an_editor_saves_and_renames_but_cannot_move_trash_duplicate_or_share(self):
		editor = self.people["edit"]
		self.as_user(editor)
		self.assertEqual(realtime_api.authorize(self.w.board), {"access": "edit"})
		self.assertFalse(self.save(editor, "e1")["replayed"])
		self.as_user(editor)
		self.assertEqual(board_api.update_board(self.w.board, title="Renamed")["title"], "Renamed")
		for call in (
			lambda: board_api.move_board(self.w.board, None),
			lambda: board_api.trash_board(self.w.board),
			lambda: board_api.duplicate_board(self.w.board),
			lambda: share_api.add_person(self.w.board, self.w.outsider, "view"),
			lambda: share_api.create_link(self.w.board, "Viewer"),
			lambda: share_api.list_shares(self.w.board),
		):
			with self.assertRaises(OqivaForbidden):
				call()

	def test_a_comment_pushed_to_the_board_reaches_only_people_who_may_see_it(self):
		"""A person's notifications and comments never name a board they cannot open."""
		self.as_user(self.w.outsider)
		with self.assertRaises(OqivaNotFound):
			comment_api.list_comments(self.w.board)
		self.assertEqual(notification_api.list_notifications()["items"], [])


class TestRedeemRateLimit(AsUser):
	def test_t4_4_twenty_redemptions_a_minute_per_address_and_the_21st_is_refused(self):
		frappe.cache.delete_keys("rl:oqiva.api.share.redeem_link")
		frappe.local.request = frappe._dict(method="POST")
		frappe.local.request_ip = f"203.0.113.{uuid.uuid4().int % 250}"
		self.as_user("Guest")
		try:
			for _ in range(20):
				with self.assertRaises(OqivaNotFound):
					share_api.redeem_link("x" * 43)
			with self.assertRaises(frappe.RateLimitExceededError):
				share_api.redeem_link("x" * 43)
		finally:
			frappe.cache.delete_keys("rl:oqiva.api.share.redeem_link")


class TestGuests(AsUser):
	"""T4.6: someone who is not signed in can do nothing but open links."""

	def setUp(self):
		super().setUp()
		self.w = make_world("gst")

	def test_every_signed_in_endpoint_refuses_a_guest(self):
		self.as_user("Guest")
		calls = (
			lambda: board_api.save_document(self.w.board, doc(), 1, "s"),
			lambda: board_api.load_document(self.w.board),
			lambda: board_api.get_crdt_state(self.w.board),
			lambda: board_api.upload_image(self.w.board),
			lambda: comment_api.add_comment(self.w.board, "x", "point", x=1, y=1),
			lambda: comment_api.list_comments(self.w.board),
			lambda: comment_api.reply("x", "y"),
			lambda: share_api.list_shares(self.w.board),
			lambda: share_api.add_person(self.w.board, self.w.member, "view"),
			lambda: share_api.create_link(self.w.board, "Viewer"),
			lambda: share_api.revoke_link("x"),
			lambda: notification_api.list_notifications(),
			lambda: export_api.prepare(self.w.board, "png"),
			lambda: realtime_api.authorize(self.w.board),
		)
		for call in calls:
			with self.assertRaises(frappe.PermissionError):
				call()

	def test_the_endpoints_open_to_guests_are_exactly_the_link_ones(self):
		for fn in (share_api.redeem_link, share_api.view_shared, share_api.link_file):
			self.assertIn(fn, frappe.guest_methods)
		for fn in (
			share_api.list_shares,
			share_api.add_person,
			share_api.create_link,
			share_api.revoke_link,
			board_api.save_document,
			board_api.load_document,
			comment_api.add_comment,
			comment_api.list_comments,
			notification_api.list_notifications,
		):
			self.assertNotIn(fn, frappe.guest_methods)

	def test_the_anonymous_viewer_cannot_comment_or_save_even_with_a_valid_link(self):
		made = link_service.create_link(self.w.member, self.w.board, "Viewer", allow_anonymous=True)
		self.as_user("Guest")
		self.assertEqual(share_api.view_shared(made["token"])["capabilities"]["can_comment"], False)
		with self.assertRaises(frappe.PermissionError):
			comment_api.add_comment(self.w.board, "x", "point", x=1, y=1)
		with self.assertRaises(frappe.PermissionError):
			board_api.save_document(self.w.board, doc(), 1, "s")


class TestOutsiderCannotReachTheNewSurface(AsUser):
	"""T2.1 for the Phase 5 endpoints: a stranger gets the same not-found for everything on B1."""

	def test_every_board_endpoint_gives_a_stranger_not_found(self):
		w = make_world("idor5")
		made = link_service.create_link(w.member, w.board, "Viewer")
		self.as_user(w.outsider)
		calls = (
			lambda: share_api.list_shares(w.board),
			lambda: share_api.add_person(w.board, w.sharee, "view"),
			lambda: share_api.change_level(w.board, w.sharee, "edit"),
			lambda: share_api.remove_person(w.board, w.sharee),
			lambda: share_api.leave(w.board),
			lambda: share_api.cancel_invite(w.board, "x@y.com"),
			lambda: share_api.create_link(w.board, "Viewer"),
			lambda: share_api.list_links(w.board),
			lambda: share_api.revoke_link(made["name"]),
			lambda: comment_api.list_comments(w.board),
			lambda: comment_api.people(w.board),
			lambda: comment_api.add_comment(w.board, "x", "point", x=1, y=1),
			lambda: board_api.get_crdt_state(w.board),
			lambda: board_api.save_document(w.board, doc(), 1, "s", None),
			lambda: export_api.prepare(w.board, "png"),
		)
		for call in calls:
			with self.assertRaises((OqivaNotFound, OqivaForbidden)):
				call()
		self.assertEqual(realtime_api.authorize(w.board), {"access": None})
