from frappe.model.document import Document

from oqiva.access.guard import assert_service_write


class OqivaShareLink(Document):
	"""Written only by Oqiva services."""

	def validate(self):
		assert_service_write(self)

	def on_trash(self):
		assert_service_write(self)
