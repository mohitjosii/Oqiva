from frappe.model.document import Document

from oqiva.access.guard import assert_service_write
from oqiva.utils.text import clean_line, clean_text


class OqivaProject(Document):
	"""A group of boards inside a workspace."""

	def validate(self):
		assert_service_write(self)
		self.project_name = clean_line(self.project_name, "Project name", 120)
		self.description = clean_text(self.description, "Description", 2000)
		self.icon = clean_line(self.icon, "Icon", 64, required=False)

	def on_trash(self):
		assert_service_write(self)
