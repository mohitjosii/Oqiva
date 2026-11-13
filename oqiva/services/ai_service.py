"""AI diagram generation.

A person describes a diagram; a background job asks the configured provider for a small description
of it (title, nodes, edges); the description is checked; and the browser draws it with the editor's
own layout engines as one ordinary edit. The server never writes to a board here.

Off by default: with the provider set to ``none`` (or no key) every call says so. The prompt text is
sent to the provider and nowhere else, and it is never stored or logged: the audit log keeps only
its length. Board content is never sent.
"""

import re
import uuid

import frappe
import requests
from frappe import _

from oqiva.access import require, resolve
from oqiva.constants import (
	AI_KINDS,
	AI_LIMITS,
	AI_MAX_TOKENS,
	AI_RESULT_TTL_SECONDS,
	AI_SHAPES,
	AI_TIMEOUT_SECONDS,
)
from oqiva.exceptions import OqivaAiUnavailable, OqivaError, OqivaNotFound
from oqiva.services import audit_service
from oqiva.services.ai_schema import InvalidDiagram, parse_reply
from oqiva.utils import realtime
from oqiva.utils.settings import get_ai_settings

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MODEL_ID = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
EVENT = "oqiva:ai_result"
REJECTED_MESSAGE = "The generated diagram was not valid. Try describing it a little differently."

SYSTEM_PROMPT = f"""You turn a short description into a diagram specification.
Reply with JSON only, no other text, in exactly this shape:
{{"title": string, "nodes": [{{"id": string, "label": string, "shape": string, "lane": string?}}], "edges": [{{"from": string, "to": string, "label": string?, "style": "solid" | "dashed"}}]}}
Allowed shapes: {", ".join(AI_SHAPES)}.
Use "terminator" for a start or an end and "decision" for a branch. Every edge must name node ids that exist.
Use at most {AI_LIMITS["max_nodes"]} nodes and {AI_LIMITS["max_edges"]} edges. Labels are plain text of at most {AI_LIMITS["max_label"]} characters, no HTML or markdown. Prefer a few clear nodes over many."""

KIND_GUIDANCE = {
	"flowchart": "\nThis is a flowchart: begin with a start terminator and finish with an end terminator, and label every edge that leaves a decision (for example Yes and No).",
	"architecture": "\nThis is an architecture diagram: use the server, database, service, queue, storage, cloud and user shapes, and set lane to the tier a component belongs to (for example Clients, Services, Data).",
	"mindmap": "\nThis is a mind map: the first node is the central idea, edges run from a topic to its subtopics, shape is always process, and labels are short.",
}


class ProviderError(Exception):
	"""The provider could not give an answer. ``message`` is safe to show a person."""

	def __init__(self, code: str, message: str, issues: list[str] | None = None):
		super().__init__(message)
		self.code = code
		self.message = message
		self.issues = issues or []  # why an answer was unusable, for the audit log (never the prompt)


# ----- configuration -----


def is_configured() -> bool:
	settings = get_ai_settings()
	return settings["provider"] in ("anthropic", "gemini") and bool(settings["api_key"])


def status(user: str) -> dict:
	"""Whether this instance offers diagram generation. Never says why it does not: a person cannot fix
	that, and the key must not leak."""
	provider = get_ai_settings()["provider"]
	return {"available": is_configured(), "provider": provider if is_configured() else None}


# ----- the request -----


def _key(user: str, request_id: str) -> str:
	return f"oqiva:ai:{user}:{request_id}"


def _store(user: str, request_id: str, value: dict) -> None:
	frappe.cache.set_value(_key(user, request_id), value, expires_in_sec=AI_RESULT_TTL_SECONDS)


def request_diagram(user: str, prompt: str, kind: str = "flowchart", board: str | None = None) -> dict:
	"""Check the request, queue the job, and say which request to wait for."""
	text = (prompt or "").strip()
	if len(text) < AI_LIMITS["min_prompt"]:
		raise OqivaError(_("Describe what you would like to create."))
	if len(text) > AI_LIMITS["max_prompt"]:
		raise OqivaError(_("Keep the description shorter."))
	if kind not in AI_KINDS:
		raise OqivaError(_("That kind of diagram is not available."))
	if not is_configured():
		raise OqivaAiUnavailable()
	row_name = None
	if board:
		# The board is only an authorisation gate and the audit subject: the prompt never decides access.
		ctx, row = resolve.board_context(user, board)
		require(ctx, "board:edit")
		row_name = row.name
	request_id = uuid.uuid4().hex
	audit_service.record(
		"ai.requested",
		user,
		"Oqiva Board" if row_name else None,
		row_name,
		{"kind": kind, "promptLength": len(text)},
	)
	_store(user, request_id, {"state": "pending"})
	frappe.enqueue(
		"oqiva.services.ai_service.run_job",
		queue="default",
		timeout=AI_TIMEOUT_SECONDS * 2,
		request_id=request_id,
		user=user,
		prompt=text,
		kind=kind,
		board=row_name,
	)
	return {"request_id": request_id}


def result(user: str, request_id: str) -> dict:
	"""Where a request stands: ``pending``, ``done`` (with the diagram) or ``error``. Only the person who
	asked can read it."""
	found = frappe.cache.get_value(_key(user, str(request_id)[:64]))
	if not found:
		raise OqivaNotFound()
	return found


# ----- the job -----


def run_job(request_id: str, user: str, prompt: str, kind: str, board: str | None = None) -> None:
	"""Runs in a background worker: ask the provider, check the answer, store it and tell the browser."""
	outcome = _generate(user, prompt, kind, board)
	_store(user, request_id, outcome)
	realtime.push_to_user(user, EVENT, {"request_id": request_id, **outcome})


def _generate(user: str, prompt: str, kind: str, board: str | None) -> dict:
	try:
		reply = call_provider(prompt, kind)
	except ProviderError as error:
		if error.code == "AI_INVALID":
			# an answer that came back but cannot be used is recorded like one that failed validation
			audit_service.record(
				"ai.rejected",
				user,
				"Oqiva Board" if board else None,
				board,
				{"kind": kind, "issues": error.issues or ["the answer could not be read"]},
			)
		return {"state": "error", "code": error.code, "message": error.message}
	except Exception:
		frappe.log_error(title="Oqiva AI: unexpected failure")
		return {
			"state": "error",
			"code": "AI_UNAVAILABLE",
			"message": _("Diagram generation is temporarily unavailable."),
		}
	try:
		diagram = parse_reply(reply)
	except InvalidDiagram as invalid:
		audit_service.record(
			"ai.rejected",
			user,
			"Oqiva Board" if board else None,
			board,
			{"kind": kind, "issues": invalid.issues},
		)
		return {"state": "error", "code": "AI_INVALID", "message": _(REJECTED_MESSAGE)}
	return {"state": "done", "kind": kind, "diagram": diagram}


def _request_body(settings: dict, prompt: str, kind: str) -> dict:
	body = {
		"model": settings["model"],
		"max_tokens": AI_MAX_TOKENS,
		"system": SYSTEM_PROMPT + KIND_GUIDANCE[kind],
		"messages": [{"role": "user", "content": prompt}],
	}
	# The current model families think before answering. A diagram does not need much of that, and
	# the wait is capped, so ask for little. Older model ids do not take the field.
	if settings["model"].startswith("claude-") and any(
		f"-{family}-5" in settings["model"] for family in ("sonnet", "opus", "haiku", "fable", "mythos")
	):
		body["output_config"] = {"effort": "low"}
	return body


def call_provider(prompt: str, kind: str) -> str:
	"""One non-streaming request to the configured provider. Returns the reply text.

	``oqiva_ai_anthropic_url`` and ``oqiva_ai_gemini_url`` in the site config (never in Oqiva Settings, so
	only someone with server access can set them) replace the provider's address, for a company's AI gateway
	or a local stand-in used in testing; the Gemini one keeps its ``{model}`` placeholder.

	No retries and no caching: a failed request is the person's to retry. Only the status code of a
	failure is logged, never the prompt or the key."""
	settings = get_ai_settings()
	if settings["provider"] not in ("anthropic", "gemini") or not settings["api_key"]:
		raise ProviderError("AI_UNAVAILABLE", _("Diagram generation is not enabled on this Oqiva instance."))
	if settings["provider"] == "gemini":
		url = (frappe.conf.get("oqiva_ai_gemini_url") or GEMINI_URL).format(model=settings["model"])
		if not MODEL_ID.match(settings["model"]):
			raise ProviderError("AI_UNAVAILABLE", _("Diagram generation is temporarily unavailable."))
		headers = {"x-goog-api-key": settings["api_key"], "content-type": "application/json"}
		body = _gemini_body(prompt, kind)
		read = _read_gemini
	else:
		url = frappe.conf.get("oqiva_ai_anthropic_url") or API_URL
		headers = {
			"x-api-key": settings["api_key"],
			"anthropic-version": API_VERSION,
			"content-type": "application/json",
		}
		body = _request_body(settings, prompt, kind)
		read = _read_anthropic
	try:
		response = requests.post(url, headers=headers, json=body, timeout=AI_TIMEOUT_SECONDS)
	except requests.Timeout:
		raise ProviderError("AI_TIMEOUT", _("Diagram generation took too long. Please try again."))
	except requests.RequestException:
		raise ProviderError("AI_UNAVAILABLE", _("Diagram generation is temporarily unavailable."))
	if response.status_code != 200:
		frappe.logger("oqiva").warning(f"AI provider answered {response.status_code}")
		raise ProviderError("AI_UNAVAILABLE", _("Diagram generation is temporarily unavailable."))
	try:
		data = response.json()
	except ValueError:
		raise ProviderError("AI_INVALID", _(REJECTED_MESSAGE), ["the reply is not JSON"])
	text = read(data)
	if not text.strip():
		raise ProviderError("AI_INVALID", _(REJECTED_MESSAGE), ["the reply has no text"])
	return text


def _read_anthropic(data: dict) -> str:
	reason = data.get("stop_reason")
	if reason == "max_tokens":
		raise ProviderError("AI_INVALID", _(REJECTED_MESSAGE), ["the answer was cut off"])
	if reason == "refusal":
		raise ProviderError("AI_INVALID", _(REJECTED_MESSAGE), ["the provider declined to answer"])
	return "".join(
		block.get("text", "") for block in data.get("content") or [] if block.get("type") == "text"
	)


def _gemini_body(prompt: str, kind: str) -> dict:
	return {
		"systemInstruction": {"parts": [{"text": SYSTEM_PROMPT + KIND_GUIDANCE[kind]}]},
		"contents": [{"role": "user", "parts": [{"text": prompt}]}],
		"generationConfig": {"maxOutputTokens": AI_MAX_TOKENS, "responseMimeType": "application/json"},
	}


def _read_gemini(data: dict) -> str:
	"""The text of the first candidate, or nothing when the answer was blocked, cut off or empty."""
	if (data.get("promptFeedback") or {}).get("blockReason"):
		raise ProviderError("AI_INVALID", _(REJECTED_MESSAGE), ["the provider blocked the request"])
	candidates = data.get("candidates") or []
	if not candidates:
		return ""
	finish = candidates[0].get("finishReason")
	if finish == "MAX_TOKENS":
		raise ProviderError("AI_INVALID", _(REJECTED_MESSAGE), ["the answer was cut off"])
	if finish not in (None, "STOP"):
		raise ProviderError("AI_INVALID", _(REJECTED_MESSAGE), [f"the answer was stopped ({finish})"])
	parts = (candidates[0].get("content") or {}).get("parts") or []
	return "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
