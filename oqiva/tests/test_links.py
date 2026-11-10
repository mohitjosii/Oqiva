"""Share links and what a redeemed link allows (T4.1 to T4.7)."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, now_datetime

from oqiva.access import resolve
from oqiva.access.rules import access_level, capabilities, may
from oqiva.constants import AUDIT_DOCTYPE, BOARD_DOCTYPE, GRANT_DOCTYPE, LINK_DOCTYPE
from oqiva.exceptions import OqivaError, OqivaForbidden, OqivaLimitExceeded, OqivaNotFound
from oqiva.services import document_service, file_service, link_service
from oqiva.tests.test_document import doc, shape
from oqiva.tests.test_files import PNG, image
from oqiva.tests.utils import make_world


def level_of(user, board):
	try:
		ctx, _row = resolve.board_context(user, board)
	except OqivaNotFound:
		return None
	return access_level(ctx)


class LinkCase(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.w = make_world("link")

	def make(self, access="Viewer", actor=None, **kwargs):
		return link_service.create_link(actor or self.w.member, self.w.board, access, **kwargs)

	def tearDown(self):
		for name in frappe.get_all("File", filters={"attached_to_name": self.w.board}, pluck="name"):
			frappe.delete_doc("File", name, ignore_permissions=True, force=True)
		super().tearDown()


class TestMakingLinks(LinkCase):
	def test_the_secret_is_shown_once_and_only_a_hash_is_kept(self):
		made = self.make("Commenter")
		self.assertTrue(made["url"].endswith(f"/oqiva/s/{made['token']}"))
		self.assertGreaterEqual(len(made["token"]), 40)
		row = frappe.db.get_value(LINK_DOCTYPE, made["name"], ["token_hash", "token_hint"], as_dict=True)
		self.assertNotEqual(row.token_hash, made["token"])
		self.assertEqual(len(row.token_hash), 64)
		self.assertEqual(row.token_hint, made["token"][:6])
		self.assertEqual(link_service.hash_token(made["token"]), row.token_hash)
		self.assertNotIn("token", link_service.list_links(self.w.member, self.w.board)[0])

	def test_two_links_never_share_a_secret(self):
		self.assertNotEqual(self.make()["token"], self.make()["token"])

	def test_the_hash_depends_on_the_sites_secret_key(self):
		first = link_service.hash_token("abcdefgh")
		with patch("frappe.utils.password.get_encryption_key", return_value="another-key"):
			self.assertNotEqual(link_service.hash_token("abcdefgh"), first)

	def test_only_people_who_may_share_can_make_one(self):
		with self.assertRaises(OqivaNotFound):
			self.make(actor=self.w.outsider)
		from oqiva.services import share_service

		share_service.add_person(self.w.member, self.w.board, self.w.sharee, "edit")
		with self.assertRaises(OqivaForbidden):
			self.make(actor=self.w.sharee)

	def test_refuses_a_bad_access_an_anonymous_editor_and_a_bad_expiry(self):
		with self.assertRaises(OqivaError):
			self.make("Owner")
		with self.assertRaises(OqivaError):
			self.make("Editor", allow_anonymous=True)
		with self.assertRaises(OqivaError):
			self.make("Commenter", allow_anonymous=True)
		for days in (-1, 366):
			with self.assertRaises(OqivaError):
				self.make(expires_in_days=days)
		self.assertTrue(self.make("Viewer", allow_anonymous=True)["allow_anonymous"])

	def test_a_board_has_a_limited_number_of_live_links(self):
		with patch.object(link_service, "MAX_LIVE_LINKS_PER_BOARD", 2):
			self.make()
			second = self.make()
			with self.assertRaises(OqivaLimitExceeded):
				self.make()
			link_service.revoke_link(self.w.member, second["name"])
			self.make()

	def test_the_list_shows_links_in_force_with_who_may_revoke_them(self):
		made = self.make(expires_in_days=7)
		shown = link_service.list_links(self.w.member, self.w.board)
		self.assertEqual(
			[(s["name"], s["access"], s["can_revoke"], s["expired"]) for s in shown],
			[(made["name"], "Viewer", True, False)],
		)
		self.assertFalse(link_service.list_links(self.w.member2, self.w.board)[0]["can_revoke"])


class TestRedeeming(LinkCase):
	def test_a_signed_in_person_gets_the_links_access(self):
		for access, level in (("Viewer", "view"), ("Commenter", "comment"), ("Editor", "edit")):
			made = self.make(access)
			who = (
				frappe.get_doc(
					{
						"doctype": "User",
						"email": f"redeem_{level}@oqiva.test",
						"first_name": level,
						"send_welcome_email": 0,
					}
				)
				.insert(ignore_permissions=True)
				.name
			)
			self.assertIsNone(level_of(who, self.w.board))
			result = link_service.redeem(who, made["token"])
			self.assertEqual(
				result, {"board": self.w.board, "title": "Roadmap", "access": level, "anonymous": False}
			)
			self.assertEqual(level_of(who, self.w.board), level)

	def test_redeeming_twice_makes_one_grant(self):
		made = self.make()
		link_service.redeem(self.w.sharee, made["token"])
		link_service.redeem(self.w.sharee, made["token"])
		self.assertEqual(frappe.db.count(GRANT_DOCTYPE, {"share_link": made["name"]}), 1)
		self.assertIsNotNone(frappe.db.get_value(LINK_DOCTYPE, made["name"], "last_used_on"))

	def test_a_link_does_not_take_anything_away_from_a_better_access(self):
		made = self.make("Viewer")
		link_service.redeem(self.w.member2, made["token"])
		self.assertEqual(level_of(self.w.member2, self.w.board), "edit")

	def test_the_best_of_several_links_wins_and_a_dead_one_counts_for_nothing(self):
		view, edit = self.make("Viewer"), self.make("Editor")
		link_service.redeem(self.w.sharee, view["token"])
		link_service.redeem(self.w.sharee, edit["token"])
		self.assertEqual(level_of(self.w.sharee, self.w.board), "edit")
		link_service.revoke_link(self.w.member, edit["name"])
		self.assertEqual(level_of(self.w.sharee, self.w.board), "view")

	def test_a_guest_in_the_workspace_may_comment_through_a_link_but_not_share(self):
		made = self.make("Commenter")
		link_service.redeem(self.w.guest, made["token"])
		ctx, _row = resolve.board_context(self.w.guest, self.w.board)
		self.assertTrue(may(ctx, "board:comment"))
		self.assertFalse(capabilities(ctx)["can_share"])
		self.assertFalse(capabilities(ctx)["can_edit"])

	def test_unknown_revoked_expired_and_trashed_all_look_the_same(self):
		live = self.make()
		revoked = self.make()
		link_service.revoke_link(self.w.member, revoked["name"])
		expired = self.make()
		frappe.db.set_value(LINK_DOCTYPE, expired["name"], "expires_on", add_days(now_datetime(), -1))
		trashed = self.make()
		cases = {"unknown": "x" * 43, "revoked": revoked["token"], "expired": expired["token"]}
		messages = set()
		for token in cases.values():
			with self.assertRaises(OqivaNotFound) as caught:
				link_service.redeem(self.w.sharee, token)
			messages.add(str(caught.exception))
		frappe.db.set_value(BOARD_DOCTYPE, self.w.board, "is_trashed", 1)
		with self.assertRaises(OqivaNotFound) as caught:
			link_service.redeem(self.w.sharee, trashed["token"])
		messages.add(str(caught.exception))
		self.assertEqual(len(messages), 1)
		frappe.db.set_value(BOARD_DOCTYPE, self.w.board, "is_trashed", 0)
		self.assertEqual(link_service.redeem(self.w.sharee, live["token"])["board"], self.w.board)

	def test_garbage_secrets_are_refused_without_a_lookup_error(self):
		for token in (None, "", "short", "x" * 500, 5, "../etc/passwd"):
			with self.assertRaises(OqivaNotFound):
				link_service.redeem(self.w.sharee, token)

	def test_a_rejected_attempt_and_a_good_one_are_both_recorded(self):
		made = self.make()
		before = frappe.db.count(AUDIT_DOCTYPE, {"action": "link.rejected"})
		with self.assertRaises(OqivaNotFound):
			link_service.redeem(self.w.sharee, "y" * 43)
		self.assertEqual(frappe.db.count(AUDIT_DOCTYPE, {"action": "link.rejected"}), before + 1)
		link_service.redeem(self.w.sharee, made["token"])
		self.assertTrue(frappe.db.exists(AUDIT_DOCTYPE, {"action": "link.redeemed", "user": self.w.sharee}))

	def test_a_link_stops_working_the_moment_it_expires(self):
		made = self.make(expires_in_days=1)
		link_service.redeem(self.w.sharee, made["token"])
		self.assertEqual(level_of(self.w.sharee, self.w.board), "view")
		frappe.db.set_value(LINK_DOCTYPE, made["name"], "expires_on", add_days(now_datetime(), -1))
		self.assertIsNone(level_of(self.w.sharee, self.w.board))
		with self.assertRaises(OqivaNotFound):
			link_service.redeem(self.w.owner, made["token"])


class TestRevoking(LinkCase):
	def test_revoking_ends_every_grant_and_clears_the_secret(self):
		made = self.make("Editor")
		link_service.redeem(self.w.sharee, made["token"])
		link_service.redeem(self.w.outsider, made["token"])
		with patch("oqiva.utils.realtime.frappe.publish_realtime") as publish:
			link_service.revoke_link(self.w.member, made["name"])
		self.assertIsNone(level_of(self.w.sharee, self.w.board))
		self.assertIsNone(level_of(self.w.outsider, self.w.board))
		self.assertEqual(frappe.db.count(GRANT_DOCTYPE, {"share_link": made["name"]}), 0)
		row = frappe.db.get_value(LINK_DOCTYPE, made["name"], ["token_hash", "revoked_on"], as_dict=True)
		self.assertIsNone(row.token_hash)
		self.assertIsNotNone(row.revoked_on)
		pushed = {
			c.kwargs["user"] for c in publish.call_args_list if c.args and c.args[0] == "oqiva:access_changed"
		}
		self.assertEqual(pushed, {self.w.sharee, self.w.outsider})
		self.assertEqual(link_service.list_links(self.w.member, self.w.board), [])
		with self.assertRaises(OqivaNotFound):
			link_service.revoke_link(self.w.member, made["name"])

	def test_an_admin_may_revoke_a_link_someone_else_made(self):
		made = self.make(actor=self.w.member2)
		link_service.revoke_link(self.w.admin, made["name"])
		self.assertEqual(link_service.list_links(self.w.member, self.w.board), [])

	def test_a_link_that_does_not_exist_is_not_found(self):
		with self.assertRaises(OqivaNotFound):
			link_service.revoke_link(self.w.member, "nonexistent")

	def test_a_member_who_did_not_make_it_and_is_not_the_creator_cannot(self):
		made = self.make(actor=self.w.member)
		with self.assertRaises(OqivaForbidden):
			link_service.revoke_link(self.w.member2, made["name"])
		link_service.revoke_link(self.w.member, made["name"])

	def test_a_stranger_cannot_tell_a_link_exists(self):
		made = self.make()
		with self.assertRaises(OqivaNotFound):
			link_service.revoke_link(self.w.outsider, made["name"])

	def test_purging_the_board_removes_its_links_and_grants(self):
		from oqiva.services import board_service

		made = self.make()
		link_service.redeem(self.w.sharee, made["token"])
		board_service.delete_board_records(self.w.board)
		self.assertFalse(frappe.db.exists(LINK_DOCTYPE, made["name"]))
		self.assertEqual(frappe.db.count(GRANT_DOCTYPE, {"board": self.w.board}), 0)


class TestVisitorsWhoAreNotSignedIn(LinkCase):
	def save_content(self, *objects):
		base = frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "revision")
		document_service.save_document(self.w.member, self.w.board, doc(*objects), base, "link-save")

	def test_an_anonymous_viewing_link_shows_the_board_read_only(self):
		self.save_content(shape("a"))
		made = self.make("Viewer", allow_anonymous=True)
		opened = link_service.redeem("Guest", made["token"])
		self.assertEqual(opened, {"board": self.w.board, "title": "Roadmap", "anonymous": True})
		shown = link_service.view_shared(made["token"])
		self.assertEqual(shown["board"], self.w.board)
		self.assertEqual(len(frappe.parse_json(shown["document"])["objects"]), 1)
		self.assertEqual(
			shown["capabilities"],
			{
				"can_view": True,
				"can_comment": False,
				"can_edit": False,
				"can_export": False,
				"can_share": False,
			},
		)
		self.assertIsNone(level_of("Guest", self.w.board))  # no standing access of any kind

	def test_a_link_that_needs_signing_in_says_so_and_shows_nothing(self):
		for access, anonymous in (("Viewer", False), ("Commenter", False), ("Editor", False)):
			made = self.make(access, allow_anonymous=anonymous)
			self.assertEqual(link_service.redeem("Guest", made["token"]), {"login_required": True})
			with self.assertRaises(OqivaNotFound):
				link_service.view_shared(made["token"])

	def test_an_anonymous_link_cannot_be_used_after_it_is_revoked_or_expires(self):
		made = self.make("Viewer", allow_anonymous=True)
		link_service.revoke_link(self.w.member, made["name"])
		with self.assertRaises(OqivaNotFound):
			link_service.view_shared(made["token"])
		with self.assertRaises(OqivaNotFound):
			link_service.redeem("Guest", made["token"])
		again = self.make("Viewer", allow_anonymous=True, expires_in_days=1)
		frappe.db.set_value(LINK_DOCTYPE, again["name"], "expires_on", add_days(now_datetime(), -1))
		with self.assertRaises(OqivaNotFound):
			link_service.view_shared(again["token"])

	def test_a_visitor_gets_the_boards_pictures_and_only_its_own(self):
		own = file_service.upload_image(self.w.member, self.w.board, PNG)
		from oqiva.services import board_service

		other = board_service.create_board(self.w.member, self.w.workspace, self.w.project, "Other")["name"]
		stranger = file_service.upload_image(self.w.member, other, PNG + b"\x00")
		made = self.make("Viewer", allow_anonymous=True)
		kind, content = link_service.link_file(made["token"], own["src"])
		self.assertEqual((kind, content), ("image/png", PNG))
		for src in (stranger["src"], "/private/files/" + "0" * 32 + ".png", "/files/x.png", "../x"):
			with self.assertRaises(OqivaNotFound):
				link_service.link_file(made["token"], src)

	def test_a_picture_is_refused_when_the_link_is_not_anonymous(self):
		own = file_service.upload_image(self.w.member, self.w.board, PNG)
		made = self.make("Viewer", allow_anonymous=False)
		with self.assertRaises(OqivaNotFound):
			link_service.link_file(made["token"], own["src"])
		self.assertTrue(image("i", own["src"]))


class TestWhereLinkAccessShowsUp(LinkCase):
	"""Access through a link must show everywhere access through a share does."""

	def test_the_board_details_carry_the_links_capabilities(self):
		from oqiva.services import board_service

		made = self.make("Editor")
		link_service.redeem(self.w.sharee, made["token"])
		caps = board_service.open_board(self.w.sharee, self.w.board)["capabilities"]
		self.assertTrue(caps["can_edit"] and caps["can_comment"] and caps["can_view"])
		self.assertFalse(caps["can_share"])

	def test_a_viewing_link_gives_a_viewing_capability_set(self):
		from oqiva.services import board_service

		made = self.make("Viewer")
		link_service.redeem(self.w.sharee, made["token"])
		caps = board_service.get_board(self.w.sharee, self.w.board)["capabilities"]
		self.assertTrue(caps["can_view"])
		self.assertFalse(caps["can_edit"] or caps["can_comment"])

	def test_the_board_appears_under_shared_with_me_until_the_link_ends(self):
		from oqiva.services import board_service

		made = self.make("Viewer")
		link_service.redeem(self.w.sharee, made["token"])
		# Other tests in this class leave grants for the same user on their own boards, so look for ours.
		names = lambda: [b["name"] for b in board_service.list_boards(self.w.sharee, "shared")["boards"]]  # noqa: E731
		self.assertIn(self.w.board, names())
		link_service.revoke_link(self.w.member, made["name"])
		self.assertNotIn(self.w.board, names())

	def test_a_permission_checked_list_includes_the_board_only_while_the_grant_lives(self):
		made = self.make("Viewer")
		link_service.redeem(self.w.sharee, made["token"])
		names = frappe.get_list(
			BOARD_DOCTYPE, user=self.w.sharee, filters={"name": self.w.board}, pluck="name"
		)
		self.assertEqual(names, [self.w.board])
		link_service.revoke_link(self.w.member, made["name"])
		names = frappe.get_list(
			BOARD_DOCTYPE, user=self.w.sharee, filters={"name": self.w.board}, pluck="name"
		)
		self.assertEqual(names, [])

	def test_a_linked_person_may_fetch_the_boards_pictures_through_the_file_check(self):
		picture = file_service.upload_image(self.w.member, self.w.board, PNG)
		file = frappe.get_doc("File", picture["file"])
		self.assertFalse(frappe.has_permission("File", "read", doc=file, user=self.w.sharee))
		made = self.make("Viewer")
		link_service.redeem(self.w.sharee, made["token"])
		self.assertTrue(frappe.has_permission("File", "read", doc=file, user=self.w.sharee))
		link_service.revoke_link(self.w.member, made["name"])
		self.assertFalse(frappe.has_permission("File", "read", doc=file, user=self.w.sharee))
