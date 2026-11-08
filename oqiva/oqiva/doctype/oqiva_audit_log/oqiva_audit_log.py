from frappe.model.document import Document

from oqiva.access.guard import assert_service_write


class OqivaAuditLog(Document):
	"""Events that are not document changes: exports, rejected uploads. Written only by services."""

	def validate(self):
		assert_service_write(self)

	def on_trash(self):
		assert_service_write(self)
