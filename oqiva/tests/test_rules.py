"""The permission rules table (SECURITY_TEST_PLAN T1.1 to T1.4).

The expected table below is written independently of access/rules.py, from
ARCHITECTURE section 6.2, so a change to either side alone fails the test.
"""

import itertools
import unittest

from oqiva.access.rules import ACTIONS, AccessContext, can_manage_member, capabilities, may

ROLES = (None, "Guest", "Member", "Admin", "Owner")
SHARES = (None, "view", "comment", "edit")
MEMBER_UP = {"Member", "Admin", "Owner"}
ADMIN_UP = {"Admin", "Owner"}
EVERYONE = {"Guest", "Member", "Admin", "Owner"}
ANY_SHARE = {"view", "comment", "edit"}

# action: (roles that allow it, shares that allow it)
EXPECTED = {
	"board:create": (MEMBER_UP, set()),
	"board:view": (MEMBER_UP, ANY_SHARE),
	"board:export": (MEMBER_UP, ANY_SHARE),
	"board:favourite": (MEMBER_UP, ANY_SHARE),
	"version:list": (MEMBER_UP, ANY_SHARE),
	"board:comment": (MEMBER_UP, {"comment", "edit"}),
	"comment:create": (MEMBER_UP, {"comment", "edit"}),
	"comment:resolve": (MEMBER_UP, {"comment", "edit"}),
	"board:edit": (MEMBER_UP, {"edit"}),
	"board:rename": (MEMBER_UP, {"edit"}),
	"version:restore": (MEMBER_UP, {"edit"}),
	"version:preview": (MEMBER_UP, {"edit"}),
	"board:move": (MEMBER_UP, set()),
	"board:duplicate": (MEMBER_UP, set()),
	"board:share": (MEMBER_UP, set()),
	"project:view": (EVERYONE, set()),
	"project:create": (MEMBER_UP, set()),
	"project:update": (MEMBER_UP, set()),
	"project:archive": (ADMIN_UP, set()),
	"project:trash": (ADMIN_UP, set()),
	"project:restore": (ADMIN_UP, set()),
	"workspace:view": (EVERYONE, set()),
	"workspace:update": (ADMIN_UP, set()),
	"workspace:invite": (ADMIN_UP, set()),
	"member:change_role": (ADMIN_UP, set()),
	"member:remove": (ADMIN_UP, set()),
}

# Actions whose answer also depends on a flag, tested one by one below.
FLAGGED = {
	"board:archive",
	"board:trash",
	"board:restore",
	"board:purge",
	"share:modify",
	"share:revoke",
	"comment:edit",
	"comment:delete",
	"workspace:leave",
	"workspace:delete",
}


class TestRulesTable(unittest.TestCase):
	def test_every_action_is_covered(self):
		"""Boundary: a new action must be added to the expected table or the flagged set."""
		self.assertEqual(set(ACTIONS), set(EXPECTED) | FLAGGED)

	def test_role_and_share_matrix(self):
		"""Success: every role and share level gets exactly the documented answer."""
		for action, (roles, shares) in EXPECTED.items():
			for role, share in itertools.product(ROLES, SHARES):
				ctx = AccessContext(user="u", role=role, share=share)
				expected = role in roles or share in shares
				self.assertEqual(may(ctx, action), expected, f"{action} role={role} share={share}")

	def test_best_of_role_and_share(self):
		"""Success: a Guest with an Editor share can edit, and still cannot create."""
		ctx = AccessContext(user="u", role="Guest", share="edit")
		self.assertTrue(may(ctx, "board:edit"))
		self.assertFalse(may(ctx, "board:create"))

	def test_guest_without_share_cannot_view(self):
		"""Boundary: workspace Guests see only what is shared with them (Oqiva gap 7)."""
		self.assertFalse(may(AccessContext(user="u", role="Guest"), "board:view"))
		self.assertTrue(may(AccessContext(user="u", role="Guest", share="view"), "board:view"))

	def test_unknown_action_is_denied(self):
		"""Failure: an action that is not in the table is never allowed."""
		self.assertFalse(may(AccessContext(user="u", role="Owner"), "board:teleport"))

	def test_trash_family(self):
		"""Success: Admins always, Members only for boards they created, nobody else."""
		for action in ("board:archive", "board:trash", "board:restore", "board:purge"):
			for role, creator, expected in (
				("Owner", False, True),
				("Admin", False, True),
				("Member", False, False),
				("Member", True, True),
				("Guest", True, False),
				(None, True, False),
			):
				ctx = AccessContext(user="u", role=role, is_creator=creator)
				self.assertEqual(may(ctx, action), expected, f"{action} {role} creator={creator}")
		editor = AccessContext(user="u", share="edit", is_creator=True)
		self.assertFalse(may(editor, "board:trash"))

	def test_share_changes(self):
		"""Success: Admins, the board creator and the share's creator may change a share."""
		for action in ("share:modify", "share:revoke"):
			self.assertTrue(may(AccessContext(user="u", role="Admin"), action))
			self.assertTrue(may(AccessContext(user="u", role="Member", is_creator=True), action))
			self.assertTrue(may(AccessContext(user="u", role="Member", created_share=True), action))
			self.assertFalse(may(AccessContext(user="u", role="Member"), action))
			self.assertFalse(may(AccessContext(user="u", share="edit"), action))

	def test_comment_edit_and_delete(self):
		"""Success: only the author edits; the author or an Admin deletes."""
		author = AccessContext(user="u", role="Member", is_author=True)
		admin = AccessContext(user="u", role="Admin")
		member = AccessContext(user="u", role="Member")
		self.assertTrue(may(author, "comment:edit"))
		self.assertFalse(may(admin, "comment:edit"))
		self.assertTrue(may(author, "comment:delete"))
		self.assertTrue(may(admin, "comment:delete"))
		self.assertFalse(may(member, "comment:delete"))

	def test_workspace_leave_and_delete(self):
		"""Success: the Owner cannot leave; only a non-personal workspace's Owner deletes it."""
		self.assertFalse(may(AccessContext(user="u", role="Owner", is_owner=True), "workspace:leave"))
		self.assertTrue(may(AccessContext(user="u", role="Member"), "workspace:leave"))
		self.assertTrue(may(AccessContext(user="u", role="Owner", is_owner=True), "workspace:delete"))
		self.assertFalse(
			may(AccessContext(user="u", role="Owner", is_owner=True, is_personal=True), "workspace:delete")
		)
		self.assertFalse(may(AccessContext(user="u", role="Admin"), "workspace:delete"))


class TestMemberManagement(unittest.TestCase):
	def actor(self, role):
		return AccessContext(user="u", role=role, is_owner=role == "Owner")

	def test_owner_manages_everyone_but_the_owner(self):
		"""Success: the Owner may change Admins, Members and Guests."""
		for target in ("Admin", "Member", "Guest"):
			self.assertTrue(can_manage_member(self.actor("Owner"), target))

	def test_admin_cannot_touch_peers_or_owner(self):
		"""Failure: an Admin cannot demote or remove another Admin or the Owner (T1.4)."""
		self.assertFalse(can_manage_member(self.actor("Admin"), "Admin"))
		self.assertFalse(can_manage_member(self.actor("Admin"), "Owner"))
		self.assertTrue(can_manage_member(self.actor("Admin"), "Member"))
		self.assertTrue(can_manage_member(self.actor("Admin"), "Guest", "Member"))

	def test_nobody_is_promoted_to_owner(self):
		"""Boundary: the Owner role is only ever changed by ownership transfer."""
		self.assertFalse(can_manage_member(self.actor("Owner"), "Member", "Owner"))
		self.assertFalse(can_manage_member(self.actor("Owner"), "Owner"))

	def test_members_and_guests_manage_nobody(self):
		"""Failure: only Admins and the Owner manage members."""
		for role in ("Member", "Guest", None):
			self.assertFalse(can_manage_member(self.actor(role), "Guest"))


class TestCapabilities(unittest.TestCase):
	def test_capabilities_follow_the_rules(self):
		"""Success: the flags sent to the SPA match may()."""
		viewer = capabilities(AccessContext(user="u", share="view"))
		self.assertTrue(viewer["can_view"] and viewer["can_export"])
		self.assertFalse(viewer["can_edit"] or viewer["can_comment"] or viewer["can_trash"])
		member = capabilities(AccessContext(user="u", role="Member"))
		self.assertTrue(member["can_edit"] and member["can_share"] and member["can_duplicate"])
		self.assertFalse(member["can_trash"])


class TestAccessLevel(unittest.TestCase):
	def test_highest_level_wins(self):
		"""Success: roles and shares map to edit, comment or view; nothing gives None."""
		from oqiva.access.rules import access_level

		cases = (
			(AccessContext(user="u", role="Member"), "edit"),
			(AccessContext(user="u", role="Guest", share="edit"), "edit"),
			(AccessContext(user="u", share="comment"), "comment"),
			(AccessContext(user="u", share="view"), "view"),
			(AccessContext(user="u", role="Guest"), None),
			(AccessContext(user="u"), None),
		)
		for ctx, expected in cases:
			self.assertEqual(access_level(ctx), expected, f"{ctx.role} {ctx.share}")
