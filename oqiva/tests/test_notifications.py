"""The notifications behind the bell (T11-style checks for the person-to-person part)."""

import uuid

import frappe
from frappe.tests import IntegrationTestCase

from oqiva.constants import BOARD_DOCTYPE
from oqiva.services import notification_service as notes
from oqiva.services import share_service
from oqiva.tests.utils import make_user, make_world, share_board


class TestNotifications(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.w = make_world("note")

	def person(self):
		"""A user made for this test alone (users made in one test stay for the rest of the class)."""
		user = make_user(f"note_{uuid.uuid4().hex[:8]}@oqiva.test")
		share_board(self.w.board, user, "view")
		return user

	def tell(self, to, subject="Hello", board=None, by=None, kind="share"):
		notes.notify(
			to,
			kind,
			subject,
			board=board or self.w.board,
			from_user=by or self.w.member,
			detail="Some detail",
		)

	def test_a_notification_is_listed_for_its_person_only_and_counted(self):
		me, other = self.person(), self.person()
		self.tell(me)
		self.assertEqual(notes.unread_count(me), 1)
		self.assertEqual(notes.unread_count(other), 0)
		listed = notes.list_for(me)
		self.assertEqual(listed["unread"], 1)
		item = listed["items"][0]
		self.assertEqual(
			(item["subject"], item["read"], item["board"], item["board_title"]),
			("Hello", False, self.w.board, "Roadmap"),
		)
		self.assertEqual(item["from_name"], frappe.db.get_value("User", self.w.member, "full_name"))
		self.assertEqual(notes.list_for(other)["items"], [])

	def test_never_tells_a_person_about_their_own_action_or_a_disabled_account(self):
		self.tell(self.w.member, by=self.w.member)
		self.assertEqual(notes.unread_count(self.w.member), 0)
		off = make_user("note_off@oqiva.test")
		frappe.db.set_value("User", off, "enabled", 0)
		self.tell(off)
		self.assertEqual(notes.unread_count(off), 0)

	def test_marking_read_changes_only_your_own_and_updates_the_count(self):
		me, other = self.person(), self.person()
		self.tell(me, "one")
		self.tell(me, "two")
		self.tell(other, "theirs")
		first = notes.list_for(me)["items"][0]["name"]
		self.assertEqual(notes.mark_read(me, first)["unread"], 1)
		notes.mark_read(me, notes.list_for(other)["items"][0]["name"])  # someone else's: nothing happens
		self.assertEqual(notes.unread_count(other), 1)
		self.assertEqual(notes.mark_all_read(me)["unread"], 0)
		self.assertEqual(notes.unread_count(other), 1)

	def test_the_list_can_show_only_unread_and_pages(self):
		me = self.person()
		for i in range(5):
			self.tell(me, f"n{i}")
		notes.mark_read(me, notes.list_for(me)["items"][0]["name"])
		self.assertEqual(len(notes.list_for(me, unread_only=True)["items"]), 4)
		page = notes.list_for(me, limit=2)
		self.assertEqual((len(page["items"]), page["has_more"]), (2, True))
		rest = notes.list_for(me, limit=2, start=4)
		self.assertEqual((len(rest["items"]), rest["has_more"]), (1, False))
		self.assertEqual(
			len(notes.list_for(me, limit=9999)["items"]), 5
		)  # the page size is capped, not trusted

	def test_a_board_the_person_can_no_longer_open_loses_its_name_and_link(self):
		me = make_user(f"note_{uuid.uuid4().hex[:8]}@oqiva.test")
		share_service.add_person(self.w.member, self.w.board, me, "view")
		self.assertEqual(notes.list_for(me)["items"][0]["board_title"], "Roadmap")
		share_service.revoke(self.w.member, self.w.board, me)
		item = notes.list_for(me)["items"][0]
		self.assertEqual((item["board"], item["board_title"]), (None, None))
		self.assertTrue(item["subject"])

	def test_only_oqiva_notifications_are_listed(self):
		me = self.person()
		frappe.get_doc(
			{
				"doctype": "Notification Log",
				"subject": "Elsewhere",
				"for_user": me,
				"type": "Alert",
				"document_type": "User",
				"document_name": me,
			}
		).insert(ignore_permissions=True)
		self.assertEqual(notes.list_for(me)["items"], [])
		self.assertEqual(notes.unread_count(me), 0)

	def test_sharing_creates_one_that_reads_well(self):
		me = make_user(f"note_{uuid.uuid4().hex[:8]}@oqiva.test")
		share_service.add_person(self.w.member, self.w.board, me, "comment")
		item = notes.list_for(me)["items"][0]
		self.assertIn("shared the board", item["subject"])
		self.assertIn("comment on", item["detail"])
		self.assertEqual(frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "title"), item["board_title"])
