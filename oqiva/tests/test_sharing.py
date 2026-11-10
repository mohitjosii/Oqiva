"""Sharing a board with people (T3.x, T4.x for the person-to-person part)."""

import uuid
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from oqiva.access import resolve
from oqiva.access.rules import access_level
from oqiva.constants import BOARD_DOCTYPE
from oqiva.exceptions import (
	OqivaConflict,
	OqivaError,
	OqivaForbidden,
	OqivaLimitExceeded,
	OqivaNotFound,
)
from oqiva.services import invite_service, share_service
from oqiva.tests.utils import make_user, make_world


def level_of(user, board):
	try:
		ctx, _row = resolve.board_context(user, board)
	except OqivaNotFound:
		return None
	return access_level(ctx)


class TestShareWithPeople(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.w = make_world("share")

	def share(self, target, level="view", actor=None):
		return share_service.add_person(actor or self.w.member, self.w.board, target, level)

	def test_a_member_shares_a_board_at_each_level(self):
		for level in ("view", "comment", "edit"):
			user = make_user(f"share_{level}@oqiva.test")
			result = self.share(user, level)
			self.assertEqual(result, {"status": "shared", "user": user, "level": level})
			self.assertEqual(level_of(user, self.w.board), level)

	def test_a_name_or_an_email_finds_the_person_whatever_its_case(self):
		self.share(self.w.sharee.upper(), "view")
		self.assertEqual(level_of(self.w.sharee, self.w.board), "view")

	def test_edit_never_lets_a_person_share_again(self):
		self.share(self.w.sharee, "edit")
		with self.assertRaises(OqivaForbidden):
			share_service.add_person(self.w.sharee, self.w.board, self.w.outsider, "view")
		with self.assertRaises(OqivaForbidden):
			share_service.list_shares(self.w.sharee, self.w.board)
		row = frappe.db.get_value(
			"DocShare",
			{"share_doctype": BOARD_DOCTYPE, "share_name": self.w.board, "user": self.w.sharee},
			["read", "write", "share"],
			as_dict=True,
		)
		self.assertEqual((row.read, row.write, row.share), (1, 1, 0))

	def test_people_without_a_right_to_the_board_cannot_share_it(self):
		with self.assertRaises(OqivaNotFound):
			self.share(self.w.sharee, actor=self.w.outsider)
		with self.assertRaises(OqivaNotFound):  # a guest without a share cannot tell it exists
			self.share(self.w.sharee, actor=self.w.guest)

	def test_a_guest_who_was_shared_the_board_cannot_share_it_on(self):
		self.share(self.w.guest, "comment")
		with self.assertRaises(OqivaForbidden):
			share_service.add_person(self.w.guest, self.w.board, self.w.sharee, "view")

	def test_refuses_a_bad_level_yourself_a_duplicate_and_unusable_accounts(self):
		with self.assertRaises(OqivaError):
			self.share(self.w.sharee, "owner")
		with self.assertRaises(OqivaError):
			self.share(self.w.member)  # yourself
		self.share(self.w.sharee)
		with self.assertRaises(OqivaConflict):
			self.share(self.w.sharee, "edit")
		for bad in ("Guest", "Administrator"):
			with self.assertRaises(OqivaError):
				self.share(bad)
		disabled = make_user("share_off@oqiva.test")
		frappe.db.set_value("User", disabled, "enabled", 0)
		with self.assertRaises(OqivaNotFound):
			self.share(disabled)
		with self.assertRaises(OqivaError):
			self.share("")

	def test_the_person_is_told_and_their_open_boards_are_nudged(self):
		with patch("oqiva.utils.realtime.frappe.publish_realtime") as publish:
			self.share(self.w.sharee, "comment")
		pushed = [c for c in publish.call_args_list if c.args and c.args[0] == "oqiva:access_changed"]
		self.assertEqual(len(pushed), 1)
		self.assertEqual(pushed[0].kwargs["user"], self.w.sharee)
		self.assertTrue(pushed[0].kwargs["after_commit"])
		log = frappe.get_all(
			"Notification Log",
			filters={"for_user": self.w.sharee, "document_name": self.w.board},
			fields=["type", "subject", "from_user"],
		)
		self.assertEqual(len(log), 1)
		self.assertEqual(log[0].type, "Share")
		self.assertEqual(log[0].from_user, self.w.member)

	def test_sharing_limit(self):
		with patch.object(share_service, "MAX_SHARES_PER_BOARD", 1):
			self.share(self.w.sharee)
			with self.assertRaises(OqivaLimitExceeded):
				self.share(self.w.member2)

	def test_the_list_shows_people_levels_and_who_may_change_them(self):
		self.share(self.w.sharee, "comment")
		shown = share_service.list_shares(self.w.member, self.w.board)
		self.assertEqual(
			[(p["user"], p["level"], p["can_change"]) for p in shown["people"]],
			[(self.w.sharee, "comment", True)],
		)
		self.assertEqual(shown["invites"], [])
		# A member who did not make the board or the share may look but not change.
		other = share_service.list_shares(self.w.member2, self.w.board)
		self.assertFalse(other["people"][0]["can_change"])


class TestChangingAndRevoking(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.w = make_world("rev")
		share_service.add_person(self.w.member, self.w.board, self.w.sharee, "view")

	def test_the_creator_an_admin_and_the_sharer_may_change_and_revoke(self):
		for actor in (self.w.member, self.w.admin, self.w.owner):
			share_service.change_level(actor, self.w.board, self.w.sharee, "edit")
			self.assertEqual(level_of(self.w.sharee, self.w.board), "edit")
			share_service.change_level(actor, self.w.board, self.w.sharee, "view")
			self.assertEqual(level_of(self.w.sharee, self.w.board), "view")

	def test_a_downgrade_really_removes_the_higher_rights(self):
		share_service.change_level(self.w.member, self.w.board, self.w.sharee, "edit")
		share_service.change_level(self.w.member, self.w.board, self.w.sharee, "view")
		row = frappe.db.get_value(
			"DocShare",
			{"share_doctype": BOARD_DOCTYPE, "share_name": self.w.board, "user": self.w.sharee},
			["read", "write", "comment"],
			as_dict=True,
		)
		self.assertEqual((row.read, row.write, row.comment), (1, 0, 0))

	def test_another_member_cannot(self):
		with self.assertRaises(OqivaForbidden):
			share_service.change_level(self.w.member2, self.w.board, self.w.sharee, "edit")
		with self.assertRaises(OqivaForbidden):
			share_service.revoke(self.w.member2, self.w.board, self.w.sharee)
		self.assertEqual(level_of(self.w.sharee, self.w.board), "view")

	def test_the_person_who_made_a_share_may_revoke_it_even_if_not_the_creator(self):
		share_service.add_person(self.w.member2, self.w.board, self.w.outsider, "view")
		share_service.revoke(self.w.member2, self.w.board, self.w.outsider)
		self.assertIsNone(level_of(self.w.outsider, self.w.board))

	def test_revoking_ends_the_access_and_nudges_their_browser(self):
		with patch("oqiva.utils.realtime.frappe.publish_realtime") as publish:
			share_service.revoke(self.w.member, self.w.board, self.w.sharee)
		self.assertIsNone(level_of(self.w.sharee, self.w.board))
		pushed = [c for c in publish.call_args_list if c.args and c.args[0] == "oqiva:access_changed"]
		self.assertEqual(pushed[-1].kwargs["user"], self.w.sharee)

	def test_revoking_keeps_access_that_comes_through_the_workspace(self):
		share_service.add_person(self.w.member, self.w.board, self.w.member2, "view")
		share_service.revoke(self.w.member, self.w.board, self.w.member2)
		self.assertEqual(
			level_of(self.w.member2, self.w.board), "edit"
		)  # a Member edits through the workspace

	def test_unknown_shares_and_levels_are_refused(self):
		with self.assertRaises(OqivaNotFound):
			share_service.revoke(self.w.member, self.w.board, self.w.outsider)
		with self.assertRaises(OqivaNotFound):
			share_service.change_level(self.w.member, self.w.board, self.w.outsider, "view")
		with self.assertRaises(OqivaError):
			share_service.change_level(self.w.member, self.w.board, self.w.sharee, "owner")

	def test_a_shared_person_can_leave(self):
		share_service.leave(self.w.sharee, self.w.board)
		self.assertIsNone(level_of(self.w.sharee, self.w.board))
		with self.assertRaises(OqivaNotFound):
			share_service.leave(self.w.sharee, self.w.board)

	def test_a_stranger_cannot_tell_whether_a_share_exists(self):
		with self.assertRaises(OqivaNotFound):
			share_service.change_level(self.w.outsider, self.w.board, self.w.sharee, "edit")


class TestInvitesForNewPeople(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.w = make_world("inv")
		# A fresh address for every test: users made in one test stay for the rest of the class.
		self.email = f"newcomer_{uuid.uuid4().hex[:8]}@oqiva.test"

	def test_an_email_with_no_account_becomes_a_waiting_invite_and_an_email(self):
		with patch("oqiva.services.share_service.frappe.sendmail") as send:
			result = share_service.add_person(self.w.member, self.w.board, self.email, "comment")
		self.assertEqual(result["status"], "invited")
		send.assert_called_once()
		self.assertEqual(send.call_args.kwargs["recipients"], [self.email])
		shown = share_service.list_shares(self.w.member, self.w.board)
		self.assertEqual([(i["email"], i["access"]) for i in shown["invites"]], [(self.email, "comment")])

	def test_inviting_again_changes_the_level_without_a_second_row(self):
		with patch("oqiva.services.share_service.frappe.sendmail"):
			share_service.add_person(self.w.member, self.w.board, self.email, "view")
			share_service.add_person(self.w.member, self.w.board, self.email, "edit")
		rows = frappe.get_all("Oqiva Pending Invite", filters={"board": self.w.board}, fields=["access"])
		self.assertEqual([r.access for r in rows], ["edit"])

	def test_a_waiting_invite_turns_into_a_share_when_the_person_arrives(self):
		with patch("oqiva.services.share_service.frappe.sendmail"):
			share_service.add_person(self.w.member, self.w.board, self.email, "comment")
		user = make_user(self.email)
		invite_service.convert_for_user(user)
		self.assertEqual(level_of(user, self.w.board), "comment")
		self.assertFalse(frappe.db.exists("Oqiva Pending Invite", {"board": self.w.board}))

	def test_an_invite_for_a_board_that_was_trashed_is_dropped_not_shared(self):
		with patch("oqiva.services.share_service.frappe.sendmail"):
			share_service.add_person(self.w.member, self.w.board, self.email, "view")
		frappe.db.set_value(BOARD_DOCTYPE, self.w.board, "is_trashed", 1)
		user = make_user(self.email)
		invite_service.convert_for_user(user)
		self.assertIsNone(frappe.db.get_value("DocShare", {"share_name": self.w.board, "user": user}))

	def test_workspace_invites_still_work_beside_board_invites(self):
		with (
			patch("oqiva.services.share_service.frappe.sendmail"),
			patch("oqiva.services.invite_service.frappe.sendmail"),
		):
			share_service.add_person(self.w.member, self.w.board, self.email, "view")
			invite_service.invite(self.w.owner, self.w.workspace, self.email, "Member")
		user = make_user(self.email)  # creating the account runs the conversion by itself
		self.assertEqual(resolve.workspace_role(user, self.w.workspace), "Member")
		self.assertEqual(level_of(user, self.w.board), "edit")

	def test_the_waiting_list_is_limited(self):
		with (
			patch.object(share_service, "MAX_PENDING_BOARD_INVITES", 1),
			patch("oqiva.services.share_service.frappe.sendmail"),
		):
			share_service.add_person(self.w.member, self.w.board, self.email, "view")
			with self.assertRaises(OqivaLimitExceeded):
				share_service.add_person(
					self.w.member, self.w.board, f"second_{uuid.uuid4().hex[:8]}@oqiva.test", "view"
				)

	def test_who_may_cancel_an_invite(self):
		with patch("oqiva.services.share_service.frappe.sendmail"):
			share_service.add_person(self.w.member2, self.w.board, self.email, "view")
		with self.assertRaises(OqivaNotFound):
			share_service.cancel_invite(self.w.member, self.w.board, "nobody@oqiva.test")
		share_service.cancel_invite(self.w.member2, self.w.board, self.email)  # the one who sent it
		self.assertFalse(frappe.db.exists("Oqiva Pending Invite", {"board": self.w.board}))
		with patch("oqiva.services.share_service.frappe.sendmail"):
			share_service.add_person(self.w.member2, self.w.board, self.email, "view")
		share_service.cancel_invite(self.w.member, self.w.board, self.email)  # the board's creator

	def test_a_bad_email_is_refused(self):
		with self.assertRaises(frappe.exceptions.ValidationError):
			share_service.add_person(self.w.member, self.w.board, "not an email", "view")


class TestAsTheRealPerson(IntegrationTestCase):
	"""The services run as the signed-in person, whose own Frappe permissions are far narrower than
	the Administrator's that most tests run as (a bug the browser run found)."""

	def setUp(self):
		super().setUp()
		self.w = make_world("real")

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def test_share_change_revoke_and_leave_work_for_a_normal_member(self):
		frappe.set_user(self.w.member)
		share_service.add_person(self.w.member, self.w.board, self.w.sharee, "view")
		share_service.change_level(self.w.member, self.w.board, self.w.sharee, "edit")
		self.assertEqual(level_of(self.w.sharee, self.w.board), "edit")
		share_service.revoke(self.w.member, self.w.board, self.w.sharee)
		self.assertIsNone(level_of(self.w.sharee, self.w.board))
		frappe.set_user("Administrator")
		share_service.add_person(self.w.member, self.w.board, self.w.sharee, "view")
		frappe.set_user(self.w.sharee)
		share_service.leave(self.w.sharee, self.w.board)
		self.assertIsNone(level_of(self.w.sharee, self.w.board))
