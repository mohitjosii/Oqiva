import frappe
from frappe import _
from frappe.model.document import Document

from oqiva.access.guard import assert_service_write
from oqiva.exceptions import OqivaError
from oqiva.utils.text import clean_line, clean_text


class OqivaBoard(Document):
	"""A canvas document. Content changes are made by the save API, not here."""

	def validate(self):
		assert_service_write(self)
		self.title = clean_line(self.title, "Board name", 120)
		self.description = clean_text(self.description, "Description", 2000)
		self.validate_project()

	def validate_project(self):
		if not self.project:
			return
		project_workspace = frappe.db.get_value("Oqiva Project", self.project, "workspace")
		if project_workspace != self.workspace:
			raise OqivaError(_("The project belongs to a different workspace."))

	def on_trash(self):
		assert_service_write(self)
