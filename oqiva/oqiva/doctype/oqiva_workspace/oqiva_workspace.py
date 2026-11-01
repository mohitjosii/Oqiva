from frappe.model.document import Document

from oqiva.access.guard import assert_service_write
from oqiva.utils.text import clean_line


class OqivaWorkspace(Document):
	"""A team space holding projects and boards."""

	def validate(self):
		assert_service_write(self)
		self.workspace_name = clean_line(self.workspace_name, "Workspace name", 120)
		self.personal_of = self.personal_of or None

	def on_trash(self):
		assert_service_write(self)
