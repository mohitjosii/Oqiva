from frappe import _
from frappe.model.document import Document

from oqiva.constants import AI_MODEL_PREFIX
from oqiva.exceptions import OqivaError

POSITIVE_FIELDS = (
	"max_objects_per_board",
	"max_document_bytes",
	"max_boards_per_workspace",
	"workspace_storage_bytes",
	"trash_retention_days",
	"auto_version_interval_min",
	"version_retention",
	"history_retention_days",
	"realtime_reauth_seconds",
)


class OqivaSettings(Document):
	"""Fair-use limits and access defaults. Every limit must stay positive."""

	def validate(self):
		for fieldname in POSITIVE_FIELDS:
			if int(self.get(fieldname) or 0) < 1:
				label = self.meta.get_label(fieldname)
				raise OqivaError(_("{0} must be at least 1.").format(_(label)))
		if self.ai_provider in AI_MODEL_PREFIX:
			model = (self.ai_model or "").strip()
			if model and not model.startswith(AI_MODEL_PREFIX[self.ai_provider]):
				raise OqivaError(
					_(
						"The model {0} does not belong to the provider {1}. Clear it to use the default."
					).format(model, self.ai_provider)
				)
			if not self.get_password("ai_api_key", raise_exception=False):
				raise OqivaError(_("Enter the AI API key, or set the AI provider to none."))
