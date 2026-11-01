"""Workspaces, membership and invites (T2.4, T8.4 and the section 6.2 matrix)."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from oqiva.exceptions import OqivaConflict, OqivaError, OqivaForbidden, OqivaLimitExceeded, OqivaNotFound
from oqiva.services import invite_service, member_service, project_service, workspace_service
from oqiva.tests.utils import make_user, make_world


class TestPersonalWorkspace(IntegrationTestCase):
	def test_created_once_and_owned(self):
		"""Success: asking twice returns the same personal workspace, owned by the user."""
		user = make_user("pw_one@oqiva.test")
		first = workspace_service.ensure_personal_workspace(user)
		self.assertEqual(workspace_service.ensure_personal_workspace(user), first)
		row = frappe.db.get_value("Oqiva Workspace", first, ["owner_user", "personal_of"], as_dict=True)
		self.assertEqual((row.owner_user, row.personal_of), (user, user))
		self.assertEqual(frappe.db.count("Oqiva Workspace", {"personal_of": user}), 1)

	def test_second_personal_workspace_is_refused_by_the_database(self):
		"""Boundary: the unique personal_of column stops a race creating a second one (T8.4)."""
		user = make_user("pw_two@oqiva.test")
		workspace_service.ensure_personal_workspace(user)
		with self.assertRaises(frappe.UniqueValidationError):
			workspace_service.create_workspace(user, "Duplicate personal", personal=True)

	def test_personal_workspace_cannot_be_deleted(self):
		"""Failure: nobody can delete a personal workspace, not even its owner."""
		user = make_user("pw_three@oqiva.test")
		personal = workspace_service.ensure_personal_workspace(user)
		with self.assertRaises(OqivaForbidden):
			workspace_service.delete_workspace(user, personal)

	def test_listed_first(self):
		"""Success: the personal workspace is listed before the others."""
		user = make_user("pw_four@oqiva.test")
		workspace_service.create_workspace(user, "Aardvark team")
		personal = workspace_service.ensure_personal_workspace(user)
		self.assertEqual(workspace_service.list_for_user(user)[0]["name"], personal)


class TestWorkspaces(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("ws")

	def test_creator_is_owner(self):
		"""Success: the creator holds the Owner role and the slug is unique."""
		a = workspace_service.create_workspace(self.w.member, "Same Name")
		b = workspace_service.create_workspace(self.w.member, "Same Name")
		self.assertEqual(
			frappe.db.get_value("Oqiva Workspace Member", {"workspace": a, "user": self.w.member}, "role"),
			"Owner",
		)
		slugs = {frappe.db.get_value("Oqiva Workspace", n, "slug") for n in (a, b)}
		self.assertEqual(len(slugs), 2)

	def test_name_is_cleaned_and_required(self):
		"""Failure: blank names and over-long names are rejected."""
		with self.assertRaises(OqivaError):
			workspace_service.create_workspace(self.w.member, "   ")
		with self.assertRaises(OqivaError):
			workspace_service.create_workspace(self.w.member, "x" * 121)

	def test_rename_needs_admin(self):
		"""Failure: a Member cannot rename; an Admin can; an outsider gets not found."""
		with self.assertRaises(OqivaForbidden):
			workspace_service.rename_workspace(self.w.member, self.w.workspace, "Nope")
		workspace_service.rename_workspace(self.w.admin, self.w.workspace, "  Renamed   team ")
		self.assertEqual(
			frappe.db.get_value("Oqiva Workspace", self.w.workspace, "workspace_name"), "Renamed team"
		)
		with self.assertRaises(OqivaNotFound):
			workspace_service.rename_workspace(self.w.outsider, self.w.workspace, "Hijack")

	def test_only_owner_deletes(self):
		"""Failure: an Admin cannot delete; the Owner can, and it leaves the list."""
		target = workspace_service.create_workspace(self.w.owner, "Disposable")
		member_service.add_member_row(target, self.w.admin, "Admin")
		with self.assertRaises(OqivaForbidden):
			workspace_service.delete_workspace(self.w.admin, target)
		workspace_service.delete_workspace(self.w.owner, target)
		self.assertNotIn(target, [w["name"] for w in workspace_service.list_for_user(self.w.owner)])
		with self.assertRaises(OqivaNotFound):
			member_service.list_members(self.w.owner, target)

	def test_owner_cannot_leave_but_member_can(self):
		"""Failure: the Owner is stuck with the workspace; a Member may leave."""
		target = workspace_service.create_workspace(self.w.owner, "Leavable")
		member_service.add_member_row(target, self.w.member, "Member")
		with self.assertRaises(OqivaForbidden):
			member_service.leave_workspace(self.w.owner, target)
		member_service.leave_workspace(self.w.member, target)
		self.assertIsNone(
			frappe.db.get_value("Oqiva Workspace Member", {"workspace": target, "user": self.w.member})
		)

	def test_outsider_sees_nothing_of_the_workspace(self):
		"""Failure: every read by a non-member is not found, never forbidden (T2.4)."""
		for call in (
			lambda: member_service.list_members(self.w.outsider, self.w.workspace),
			lambda: project_service.list_projects(self.w.outsider, self.w.workspace),
			lambda: project_service.get_project(self.w.outsider, self.w.project),
			lambda: invite_service.invite(self.w.outsider, self.w.workspace, "x@oqiva.test", "Member"),
		):
			with self.assertRaises(OqivaNotFound):
				call()

	def test_outsider_cannot_list_through_frappe(self):
		"""Failure: the generic list and permission checks hide the workspace rows (T2.4)."""
		for doctype, filters in (
			("Oqiva Workspace", {"name": self.w.workspace}),
			("Oqiva Workspace Member", {"workspace": self.w.workspace}),
			("Oqiva Project", {"workspace": self.w.workspace}),
		):
			rows = frappe.get_list(doctype, user=self.w.outsider, filters=filters)
			self.assertEqual(rows, [], doctype)
			own = frappe.get_list(doctype, user=self.w.owner, filters=filters)
			self.assertTrue(own, doctype)
		doc = frappe.get_doc("Oqiva Workspace", self.w.workspace)
		self.assertFalse(frappe.has_permission("Oqiva Workspace", "read", doc=doc, user=self.w.outsider))
		self.assertTrue(frappe.has_permission("Oqiva Workspace", "read", doc=doc, user=self.w.guest))
		self.assertFalse(frappe.has_permission("Oqiva Workspace", "write", doc=doc, user=self.w.member))


class TestMembers(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("mem")

	def role_of(self, user):
		return frappe.db.get_value(
			"Oqiva Workspace Member", {"workspace": self.w.workspace, "user": user}, "role"
		)

	def test_list_members_owner_first(self):
		"""Success: members are listed from Owner down to Guest."""
		order = {"Owner": 3, "Admin": 2, "Member": 1, "Guest": 0}
		ranks = [order[m["role"]] for m in member_service.list_members(self.w.member, self.w.workspace)]
		self.assertEqual(ranks[0], 3)
		self.assertEqual(ranks, sorted(ranks, reverse=True))
		self.assertGreaterEqual(len(ranks), 5)

	def test_admin_changes_a_member_but_not_a_peer(self):
		"""Success and failure: an Admin promotes a Member, but cannot demote an Admin."""
		member_service.change_role(self.w.admin, self.w.workspace, self.w.member2, "Guest")
		self.assertEqual(self.role_of(self.w.member2), "Guest")
		member_service.change_role(self.w.admin, self.w.workspace, self.w.member2, "Member")
		other_admin = make_user("mem_admin2@oqiva.test")
		member_service.add_member_row(self.w.workspace, other_admin, "Admin")
		with self.assertRaises(OqivaForbidden):
			member_service.change_role(self.w.admin, self.w.workspace, other_admin, "Member")
		member_service.change_role(self.w.owner, self.w.workspace, other_admin, "Member")
		self.assertEqual(self.role_of(other_admin), "Member")

	def test_nobody_changes_the_owner(self):
		"""Failure: the Owner's role is fixed, even for the Owner."""
		with self.assertRaises(OqivaForbidden):
			member_service.change_role(self.w.admin, self.w.workspace, self.w.owner, "Member")
		with self.assertRaises(OqivaForbidden):
			member_service.remove_member(self.w.admin, self.w.workspace, self.w.owner)
		with self.assertRaises(OqivaError):
			member_service.change_role(self.w.owner, self.w.workspace, self.w.member, "Owner")

	def test_member_cannot_manage(self):
		"""Failure: Members and Guests have no member controls."""
		with self.assertRaises(OqivaForbidden):
			member_service.change_role(self.w.member, self.w.workspace, self.w.guest, "Member")
		with self.assertRaises(OqivaForbidden):
			member_service.remove_member(self.w.guest, self.w.workspace, self.w.member)

	def test_remove_member(self):
		"""Success: an Admin removes a Member; removing oneself is a conflict."""
		extra = make_user("mem_extra@oqiva.test")
		member_service.add_member_row(self.w.workspace, extra, "Member")
		member_service.remove_member(self.w.admin, self.w.workspace, extra)
		self.assertIsNone(self.role_of(extra))
		with self.assertRaises(OqivaConflict):
			member_service.remove_member(self.w.admin, self.w.workspace, self.w.admin)

	def test_database_refuses_a_second_membership_row(self):
		"""Boundary: one membership per user and workspace (unique constraint)."""
		with self.assertRaises(frappe.UniqueValidationError):
			member_service.add_member_row(self.w.workspace, self.w.member, "Guest")

	def test_owner_row_must_match_the_workspace_owner(self):
		"""Failure: only the owner can hold the Owner role, and keeps it."""
		stranger = make_user("mem_stranger@oqiva.test")
		with self.assertRaises(OqivaError):
			member_service.add_member_row(self.w.workspace, stranger, "Owner")


class TestInvites(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("inv")

	def test_registered_user_joins_at_once(self):
		"""Success: inviting a registered address adds the member immediately."""
		friend = make_user("inv_friend@oqiva.test")
		result = invite_service.invite(self.w.admin, self.w.workspace, "INV_Friend@oqiva.test", "Member")
		self.assertEqual(result, {"status": "added", "user": friend})
		with self.assertRaises(OqivaConflict):
			invite_service.invite(self.w.admin, self.w.workspace, friend, "Member")

	def test_unknown_address_becomes_a_pending_invite_then_a_member(self):
		"""Success: the invite is kept and applied when that email registers."""
		address = "inv_newcomer@oqiva.test"
		result = invite_service.invite(self.w.admin, self.w.workspace, address, "Guest")
		self.assertEqual(result["status"], "invited")
		self.assertIn("email_sent", result)  # False on a site with no outgoing email account
		self.assertTrue(frappe.db.exists("Oqiva Pending Invite", {"email": address}))
		newcomer = make_user(address)
		self.assertEqual(
			frappe.db.get_value(
				"Oqiva Workspace Member", {"workspace": self.w.workspace, "user": newcomer}, "role"
			),
			"Guest",
		)
		self.assertFalse(frappe.db.exists("Oqiva Pending Invite", {"email": address}))

	def test_inviting_twice_keeps_one_invite(self):
		"""Boundary: a repeat invite updates the role rather than adding a row."""
		address = "inv_twice@oqiva.test"
		invite_service.invite(self.w.admin, self.w.workspace, address, "Guest")
		invite_service.invite(self.w.admin, self.w.workspace, address, "Member")
		rows = frappe.get_all("Oqiva Pending Invite", filters={"email": address}, fields=["role"])
		self.assertEqual([r.role for r in rows], ["Member"])

	def test_rules(self):
		"""Failure: Members cannot invite, only the Owner invites Admins, bad input is rejected."""
		with self.assertRaises(OqivaForbidden):
			invite_service.invite(self.w.member, self.w.workspace, "inv_x@oqiva.test", "Member")
		with self.assertRaises(OqivaForbidden):
			invite_service.invite(self.w.admin, self.w.workspace, "inv_y@oqiva.test", "Admin")
		invite_service.invite(self.w.owner, self.w.workspace, "inv_y@oqiva.test", "Admin")
		with self.assertRaises(OqivaError):
			invite_service.invite(self.w.owner, self.w.workspace, "inv_z@oqiva.test", "Owner")
		with self.assertRaises(frappe.ValidationError):
			invite_service.invite(self.w.owner, self.w.workspace, "not-an-email", "Member")

	def test_invite_to_a_deleted_workspace_is_dropped(self):
		"""Boundary: an invite to a workspace deleted meanwhile adds nobody."""
		target = workspace_service.create_workspace(self.w.owner, "Gone soon")
		address = "inv_late@oqiva.test"
		invite_service.invite(self.w.owner, target, address, "Member")
		workspace_service.delete_workspace(self.w.owner, target)
		late = make_user(address)
		self.assertIsNone(frappe.db.get_value("Oqiva Workspace Member", {"workspace": target, "user": late}))
		self.assertFalse(frappe.db.exists("Oqiva Pending Invite", {"email": address}))

	def test_pending_invites_are_capped(self):
		"""Failure: a workspace cannot queue unlimited invites, which would be mass email."""
		fresh = workspace_service.create_workspace(self.w.owner, "Invite cap")
		with patch.object(invite_service, "MAX_PENDING_INVITES", 2):
			invite_service.invite(self.w.owner, fresh, "inv_cap1@oqiva.test", "Guest")
			invite_service.invite(self.w.owner, fresh, "inv_cap2@oqiva.test", "Guest")
			with self.assertRaises(OqivaLimitExceeded):
				invite_service.invite(self.w.owner, fresh, "inv_cap3@oqiva.test", "Guest")
			# Changing an existing invite is not a new one.
			invite_service.invite(self.w.owner, fresh, "inv_cap1@oqiva.test", "Member")
