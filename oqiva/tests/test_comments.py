"""Comments, mentions and who may do what with them (T3.7, T5.5, T7.1, T2.3)."""

import json
import uuid
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from oqiva.constants import BOARD_DOCTYPE, COMMENT_DOCTYPE
from oqiva.exceptions import OqivaError, OqivaForbidden, OqivaLimitExceeded, OqivaNotFound
from oqiva.services import board_service, comment_service, document_service, link_service, share_service
from oqiva.tests.test_document import doc, shape
from oqiva.tests.utils import make_user, make_world, share_board


class CommentCase(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.w = make_world("cmt")

	def pin(self, actor=None, text="Looks good", shape_id="s1"):
		return comment_service.add_comment(
			actor or self.w.member, self.w.board, text, "shape", shape_id=shape_id
		)["name"]

	def notified(self, user, kind_subject=None):
		rows = frappe.get_all(
			"Notification Log",
			filters={"for_user": user, "document_name": self.w.board},
			fields=["subject", "type", "from_user"],
		)
		return [r for r in rows if not kind_subject or kind_subject in r.subject]


class TestAdding(CommentCase):
	def test_a_comment_pins_to_a_shape_or_a_point_and_is_stored_as_text(self):
		first = self.pin()
		second = comment_service.add_comment(self.w.member, self.w.board, "Here", "point", x=10.5, y=-20)[
			"name"
		]
		rows = {
			r.name: r for r in frappe.get_all(COMMENT_DOCTYPE, fields=["*"], filters={"board": self.w.board})
		}
		self.assertEqual((rows[first].anchor_type, rows[first].shape_id), ("shape", "s1"))
		self.assertEqual(
			(rows[second].anchor_type, rows[second].board_x, rows[second].board_y), ("point", 10.5, -20)
		)
		self.assertEqual(rows[first].author, self.w.member)

	def test_only_people_who_may_comment_can(self):
		share_board(self.w.board, self.w.sharee, "view")
		with self.assertRaises(OqivaForbidden):
			self.pin(self.w.sharee)
		share_board(self.w.board, self.w.outsider, "comment")
		self.assertTrue(self.pin(self.w.outsider))
		with self.assertRaises(OqivaNotFound):
			self.pin(self.w.guest)  # a guest with no share cannot tell the board exists

	def test_markup_is_taken_out_of_what_is_stored(self):
		name = self.pin(
			text="<script>alert(1)</script><img src=x onerror=alert(2)>Hello <b>there</b> javascript:alert(3)"
		)
		stored = frappe.db.get_value(COMMENT_DOCTYPE, name, "content")
		for bad in ("<script", "<img", "<b>", "</b>"):
			self.assertNotIn(bad, stored)
		self.assertIn("Hello", stored)

	def test_control_and_direction_characters_are_dropped_and_text_is_trimmed(self):
		name = self.pin(text="  \x00hi‮ there\x07  ")
		self.assertEqual(frappe.db.get_value(COMMENT_DOCTYPE, name, "content"), "hi there")

	def test_empty_wrong_type_and_too_long_are_refused(self):
		for bad in ("", "   ", None, 5, "<b></b>"):
			with self.assertRaises(OqivaError):
				self.pin(text=bad)
		with self.assertRaises(OqivaLimitExceeded):
			self.pin(text="x" * 5001)
		self.pin(text="x" * 5000)

	def test_a_bad_anchor_is_refused(self):
		for kwargs in (
			{"anchor_type": "shape", "shape_id": "bad id!"},
			{"anchor_type": "shape", "shape_id": None},
			{"anchor_type": "point", "x": "a", "y": 1},
			{"anchor_type": "point", "x": 1e9, "y": 1},
			{"anchor_type": "point", "x": float("nan"), "y": 1},
			{"anchor_type": "point", "x": True, "y": 1},
			{"anchor_type": "wall"},
		):
			with self.assertRaises(OqivaError):
				comment_service.add_comment(self.w.member, self.w.board, "hi", **kwargs)

	def test_a_board_holds_a_limited_number_of_comments(self):
		with patch.object(comment_service, "MAX_COMMENTS_PER_BOARD", 2):
			self.pin()
			self.pin()
			with self.assertRaises(OqivaLimitExceeded):
				self.pin()

	def test_everyone_with_the_board_open_is_told(self):
		with patch("oqiva.utils.realtime.frappe.publish_realtime") as publish:
			name = self.pin()
		call = next(c for c in publish.call_args_list if c.args[0] == "oqiva:comment")
		self.assertEqual(call.args[1], {"board": self.w.board, "op": "add", "comment": name, "parent": None})
		self.assertEqual(call.kwargs["room"], f"oqiva:board:{self.w.board}")
		self.assertTrue(call.kwargs["after_commit"])


class TestMentions(CommentCase):
	def test_people_in_the_audience_are_notified_and_others_are_ignored(self):
		share_board(self.w.board, self.w.sharee, "comment")
		text = f"@{self.w.sharee} and @{self.w.member2} please look; not @{self.w.outsider}; @nobody@example.com; me @{self.w.member}"
		self.pin(text=text)
		self.assertEqual(len(self.notified(self.w.sharee, "mentioned")), 1)
		self.assertEqual(len(self.notified(self.w.member2, "mentioned")), 1)
		self.assertEqual(self.notified(self.w.outsider), [])
		self.assertEqual(self.notified(self.w.member), [])  # never told about yourself
		stored = frappe.get_all(COMMENT_DOCTYPE, fields=["mentions"], filters={"board": self.w.board})[
			0
		].mentions
		self.assertEqual(sorted(json.loads(stored)), sorted([self.w.sharee, self.w.member2]))

	def test_a_guest_in_the_workspace_with_no_share_is_not_in_the_audience(self):
		self.pin(text=f"@{self.w.guest}")
		self.assertEqual(self.notified(self.w.guest), [])

	def test_the_people_who_can_be_mentioned_are_listed_for_the_composer(self):
		share_board(self.w.board, self.w.sharee, "view")
		listed = {p["user"] for p in comment_service.audience_people(self.w.member, self.w.board)}
		self.assertTrue({self.w.owner, self.w.member2, self.w.sharee} <= listed)
		self.assertNotIn(self.w.outsider, listed)
		self.assertNotIn(self.w.guest, listed)
		with self.assertRaises(OqivaNotFound):
			comment_service.audience_people(self.w.outsider, self.w.board)


class TestReplies(CommentCase):
	def test_a_reply_goes_into_the_thread_and_tells_its_author(self):
		first = self.pin()
		reply = comment_service.reply(self.w.member2, first, "Agreed")["name"]
		thread = comment_service.list_comments(self.w.member, self.w.board)[0]
		self.assertEqual([r["name"] for r in thread["replies"]], [reply])
		self.assertEqual(len(self.notified(self.w.member, "replied")), 1)

	def test_a_reply_to_a_reply_is_refused_and_the_thread_has_one_level(self):
		first = self.pin()
		reply = comment_service.reply(self.w.member2, first, "Agreed")["name"]
		with self.assertRaises(OqivaError):
			comment_service.reply(self.w.member, reply, "No")

	def test_someone_mentioned_in_a_reply_is_told_once(self):
		first = self.pin()
		comment_service.reply(self.w.member2, first, f"@{self.w.member} thanks")
		self.assertEqual(len(self.notified(self.w.member)), 1)

	def test_only_commenters_reply_and_a_deleted_thread_cannot_be_replied_to(self):
		first = self.pin()
		share_board(self.w.board, self.w.sharee, "view")
		with self.assertRaises(OqivaForbidden):
			comment_service.reply(self.w.sharee, first, "hi")
		comment_service.delete_comment(self.w.member, first)
		with self.assertRaises(OqivaNotFound):
			comment_service.reply(self.w.member2, first, "late")

	def test_a_thread_holds_a_limited_number_of_replies(self):
		first = self.pin()
		with patch.object(comment_service, "MAX_REPLIES_PER_THREAD", 1):
			comment_service.reply(self.w.member2, first, "one")
			with self.assertRaises(OqivaLimitExceeded):
				comment_service.reply(self.w.member2, first, "two")


class TestEditingAndDeleting(CommentCase):
	def test_only_the_author_edits_and_even_an_admin_cannot(self):
		name = self.pin()
		comment_service.edit_comment(self.w.member, name, "Better")
		self.assertEqual(frappe.db.get_value(COMMENT_DOCTYPE, name, "content"), "Better")
		for other in (self.w.admin, self.w.owner, self.w.member2):
			with self.assertRaises(OqivaForbidden):
				comment_service.edit_comment(other, name, "Hacked")

	def test_the_author_or_an_admin_deletes_but_another_member_cannot(self):
		name = self.pin()
		with self.assertRaises(OqivaForbidden):
			comment_service.delete_comment(self.w.member2, name)
		comment_service.delete_comment(self.w.admin, name)
		with self.assertRaises(OqivaNotFound):
			comment_service.delete_comment(self.w.member, name)
		mine = self.pin()
		comment_service.delete_comment(self.w.member, mine)

	def test_an_edit_tells_only_the_people_newly_mentioned(self):
		name = self.pin(text=f"@{self.w.member2} hi")
		self.assertEqual(len(self.notified(self.w.member2)), 1)
		comment_service.edit_comment(self.w.member, name, f"@{self.w.member2} and @{self.w.owner} hi")
		self.assertEqual(len(self.notified(self.w.member2)), 1)
		self.assertEqual(len(self.notified(self.w.owner)), 1)

	def test_deleting_a_thread_hides_it_and_its_replies_but_keeps_the_records(self):
		first = self.pin()
		reply = comment_service.reply(self.w.member2, first, "yes")["name"]
		comment_service.delete_comment(self.w.member, first)
		self.assertEqual(comment_service.list_comments(self.w.member, self.w.board), [])
		self.assertEqual(frappe.db.get_value(COMMENT_DOCTYPE, reply, "is_deleted"), 1)

	def test_deleting_one_reply_leaves_the_thread(self):
		first = self.pin()
		one = comment_service.reply(self.w.member2, first, "one")["name"]
		comment_service.reply(self.w.member2, first, "two")
		comment_service.delete_comment(self.w.member2, one)
		self.assertEqual(
			[r["content"] for r in comment_service.list_comments(self.w.member, self.w.board)[0]["replies"]],
			["two"],
		)

	def test_a_stranger_cannot_tell_a_comment_exists(self):
		name = self.pin()
		for action in (comment_service.delete_comment,):
			with self.assertRaises(OqivaNotFound):
				action(self.w.outsider, name)
		with self.assertRaises(OqivaNotFound):
			comment_service.edit_comment(self.w.outsider, name, "x")


class TestResolving(CommentCase):
	def test_a_commenter_resolves_and_reopens_a_thread(self):
		name = self.pin()
		share_board(self.w.board, self.w.sharee, "comment")
		self.assertTrue(comment_service.set_resolved(self.w.sharee, name, True)["resolved"])
		row = frappe.db.get_value(COMMENT_DOCTYPE, name, ["resolved", "resolved_by"], as_dict=True)
		self.assertEqual((row.resolved, row.resolved_by), (1, self.w.sharee))
		comment_service.set_resolved(self.w.member, name, False)
		row = frappe.db.get_value(
			COMMENT_DOCTYPE, name, ["resolved", "resolved_by", "resolved_on"], as_dict=True
		)
		self.assertEqual((row.resolved, row.resolved_by, row.resolved_on), (0, None, None))

	def test_someone_who_may_only_view_cannot_and_a_reply_cannot_be_resolved(self):
		name = self.pin()
		share_board(self.w.board, self.w.sharee, "view")
		with self.assertRaises(OqivaForbidden):
			comment_service.set_resolved(self.w.sharee, name, True)
		reply = comment_service.reply(self.w.member2, name, "yes")["name"]
		with self.assertRaises(OqivaError):
			comment_service.set_resolved(self.w.member, reply, True)


class TestListing(CommentCase):
	def test_threads_come_back_nested_oldest_first_with_what_the_caller_may_do(self):
		first = self.pin(text="first")
		second = self.pin(text="second", shape_id="s2")
		comment_service.reply(self.w.member2, first, "reply")
		threads = comment_service.list_comments(self.w.member2, self.w.board)
		self.assertEqual([t["name"] for t in threads], [first, second])
		self.assertEqual(threads[0]["replies"][0]["content"], "reply")
		self.assertEqual((threads[0]["can_edit"], threads[0]["can_delete"]), (False, False))
		self.assertEqual(
			(threads[0]["replies"][0]["can_edit"], threads[0]["replies"][0]["can_delete"]), (True, True)
		)
		admin = comment_service.list_comments(self.w.admin, self.w.board)
		self.assertEqual((admin[0]["can_edit"], admin[0]["can_delete"]), (False, True))
		self.assertEqual(threads[0]["author"]["user"], self.w.member)

	def test_someone_who_may_only_view_can_read_but_a_stranger_cannot(self):
		self.pin()
		share_board(self.w.board, self.w.sharee, "view")
		self.assertEqual(len(comment_service.list_comments(self.w.sharee, self.w.board)), 1)
		with self.assertRaises(OqivaNotFound):
			comment_service.list_comments(self.w.outsider, self.w.board)


class TestPinsFollowTheBoard(CommentCase):
	def save(self, *shapes):
		base = frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "revision")
		return document_service.save_document(
			self.w.member, self.w.board, doc(*shapes), base, uuid.uuid4().hex[:10]
		)

	def flag(self, name):
		return frappe.db.get_value(COMMENT_DOCTYPE, name, "object_missing")

	def test_t5_5_a_comment_is_flagged_when_its_shape_is_removed_and_cleared_when_it_returns(self):
		name = self.pin(shape_id="s1")
		on_point = comment_service.add_comment(self.w.member, self.w.board, "x", "point", x=1, y=1)["name"]
		self.save(shape("s1"))
		self.assertEqual(self.flag(name), 0)
		self.save(shape("other"))
		self.assertEqual(self.flag(name), 1)
		self.assertEqual(self.flag(on_point), 0)  # a point has no shape to lose
		self.save(shape("s1"), shape("other"))
		self.assertEqual(self.flag(name), 0)

	def test_a_change_to_the_flag_is_pushed_so_open_boards_refresh(self):
		self.pin(shape_id="s1")
		self.save(shape("s1"))
		with patch("oqiva.utils.realtime.frappe.publish_realtime") as publish:
			self.save(shape("other"))
		self.assertIn(
			"refresh", [c.args[1].get("op") for c in publish.call_args_list if c.args[0] == "oqiva:comment"]
		)
		with patch("oqiva.utils.realtime.frappe.publish_realtime") as publish:
			self.save(shape("other"), shape("more"))
		self.assertEqual([c for c in publish.call_args_list if c.args[0] == "oqiva:comment"], [])

	def test_a_deleted_thread_is_not_reflagged(self):
		name = self.pin(shape_id="s1")
		comment_service.delete_comment(self.w.member, name)
		self.save(shape("other"))
		self.assertEqual(self.flag(name), 0)


class TestWhoCanSeeCommentsThroughFrappe(CommentCase):
	"""The generic REST and list layer must not leak comments (T2.3)."""

	def test_a_permission_checked_list_shows_only_comments_on_boards_the_person_can_see(self):
		name = self.pin()

		def listed(user):
			return frappe.get_list(COMMENT_DOCTYPE, user=user, filters={"board": self.w.board}, pluck="name")

		self.assertEqual(listed(self.w.member2), [name])
		self.assertEqual(listed(self.w.outsider), [])
		self.assertEqual(listed(self.w.guest), [])
		share_board(self.w.board, self.w.sharee, "view")
		self.assertEqual(listed(self.w.sharee), [name])
		made = link_service.create_link(self.w.member, self.w.board, "Viewer")
		link_service.redeem(self.w.outsider, made["token"])
		self.assertEqual(listed(self.w.outsider), [name])
		link_service.revoke_link(self.w.member, made["name"])
		self.assertEqual(listed(self.w.outsider), [])

	def test_reading_one_is_checked_and_nothing_can_be_written_outside_the_services(self):
		name = self.pin()
		row = frappe.get_doc(COMMENT_DOCTYPE, name)
		self.assertTrue(frappe.has_permission(COMMENT_DOCTYPE, "read", doc=row, user=self.w.member2))
		self.assertFalse(frappe.has_permission(COMMENT_DOCTYPE, "read", doc=row, user=self.w.outsider))
		for ptype in ("write", "create", "delete"):
			self.assertFalse(
				frappe.has_permission(COMMENT_DOCTYPE, ptype, doc=row, user=self.w.member), ptype
			)
		fresh = frappe.get_doc(
			{"doctype": COMMENT_DOCTYPE, "board": self.w.board, "author": self.w.member, "content": "x"}
		)
		with self.assertRaises(OqivaForbidden):
			fresh.insert(ignore_permissions=True)

	def test_purging_a_board_removes_its_comments(self):
		name = self.pin()
		board_service.delete_board_records(self.w.board)
		self.assertFalse(frappe.db.exists(COMMENT_DOCTYPE, name))
