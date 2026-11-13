"""AI diagram generation (Phase 12): the output contract, the request checks, the audit record and the
failure paths, all against a mocked provider. No test here reaches the network."""

import json
from unittest.mock import MagicMock, patch

import frappe
import requests
from frappe.tests import IntegrationTestCase

from oqiva.api import ai as ai_api
from oqiva.constants import AUDIT_DOCTYPE
from oqiva.exceptions import OqivaAiUnavailable, OqivaError, OqivaForbidden, OqivaNotFound
from oqiva.services import ai_service
from oqiva.services.ai_schema import InvalidDiagram, extract_json, parse_reply, validate_diagram
from oqiva.tests.utils import make_user, make_world, share_board
from oqiva.utils.settings import get_ai_settings

KEY = "sk-ant-test-0000000000000000"
ON = {"provider": "anthropic", "model": "claude-sonnet-5-5", "api_key": KEY}
OFF = {"provider": "none", "model": "claude-sonnet-5-5", "api_key": ""}
GEMINI = {"provider": "gemini", "model": "gemini-2.5-flash", "api_key": KEY}

GOOD = {
	"title": "Sign in",
	"nodes": [
		{"id": "a", "label": "Start", "shape": "terminator"},
		{"id": "b", "label": "Valid?", "shape": "decision"},
		{"id": "c", "label": "Done", "shape": "terminator"},
	],
	"edges": [
		{"from": "a", "to": "b"},
		{"from": "b", "to": "c", "label": "Yes", "style": "dashed"},
	],
}


REAL_ENQUEUE = frappe.enqueue


def run_inline(method, **kwargs):
	"""Stands in for ``frappe.enqueue``: our job runs at once, as a worker would; anything else
	Frappe queues (for example a new user's contact) goes the normal way."""
	if method != "oqiva.services.ai_service.run_job":
		return REAL_ENQUEUE(method, **kwargs)
	kwargs.pop("queue", None)
	kwargs.pop("timeout", None)
	return ai_service.run_job(**kwargs)


def reply(body, status=200, stop="end_turn"):
	response = MagicMock()
	response.status_code = status
	response.json.return_value = {
		"stop_reason": stop,
		"content": [{"type": "text", "text": body if isinstance(body, str) else json.dumps(body)}],
	}
	return response


class TestOutputContract(IntegrationTestCase):
	"""P12.01: what a provider may send back, and what is rejected."""

	def nodes(self, n):
		return [{"id": f"n{i}", "label": f"Step {i}"} for i in range(n)]

	def test_a_good_description_comes_back_clean(self):
		clean = validate_diagram(GOOD)
		self.assertEqual(clean["title"], "Sign in")
		self.assertEqual([n["id"] for n in clean["nodes"]], ["a", "b", "c"])
		self.assertEqual(clean["edges"][0]["style"], "solid")
		self.assertEqual(clean["edges"][1]["label"], "Yes")

	def test_a_code_fence_and_chatter_around_the_json_are_dropped(self):
		text = "Here you go:\n```json\n" + json.dumps(GOOD) + "\n```\nHope that helps"
		self.assertEqual(parse_reply(text)["nodes"][0]["id"], "a")
		self.assertEqual(extract_json('```\n{"nodes": []}\n```'), {"nodes": []})

	def test_text_that_is_not_json_is_refused(self):
		for text in ("", "no braces here", "{not json}", '{ "a": 1 '):
			with self.assertRaises(InvalidDiagram):
				parse_reply(text)

	def test_sixty_nodes_pass_and_sixty_one_are_refused(self):
		self.assertEqual(len(validate_diagram({"nodes": self.nodes(60)})["nodes"]), 60)
		with self.assertRaises(InvalidDiagram):
			validate_diagram({"nodes": self.nodes(61)})

	def test_one_hundred_twenty_edges_pass_and_one_more_is_refused(self):
		nodes = self.nodes(4)
		edge = {"from": "n0", "to": "n1"}
		self.assertEqual(len(validate_diagram({"nodes": nodes, "edges": [edge] * 120})["edges"]), 120)
		with self.assertRaises(InvalidDiagram):
			validate_diagram({"nodes": nodes, "edges": [edge] * 121})

	def test_structural_faults_are_refused_as_a_whole(self):
		bad = [
			{"nodes": []},
			{"nodes": "x"},
			{"nodes": [{"id": "a", "label": "A"}, {"id": "a", "label": "B"}]},
			{"nodes": [{"id": "has space", "label": "A"}]},
			{"nodes": [{"id": "a", "label": ""}]},
			{"nodes": [{"id": "a", "label": "x" * 121}]},
			{"nodes": [{"id": "a", "label": "A"}], "edges": [{"from": "a", "to": "ghost"}]},
			{"nodes": [{"id": "a", "label": "A"}], "edges": "nope"},
			{"nodes": ["a"]},
		]
		for raw in bad:
			with self.assertRaises(InvalidDiagram, msg=str(raw)):
				validate_diagram(raw)
		with self.assertRaises(InvalidDiagram):
			validate_diagram([])

	def test_markup_in_a_label_is_taken_out(self):
		clean = validate_diagram({"nodes": [{"id": "a", "label": "<b>Pay</b>  <script>x()</script>now"}]})
		self.assertNotIn("<", clean["nodes"][0]["label"])
		self.assertEqual(clean["nodes"][0]["label"], "Pay now")

	def test_script_and_style_blocks_go_with_their_contents(self):
		clean = validate_diagram(
			{"nodes": [{"id": "a", "label": "Go<script>window.x=1</script> now<style>a{}</style>"}]}
		)
		self.assertEqual(clean["nodes"][0]["label"], "Go now")

	def test_an_unknown_shape_or_style_is_made_ordinary_rather_than_refused(self):
		clean = validate_diagram(
			{
				"nodes": [{"id": "a", "label": "A", "shape": "dragon"}, {"id": "b", "label": "B"}],
				"edges": [{"from": "a", "to": "b", "style": "wavy"}],
			}
		)
		self.assertEqual(clean["nodes"][0]["shape"], "process")
		self.assertEqual(clean["edges"][0]["style"], "solid")


class AiCase(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.w = make_world("ai")
		frappe.set_user(self.w.member)
		self.config = patch("oqiva.services.ai_service.get_ai_settings", return_value=dict(ON))
		self.config.start()
		self.queue = patch("oqiva.services.ai_service.frappe.enqueue", side_effect=run_inline)
		self.queue.start()
		self.pushed = patch("oqiva.services.ai_service.realtime.push_to_user")
		self.push = self.pushed.start()

	def tearDown(self):
		self.pushed.stop()
		self.queue.stop()
		self.config.stop()
		frappe.set_user("Administrator")
		super().tearDown()

	def ask(self, prompt="A sign in flow", kind="flowchart", board=None, user=None):
		user = user or self.w.member
		frappe.set_user(user)
		return ai_service.request_diagram(user, prompt, kind, board)

	def outcome(self, request, user=None):
		return ai_service.result(user or self.w.member, request["request_id"])


class TestRequestChecks(AiCase):
	def test_when_off_the_status_says_so_and_a_request_fails_honestly(self):
		with patch("oqiva.services.ai_service.get_ai_settings", return_value=dict(OFF)):
			self.assertEqual(ai_service.status(self.w.member), {"available": False, "provider": None})
			with self.assertRaises(OqivaAiUnavailable):
				self.ask()

	def test_a_provider_without_a_key_is_off(self):
		half = {**ON, "api_key": ""}
		with patch("oqiva.services.ai_service.get_ai_settings", return_value=half):
			self.assertFalse(ai_service.is_configured())
			with self.assertRaises(OqivaAiUnavailable):
				self.ask()

	def test_when_on_the_status_names_the_provider_and_never_the_key(self):
		status = ai_api.status()
		self.assertEqual(status, {"available": True, "provider": "anthropic"})
		self.assertNotIn(KEY, json.dumps(status))

	def test_the_description_must_be_three_to_two_thousand_characters(self):
		for prompt in ("", "  ab  ", "x" * 2001):
			with self.assertRaises(OqivaError):
				self.ask(prompt)
		with patch("oqiva.services.ai_service.call_provider", return_value=json.dumps(GOOD)):
			self.ask("abc")
			self.ask("x" * 2000)

	def test_an_unknown_kind_is_refused(self):
		with self.assertRaises(OqivaError):
			self.ask(kind="pie chart")

	def test_a_signed_out_caller_is_refused(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			ai_api.status()
		with self.assertRaises(frappe.PermissionError):
			ai_api.generate_diagram("A sign in flow")

	def test_a_board_must_be_editable_by_the_caller(self):
		viewer = make_user("ai_viewer@oqiva.test")
		share_board(self.w.board, viewer, "view")
		with patch("oqiva.services.ai_service.call_provider", return_value=json.dumps(GOOD)):
			with self.assertRaises(OqivaForbidden):
				self.ask(board=self.w.board, user=viewer)
			with self.assertRaises(OqivaNotFound):
				self.ask(board=self.w.board, user=self.w.outsider)
			self.assertTrue(self.ask(board=self.w.board)["request_id"])


class TestGeneration(AiCase):
	def test_a_good_answer_is_stored_and_pushed_to_the_asker(self):
		with patch("oqiva.services.ai_service.call_provider", return_value=json.dumps(GOOD)) as call:
			request = self.ask("Draw a sign in flow", "flowchart")
		call.assert_called_once_with("Draw a sign in flow", "flowchart")
		done = self.outcome(request)
		self.assertEqual(done["state"], "done")
		self.assertEqual(done["kind"], "flowchart")
		self.assertEqual(len(done["diagram"]["nodes"]), 3)
		user, event, message = self.push.call_args.args
		self.assertEqual((user, event), (self.w.member, "oqiva:ai_result"))
		self.assertEqual(message["request_id"], request["request_id"])

	def test_another_person_cannot_read_the_result(self):
		with patch("oqiva.services.ai_service.call_provider", return_value=json.dumps(GOOD)):
			request = self.ask()
		with self.assertRaises(OqivaNotFound):
			self.outcome(request, user=self.w.member2)
		with self.assertRaises(OqivaNotFound):
			ai_service.result(self.w.member, "0" * 32)

	def test_the_audit_keeps_the_length_of_the_prompt_and_never_its_words(self):
		secret = "my secret launch plan for project Nightjar"
		with patch("oqiva.services.ai_service.call_provider", return_value=json.dumps(GOOD)):
			self.ask(secret, "mindmap", board=self.w.board)
		rows = frappe.get_all(
			AUDIT_DOCTYPE,
			filters={"action": "ai.requested", "user": self.w.member},
			fields=["metadata", "resource_name"],
			order_by="creation desc",
			limit=1,
		)
		meta = json.loads(rows[0].metadata)
		self.assertEqual(meta, {"kind": "mindmap", "promptLength": len(secret)})
		self.assertEqual(rows[0].resource_name, self.w.board)
		everything = json.dumps(frappe.get_all(AUDIT_DOCTYPE, fields=["metadata", "resource_name"]))
		self.assertNotIn("Nightjar", everything)

	def test_invalid_json_is_rejected_audited_and_nothing_is_applied(self):
		before = frappe.db.count(AUDIT_DOCTYPE, {"action": "ai.rejected"})
		with patch("oqiva.services.ai_service.call_provider", return_value="Sorry, I cannot."):
			request = self.ask(board=self.w.board)
		failed = self.outcome(request)
		self.assertEqual(failed["state"], "error")
		self.assertEqual(failed["code"], "AI_INVALID")
		self.assertIn("not valid", failed["message"])
		self.assertNotIn("diagram", failed)
		self.assertEqual(frappe.db.count(AUDIT_DOCTYPE, {"action": "ai.rejected"}), before + 1)

	def test_an_oversized_answer_is_rejected_with_the_reason_in_the_audit(self):
		big = {"nodes": [{"id": f"n{i}", "label": "x"} for i in range(61)]}
		with patch("oqiva.services.ai_service.call_provider", return_value=json.dumps(big)):
			request = self.ask()
		self.assertEqual(self.outcome(request)["code"], "AI_INVALID")
		row = frappe.get_all(
			AUDIT_DOCTYPE,
			filters={"action": "ai.rejected"},
			fields=["metadata"],
			order_by="creation desc",
			limit=1,
		)[0]
		meta = json.loads(row.metadata)
		self.assertEqual(meta["kind"], "flowchart")
		self.assertTrue(any("60" in issue for issue in meta["issues"]))

	def test_a_timeout_is_reported_as_taking_too_long(self):
		with patch("oqiva.services.ai_service.requests.post", side_effect=requests.Timeout()):
			request = self.ask()
		failed = self.outcome(request)
		self.assertEqual((failed["state"], failed["code"]), ("error", "AI_TIMEOUT"))
		self.assertIn("too long", failed["message"])

	def test_a_provider_failure_is_reported_without_leaking_the_key_or_the_prompt(self):
		for failure in (
			{"return_value": reply("x", status=500)},
			{"return_value": reply("x", status=401)},
			{"side_effect": requests.ConnectionError(f"boom {KEY}")},
		):
			with patch("oqiva.services.ai_service.requests.post", **failure):
				request = self.ask("my secret launch plan")
			failed = self.outcome(request)
			self.assertEqual(failed["code"], "AI_UNAVAILABLE")
			text = json.dumps(failed)
			self.assertNotIn(KEY, text)
			self.assertNotIn("secret launch", text)

	def test_an_unexpected_error_in_the_job_still_ends_in_an_honest_error(self):
		with patch("oqiva.services.ai_service.call_provider", side_effect=RuntimeError("bug")):
			request = self.ask()
		self.assertEqual(self.outcome(request)["code"], "AI_UNAVAILABLE")

	def test_a_truncated_or_refused_answer_is_rejected_and_audited(self):
		for stop, why in (("max_tokens", "cut off"), ("refusal", "declined")):
			before = frappe.db.count(AUDIT_DOCTYPE, {"action": "ai.rejected"})
			with patch(
				"oqiva.services.ai_service.requests.post", return_value=reply(json.dumps(GOOD), stop=stop)
			):
				request = self.ask(board=self.w.board)
			self.assertEqual(self.outcome(request)["code"], "AI_INVALID")
			self.assertEqual(frappe.db.count(AUDIT_DOCTYPE, {"action": "ai.rejected"}), before + 1)
			row = frappe.get_all(
				AUDIT_DOCTYPE,
				filters={"action": "ai.rejected"},
				fields=["metadata"],
				order_by="creation desc",
				limit=1,
			)[0]
			self.assertIn(why, json.loads(row.metadata)["issues"][0])


class TestProviderCall(AiCase):
	def test_the_request_follows_the_messages_api_contract(self):
		with patch("oqiva.services.ai_service.requests.post", return_value=reply(json.dumps(GOOD))) as post:
			text = ai_service.call_provider("A sign in flow", "architecture")
		self.assertEqual(json.loads(text)["title"], "Sign in")
		args, kwargs = post.call_args
		self.assertEqual(args[0], "https://api.anthropic.com/v1/messages")
		self.assertEqual(kwargs["headers"]["x-api-key"], KEY)
		self.assertEqual(kwargs["headers"]["anthropic-version"], "2023-06-01")
		self.assertEqual(kwargs["timeout"], 45)
		body = kwargs["json"]
		self.assertEqual(body["model"], "claude-sonnet-5-5")
		self.assertEqual(body["messages"], [{"role": "user", "content": "A sign in flow"}])
		self.assertIn("architecture diagram", body["system"])
		self.assertNotIn("stream", body)
		self.assertNotIn("temperature", body)

	def test_an_older_model_id_gets_no_effort_field(self):
		old = {**ON, "model": "claude-3-haiku"}
		self.assertNotIn("output_config", ai_service._request_body(old, "x", "flowchart"))
		self.assertEqual(ai_service._request_body(ON, "x", "flowchart")["output_config"], {"effort": "low"})

	def test_an_empty_reply_is_invalid(self):
		with patch("oqiva.services.ai_service.requests.post", return_value=reply("   ")):
			with self.assertRaises(ai_service.ProviderError):
				ai_service.call_provider("abc", "flowchart")


def gemini_reply(body, finish="STOP", extra=None):
	response = MagicMock()
	response.status_code = 200
	text = body if isinstance(body, str) else json.dumps(body)
	data = {"candidates": [{"finishReason": finish, "content": {"parts": [{"text": text}]}}]}
	data.update(extra or {})
	response.json.return_value = data
	return response


class TestGemini(AiCase):
	def setUp(self):
		super().setUp()
		self.config.stop()
		self.config = patch("oqiva.services.ai_service.get_ai_settings", return_value=dict(GEMINI))
		self.config.start()

	def test_it_is_on_with_a_gemini_key_and_says_so(self):
		self.assertEqual(ai_service.status(self.w.member), {"available": True, "provider": "gemini"})

	def test_the_request_follows_the_generate_content_contract(self):
		with patch("oqiva.services.ai_service.requests.post", return_value=gemini_reply(GOOD)) as post:
			text = ai_service.call_provider("A sign in flow", "mindmap")
		self.assertEqual(json.loads(text)["title"], "Sign in")
		args, kwargs = post.call_args
		self.assertEqual(
			args[0],
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
		)
		self.assertEqual(kwargs["headers"]["x-goog-api-key"], KEY)
		self.assertNotIn(KEY, args[0])  # the key travels in a header, never in the address
		self.assertEqual(kwargs["timeout"], 45)
		body = kwargs["json"]
		self.assertEqual(body["contents"], [{"role": "user", "parts": [{"text": "A sign in flow"}]}])
		self.assertIn("mind map", body["systemInstruction"]["parts"][0]["text"])
		self.assertEqual(body["generationConfig"]["responseMimeType"], "application/json")

	def test_a_good_answer_is_drawn_like_any_other(self):
		with patch("oqiva.services.ai_service.requests.post", return_value=gemini_reply(GOOD)):
			request = self.ask()
		done = self.outcome(request)
		self.assertEqual(done["state"], "done")
		self.assertEqual(len(done["diagram"]["nodes"]), 3)

	def test_a_blocked_cut_off_or_empty_answer_is_rejected(self):
		cases = (
			gemini_reply(GOOD, finish="MAX_TOKENS"),
			gemini_reply(GOOD, finish="SAFETY"),
			gemini_reply("   "),
			gemini_reply(GOOD, extra={"promptFeedback": {"blockReason": "SAFETY"}}),
		)
		for case in cases:
			before = frappe.db.count(AUDIT_DOCTYPE, {"action": "ai.rejected"})
			with patch("oqiva.services.ai_service.requests.post", return_value=case):
				request = self.ask()
			self.assertEqual(self.outcome(request)["code"], "AI_INVALID")
			self.assertEqual(frappe.db.count(AUDIT_DOCTYPE, {"action": "ai.rejected"}), before + 1)
		empty = MagicMock(status_code=200)
		empty.json.return_value = {}
		with patch("oqiva.services.ai_service.requests.post", return_value=empty):
			self.assertEqual(self.outcome(self.ask())["code"], "AI_INVALID")

	def test_thinking_parts_are_not_taken_for_the_answer(self):
		response = gemini_reply(GOOD)
		response.json.return_value["candidates"][0]["content"]["parts"].insert(
			0, {"text": "Let me think about this.", "thought": True}
		)
		with patch("oqiva.services.ai_service.requests.post", return_value=response):
			self.assertEqual(self.outcome(self.ask())["state"], "done")

	def test_failures_are_reported_without_the_key(self):
		for failure in (
			{"return_value": MagicMock(status_code=403)},
			{"return_value": MagicMock(status_code=429)},
			{"side_effect": requests.ConnectionError(f"boom {KEY}")},
		):
			with patch("oqiva.services.ai_service.requests.post", **failure):
				failed = self.outcome(self.ask())
			self.assertEqual(failed["code"], "AI_UNAVAILABLE")
			self.assertNotIn(KEY, json.dumps(failed))
		with patch("oqiva.services.ai_service.requests.post", side_effect=requests.Timeout()):
			self.assertEqual(self.outcome(self.ask())["code"], "AI_TIMEOUT")

	def test_a_model_name_that_is_not_a_plain_identifier_is_never_put_in_the_address(self):
		odd = {**GEMINI, "model": "gemini-x/../../v1/keys"}
		with patch("oqiva.services.ai_service.get_ai_settings", return_value=odd):
			with patch("oqiva.services.ai_service.requests.post") as post:
				with self.assertRaises(ai_service.ProviderError):
					ai_service.call_provider("abc", "flowchart")
		post.assert_not_called()


class TestGatewayAddress(AiCase):
	def test_the_site_config_can_point_each_provider_at_a_gateway(self):
		conf = {
			"oqiva_ai_anthropic_url": "https://gateway.example/anthropic",
			"oqiva_ai_gemini_url": "https://gateway.example/g/{model}:generateContent",
		}
		with patch.dict(frappe.conf, conf):
			with patch(
				"oqiva.services.ai_service.requests.post", return_value=reply(json.dumps(GOOD))
			) as post:
				ai_service.call_provider("abc", "flowchart")
			self.assertEqual(post.call_args.args[0], "https://gateway.example/anthropic")
			with patch("oqiva.services.ai_service.get_ai_settings", return_value=dict(GEMINI)):
				with patch(
					"oqiva.services.ai_service.requests.post", return_value=gemini_reply(GOOD)
				) as post:
					ai_service.call_provider("abc", "flowchart")
			self.assertEqual(
				post.call_args.args[0], "https://gateway.example/g/gemini-2.5-flash:generateContent"
			)


class TestRateLimit(AiCase):
	def test_the_eleventh_request_in_a_minute_is_refused(self):
		frappe.cache.delete_keys("rl:oqiva.api.ai.generate_diagram")
		frappe.local.request = frappe._dict(method="POST")
		frappe.local.request_ip = "203.0.113.9"
		try:
			with patch("oqiva.services.ai_service.call_provider", return_value=json.dumps(GOOD)):
				for _ in range(10):
					ai_api.generate_diagram("A sign in flow")
				with self.assertRaises(frappe.RateLimitExceededError):
					ai_api.generate_diagram("A sign in flow")
		finally:
			frappe.cache.delete_keys("rl:oqiva.api.ai.generate_diagram")
			frappe.local.request = None


class TestSettings(IntegrationTestCase):
	"""The provider settings as an administrator saves them."""

	def setUp(self):
		super().setUp()
		# each test starts from the stored settings, not from what the one before it saved
		frappe.db.savepoint("ai_settings")

	def tearDown(self):
		frappe.db.rollback(save_point="ai_settings")
		frappe.clear_document_cache("Oqiva Settings", "Oqiva Settings")
		super().tearDown()

	def save(self, **values):
		doc = frappe.get_single("Oqiva Settings")
		doc.flags.ignore_version = True
		doc.update(values)
		doc.save()

	def test_it_is_off_until_a_provider_and_key_are_saved(self):
		self.assertEqual(get_ai_settings()["provider"], "none")
		self.assertFalse(ai_service.is_configured())

	def test_a_provider_needs_a_key(self):
		for provider in ("anthropic", "gemini"):
			with self.assertRaises(OqivaError):
				self.save(ai_provider=provider, ai_api_key=None, ai_model="")

	def test_a_model_must_belong_to_its_provider_and_a_blank_one_uses_the_default(self):
		with self.assertRaises(OqivaError):
			self.save(ai_provider="gemini", ai_api_key=KEY, ai_model="claude-sonnet-5-5")
		with self.assertRaises(OqivaError):
			self.save(ai_provider="anthropic", ai_api_key=KEY, ai_model="gemini-2.5-flash")
		self.save(ai_provider="gemini", ai_api_key=KEY, ai_model="")
		self.assertEqual(get_ai_settings()["model"], "gemini-2.5-flash")
		self.save(ai_provider="anthropic", ai_api_key=KEY, ai_model="")
		self.assertEqual(get_ai_settings()["model"], "claude-sonnet-5-5")

	def test_switching_provider_never_sends_the_other_providers_model(self):
		# a model left over from the other provider is ignored when the settings are read
		self.save(ai_provider="anthropic", ai_api_key=KEY, ai_model="claude-opus-5-5")
		frappe.db.set_single_value("Oqiva Settings", "ai_provider", "gemini")
		self.assertEqual(get_ai_settings()["model"], "gemini-2.5-flash")

	def test_the_key_is_stored_encrypted_and_read_back_only_on_the_server(self):
		self.save(ai_provider="anthropic", ai_model="claude-sonnet-5-5", ai_api_key=KEY)
		self.assertEqual(
			get_ai_settings(), {"provider": "anthropic", "model": "claude-sonnet-5-5", "api_key": KEY}
		)
		stored = frappe.db.sql(
			"select value from tabSingles where doctype='Oqiva Settings' and field='ai_api_key'"
		)
		self.assertFalse(stored and KEY in str(stored))
		self.assertTrue(ai_service.is_configured())
