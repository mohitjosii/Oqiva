from frappe.model.document import Document

from oqiva.services import template_service


class OqivaTemplate(Document):
	"""A published starting point for a board.

	Admins edit templates in Desk, and the seed writes them from ``oqiva/seed/templates``.
	Users never read this table: they go through ``template_service``.
	"""

	def validate(self):
		template_service.prepare_row(self)
