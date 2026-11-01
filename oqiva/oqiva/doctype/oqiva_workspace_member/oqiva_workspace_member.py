import frappe
from frappe import _
from frappe.model.document import Document

from oqiva.access.guard import assert_service_write
from oqiva.exceptions import OqivaError


class OqivaWorkspaceMember(Document):
	"""A user's role in a workspace. The Owner row always matches the workspace owner."""

	def validate(self):
		assert_service_write(self)
		owner = frappe.db.get_value("Oqiva Workspace", self.workspace, "owner_user")
		if self.role == "Owner" and self.user != owner:
			raise OqivaError(_("Only the workspace owner can hold the Owner role."))
		if self.role != "Owner" and self.user == owner:
			raise OqivaError(_("The workspace owner must keep the Owner role."))

	def on_trash(self):
		assert_service_write(self)
