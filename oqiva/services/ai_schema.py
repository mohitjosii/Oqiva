"""What the model may send back, and how it is read.

The model never produces drawings, HTML or code. It produces a small description (a title, nodes and
edges) and this module either turns it into a clean, bounded one or rejects it as a whole. Nothing
here touches a board: the browser draws the description with the editor's own layout engines.
"""

import json
import re

from oqiva.constants import AI_LIMITS, AI_SHAPES
from oqiva.utils.text import _SPACES, _STRIP

_ID = re.compile(r"^[A-Za-z0-9_-]{1,%d}$" % AI_LIMITS["max_id"])
_BLOCKS = re.compile(r"<(script|style)\b[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_TAGS = re.compile(r"<[^>]*>")
_FENCE = re.compile(r"^\s*```[a-zA-Z]*\s*|\s*```\s*$")
_STYLES = ("solid", "dashed")


class InvalidDiagram(Exception):
	"""The provider's answer is not a usable diagram. ``issues`` says why, in short plain terms."""

	def __init__(self, issues: list[str]):
		super().__init__("; ".join(issues))
		self.issues = issues


def extract_json(text: str) -> dict:
	"""The JSON object in a provider's reply: an optional code fence is dropped, and the text from the
	first ``{`` to the last ``}`` is parsed."""
	body = _FENCE.sub("", text or "").strip()
	start, end = body.find("{"), body.rfind("}")
	if start < 0 or end <= start:
		raise InvalidDiagram(["no JSON object in the reply"])
	try:
		value = json.loads(body[start : end + 1])
	except ValueError:
		raise InvalidDiagram(["the reply is not valid JSON"])
	if not isinstance(value, dict):
		raise InvalidDiagram(["the reply is not a JSON object"])
	return value


def _label(value, issues: list[str], where: str, required: bool) -> str | None:
	"""Plain text on one line: no markup, no control characters, at most 120 characters."""
	if value is None or value == "":
		if required:
			issues.append(f"{where}: label is missing")
		return None
	if not isinstance(value, str | int | float) or isinstance(value, bool):
		issues.append(f"{where}: label is not text")
		return None
	text = _SPACES.sub(" ", _STRIP.sub("", _TAGS.sub("", _BLOCKS.sub("", str(value))))).strip()
	if not text:
		if required:
			issues.append(f"{where}: label is empty")
		return None
	if len(text) > AI_LIMITS["max_label"]:
		issues.append(f"{where}: label is longer than {AI_LIMITS['max_label']} characters")
		return None
	return text


def validate_diagram(raw) -> dict:
	"""Check a parsed answer and return it clean: ``{title, nodes, edges}``. Raises InvalidDiagram.

	Unknown shapes become ``process`` and an unknown line style becomes ``solid`` (harmless, and not
	worth throwing a whole answer away for). Everything structural is strict: node and edge counts,
	ids, unique ids, and every edge naming two nodes that exist."""
	issues: list[str] = []
	if not isinstance(raw, dict):
		raise InvalidDiagram(["the answer is not an object"])
	raw_nodes = raw.get("nodes")
	raw_edges = raw.get("edges", [])
	if not isinstance(raw_nodes, list) or not raw_nodes:
		raise InvalidDiagram(["there are no nodes"])
	if not isinstance(raw_edges, list):
		raise InvalidDiagram(["edges is not a list"])
	if len(raw_nodes) > AI_LIMITS["max_nodes"]:
		raise InvalidDiagram([f"more than {AI_LIMITS['max_nodes']} nodes"])
	if len(raw_edges) > AI_LIMITS["max_edges"]:
		raise InvalidDiagram([f"more than {AI_LIMITS['max_edges']} edges"])

	nodes, seen = [], set()
	for index, item in enumerate(raw_nodes):
		where = f"node {index + 1}"
		if not isinstance(item, dict):
			issues.append(f"{where}: not an object")
			continue
		node_id = item.get("id")
		if not isinstance(node_id, str) or not _ID.match(node_id):
			issues.append(f"{where}: id is missing or has characters that are not allowed")
			continue
		if node_id in seen:
			issues.append(f"{where}: id is used twice")
			continue
		seen.add(node_id)
		label = _label(item.get("label"), issues, where, required=True)
		shape = item.get("shape")
		lane = _label(item.get("lane"), [], where, required=False)
		nodes.append(
			{
				"id": node_id,
				"label": label or "",
				"shape": shape if shape in AI_SHAPES else "process",
				"lane": lane[:64] if lane else None,
			}
		)

	edges = []
	for index, item in enumerate(raw_edges):
		where = f"edge {index + 1}"
		if not isinstance(item, dict):
			issues.append(f"{where}: not an object")
			continue
		source, target = item.get("from"), item.get("to")
		if source not in seen or target not in seen:
			issues.append(f"{where}: it joins a node that does not exist")
			continue
		style = item.get("style")
		edges.append(
			{
				"from": source,
				"to": target,
				"label": _label(item.get("label"), issues, where, required=False),
				"style": style if style in _STYLES else "solid",
			}
		)

	if issues:
		raise InvalidDiagram(issues[:10])
	title = _label(raw.get("title"), [], "title", required=False)
	return {"title": title, "nodes": nodes, "edges": edges}


def parse_reply(text: str) -> dict:
	"""A provider's reply text as a clean diagram description."""
	return validate_diagram(extract_json(text))
