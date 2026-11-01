from frappe import _
from frappe.model.document import Document

from oqiva.exceptions import OqivaError

POSITIVE_FIELDS = (
	"max_objects_per_board",
	"max_document_bytes",
	"max_boards_per_workspace",
	"workspace_storage_bytes",
	"trash_retention_days",
	"auto_version_interval_min",
	"version_retention",
	"realtime_reauth_seconds",
)


class OqivaSettings(Document):
	"""Fair-use limits and access defaults. Every limit must stay positive."""

	def validate(self):
		for fieldname in POSITIVE_FIELDS:
			if int(self.get(fieldname) or 0) < 1:
				label = self.meta.get_label(fieldname)
				raise OqivaError(_("{0} must be at least 1.").format(_(label)))
