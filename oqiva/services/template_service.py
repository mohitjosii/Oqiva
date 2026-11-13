"""Templates: a catalogue of ready-made boards, stored as Oqiva documents (ADR-005).

Admins keep the catalogue in Desk, and ``seed_templates`` fills it from the JSON files in
``oqiva/seed/templates``. Users never read the table directly. They list and preview
templates here, and ``board_service.create_board`` copies one into a new board on the server.
"""

import hashlib
import json
import re
from pathlib import Path

import frappe
from frappe import _

from oqiva.constants import ROLE_USER
from oqiva.exceptions import OqivaError, OqivaForbidden, OqivaNotFound
from oqiva.services import document_service
from oqiva.utils.text import clean_line, clean_text

TEMPLATE_DOCTYPE = "Oqiva Template"
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SEED_KEYS = ("slug", "name", "description", "category", "tags", "sort_order", "document")
LABEL_CHARS = 40
MAX_PREVIEW_ITEMS = 120
MAX_TAGS = 20
LIST_FIELDS = [
	"name",
	"template_name",
	"description",
	"category",
	"tags",
	"preview_image",
	"object_count",
	"preview",
	"sort_order",
]


def seed_directory() -> Path:
	return Path(frappe.get_app_path("oqiva", "seed", "templates"))


# ---------------------------------------------------------------------------
# validating and preparing a row (Desk edits and the seed)
# ---------------------------------------------------------------------------


def split_tags(value: str | list | None) -> list[str]:
	"""Tags from a comma-separated string or a list, trimmed and without duplicates."""
	items = value if isinstance(value, list) else (value or "").split(",")
	seen: dict[str, str] = {}
	for item in items:
		tag = clean_line(str(item), _("Tag"), 40, required=False)
		if tag:
			seen.setdefault(tag.lower(), tag)
	if len(seen) > MAX_TAGS:
		raise OqivaError(_("A template has at most {0} tags.").format(MAX_TAGS))
	return list(seen.values())


def _label(item: dict) -> str | None:
	"""The first characters of an object's text, for a preview caption."""
	text = item.get("text")
	if not isinstance(text, dict):
		return None
	parts = [
		run["t"]
		for paragraph in text.get("paragraphs", [])
		if isinstance(paragraph, dict)
		for run in paragraph.get("runs", [])
		if isinstance(run, dict) and isinstance(run.get("t"), str)
	]
	label = " ".join(" ".join(parts).split())[:LABEL_CHARS]
	return label or None


def _round(value) -> int | float:
	return round(value, 1) if isinstance(value, float) else value


def _preview_end(end: dict) -> dict:
	if "objectId" in end:
		return {"objectId": end["objectId"], "anchor": end.get("anchor")}
	return {"x": _round(end.get("x", 0)), "y": _round(end.get("y", 0))}


BRANCH_COLORS = ("#3B82F6", "#22C55E", "#F97316", "#8B5CF6", "#EC4899", "#14B8A6", "#EAB308", "#EF4444")


def _mindmap_preview(entry: dict) -> tuple[list, list]:
	"""Boxes and lines that sketch a mind map for a thumbnail. The real layout runs in the browser, so
	this is a rough one: levels step outward, leaves are stacked, parents sit in the middle of their
	children, first-level branches alternate right and left, and each side is centred on the root."""
	nodes = {
		n["id"]: n for n in entry.get("nodes", []) if isinstance(n, dict) and isinstance(n.get("id"), str)
	}
	children: dict = {}
	for node in nodes.values():
		children.setdefault(node.get("parentId"), []).append(node)
	for kids in children.values():
		kids.sort(key=lambda n: (n.get("order", 0), n["id"]))
	root_id = entry.get("rootId")
	if root_id not in nodes:
		return [], []
	origin = entry.get("origin") if isinstance(entry.get("origin"), dict) else {}
	ox, oy = origin.get("x", 0), origin.get("y", 0)
	step_x, row = 190, 44
	boxes: list = []
	lines: list = []

	def box(node_id: str, x: float, y: float, width: int, height: int, fill: str) -> dict:
		return {
			"id": node_id,
			"kind": "shape",
			"shape": "rectangle",
			"x": ox + x - width / 2,
			"y": oy + y - height / 2,
			"w": width,
			"h": height,
			"style": {"fill": fill, "stroke": None},
			"label": (nodes[node_id].get("text") or "")[:LABEL_CHARS] or None,
		}

	def place(node_id: str, depth: int, side: int, branch: int, cursor: list, out: list) -> float:
		"""The y of this node's centre; ``cursor`` hands out rows to leaves."""
		kids = [] if nodes[node_id].get("collapsed") else children.get(node_id, [])
		if not kids:
			y = cursor[0]
			cursor[0] += row
		else:
			ys = [place(k["id"], depth + 1, side, branch, cursor, out) for k in kids]
			y = (ys[0] + ys[-1]) / 2
			for k in kids:
				lines.append(
					{
						"id": f"{node_id}>{k['id']}",
						"from": {"objectId": node_id, "anchor": "e" if side == 1 else "w"},
						"to": {"objectId": k["id"], "anchor": "w" if side == 1 else "e"},
					}
				)
		out.append(
			box(node_id, side * depth * step_x, y, 130, 32, BRANCH_COLORS[branch % len(BRANCH_COLORS)])
		)
		return y

	first_level = children.get(root_id, [])
	groups: dict = {1: [], -1: []}
	for index, kid in enumerate(first_level):
		groups[1 if entry.get("layout") == "right" or index % 2 == 0 else -1].append((index, kid))
	for side, items in groups.items():
		if not items:
			continue
		cursor, placed = [0.0], []
		for index, kid in items:
			place(kid["id"], 1, side, index, cursor, placed)
			lines.append(
				{
					"id": f"{root_id}>{kid['id']}",
					"from": {"objectId": root_id, "anchor": "e" if side == 1 else "w"},
					"to": {"objectId": kid["id"], "anchor": "w" if side == 1 else "e"},
				}
			)
		shift = -(cursor[0] - row) / 2  # centre this side on the root
		for item in placed:
			item["y"] += shift
		boxes.extend(placed)
	boxes.append(box(root_id, 0, 0, 150, 40, "#334155"))
	return boxes, lines


FLOW_PREVIEW_SIZES = {
	"terminator": (160, 56, "ellipse", "#DBEAFE"),
	"process": (170, 64, "rectangle", "#FFFFFF"),
	"decision": (190, 120, "diamond", "#FEF3C7"),
	"io": (180, 64, "rectangle", "#E0F2FE"),
	"junction": (24, 24, "ellipse", "#64748B"),
}


def _flowchart_preview(entry: dict) -> tuple[list, list]:
	"""Boxes and lines that sketch a flowchart for a thumbnail. A step's position is already stored
	(its centre), so this only gives each type its usual size and shape, and joins the steps by the
	sides that face each other."""
	nodes = {
		n["id"]: n
		for n in entry.get("nodes", [])
		if isinstance(n, dict)
		and isinstance(n.get("id"), str)
		and isinstance(n.get("x"), int | float)
		and isinstance(n.get("y"), int | float)
	}
	boxes = []
	for node_id, node in nodes.items():
		width, height, shape, fill = FLOW_PREVIEW_SIZES.get(node.get("type"), FLOW_PREVIEW_SIZES["process"])
		boxes.append(
			{
				"id": node_id,
				"kind": "shape",
				"shape": shape,
				"x": node["x"] - width / 2,
				"y": node["y"] - height / 2,
				"w": width,
				"h": height,
				"style": {"fill": fill, "stroke": "#475569"},
				"label": (node.get("text") or "")[:LABEL_CHARS] or None,
			}
		)
	lines = []
	for edge in entry.get("edges", []):
		a, b = nodes.get(edge.get("from")), nodes.get(edge.get("to"))
		if not a or not b:
			continue
		dx, dy = b["x"] - a["x"], b["y"] - a["y"]
		if (entry.get("direction") == "LR" and dx < 0) or (entry.get("direction") != "LR" and dy < 0):
			continue  # an arrow that loops back would only be a diagonal scribble in a thumbnail
		if abs(dy) >= abs(dx):
			start, end = ("s", "n") if dy >= 0 else ("n", "s")
		else:
			start, end = ("e", "w") if dx >= 0 else ("w", "e")
		lines.append(
			{
				"id": edge.get("id"),
				"from": {"objectId": a["id"], "anchor": start},
				"to": {"objectId": b["id"], "anchor": end},
			}
		)
	return boxes, lines


def build_preview(document: dict) -> dict:
	"""What a thumbnail needs from a document: boxes with colours and a caption, and line ends.

	The result is small and safe to send to every user. It leaves out everything else, so a
	preview never carries images or table content."""
	objects = []
	items = [o for o in document.get("objects", []) if isinstance(o, dict) and o.get("kind")]
	items.sort(key=lambda o: o.get("z", 0) if isinstance(o.get("z", 0), int | float) else 0)
	for item in items[:MAX_PREVIEW_ITEMS]:
		style = item.get("style") if isinstance(item.get("style"), dict) else {}
		objects.append(
			{
				"id": item.get("id"),
				"kind": item.get("kind"),
				"shape": item.get("shape"),
				"x": _round(item.get("x", 0)),
				"y": _round(item.get("y", 0)),
				"w": _round(item.get("w", 0)),
				"h": _round(item.get("h", 0)),
				"style": {"fill": style.get("fill"), "stroke": style.get("stroke")},
				"label": _label(item),
			}
		)
	connectors = [
		{"id": c.get("id"), "from": _preview_end(c["from"]), "to": _preview_end(c["to"])}
		for c in document.get("connectors", [])[:MAX_PREVIEW_ITEMS]
		if isinstance(c, dict) and isinstance(c.get("from"), dict) and isinstance(c.get("to"), dict)
	]
	for entry in document.get("mindmaps", [])[:5]:
		if isinstance(entry, dict) and len(objects) < MAX_PREVIEW_ITEMS:
			boxes, lines = _mindmap_preview(entry)
			objects.extend(boxes[: MAX_PREVIEW_ITEMS - len(objects)])
			connectors.extend(lines[: MAX_PREVIEW_ITEMS - len(connectors)])
	for entry in document.get("flowcharts", [])[:5]:
		if isinstance(entry, dict) and len(objects) < MAX_PREVIEW_ITEMS:
			boxes, lines = _flowchart_preview(entry)
			objects.extend(boxes[: MAX_PREVIEW_ITEMS - len(objects)])
			connectors.extend(lines[: MAX_PREVIEW_ITEMS - len(connectors)])
	return {"objects": objects, "connectors": connectors}


def prepare_row(doc) -> None:
	"""Check and normalise a template row. Raises OqivaError on anything invalid."""
	doc.slug = (doc.slug or "").strip()
	if not SLUG.match(doc.slug) or len(doc.slug) > 60:
		raise OqivaError(_("The slug may hold lower-case letters, numbers and single hyphens (60 at most)."))
	doc.template_name = clean_line(doc.template_name, _("Template name"), 120)
	doc.category = clean_line(doc.category, _("Category"), 60)
	doc.description = clean_text(doc.description, _("Description"), 500)
	doc.tags = ", ".join(split_tags(doc.tags)) or None
	doc.sort_order = int(doc.sort_order or 0)
	raw = doc.document if isinstance(doc.document, str) else json.dumps(doc.document)
	document, count = document_service.parse_document(raw)
	doc.document = json.dumps(document, separators=(",", ":"))
	doc.schema_version = document["schemaVersion"]
	doc.object_count = count
	doc.preview = json.dumps(build_preview(document), separators=(",", ":"))


# ---------------------------------------------------------------------------
# seeding
# ---------------------------------------------------------------------------


def _read_seed_file(path: Path) -> tuple[dict, str]:
	"""A seed file's content and its hash. Raises ValueError with the reason when invalid."""
	raw = path.read_bytes()
	try:
		data = json.loads(raw)
	except ValueError as error:
		raise ValueError(f"not valid JSON ({error})") from error
	if not isinstance(data, dict):
		raise ValueError("the file must hold a JSON object")
	missing = [key for key in SEED_KEYS if key not in data]
	if missing:
		raise ValueError(f"missing keys: {', '.join(missing)}")
	if not isinstance(data["slug"], str) or not SLUG.match(data["slug"]) or len(data["slug"]) > 60:
		raise ValueError("slug must be lower-case words joined by hyphens")
	for key in ("name", "description", "category"):
		if not isinstance(data[key], str):
			raise ValueError(f"{key} must be text")
	if not isinstance(data["tags"], list) or not all(isinstance(t, str) for t in data["tags"]):
		raise ValueError("tags must be a list of text")
	if not isinstance(data["sort_order"], int) or isinstance(data["sort_order"], bool):
		raise ValueError("sort_order must be a whole number")
	document = data["document"]
	if not isinstance(document, dict):
		raise ValueError("document must be an Oqiva document object")
	version = document.get("schemaVersion")
	if not isinstance(version, int) or isinstance(version, bool):
		raise ValueError("document.schemaVersion must be a whole number")
	if version > document_service.SUPPORTED_SCHEMA:
		raise ValueError("document was written by a newer version of Oqiva")
	return data, hashlib.sha256(raw).hexdigest()


def _values(data: dict) -> dict:
	return {
		"template_name": data["name"],
		"description": data["description"],
		"category": data["category"],
		"tags": ", ".join(data["tags"]),
		"sort_order": data["sort_order"],
		"document": json.dumps(data["document"], separators=(",", ":")),
	}


def seed_templates() -> dict:
	"""Create or update the catalogue from ``oqiva/seed/templates/*.json``. Safe to repeat.

	A row is written only when its file's content changed, so a second run changes nothing and
	an admin's later edit (such as unpublishing a template) lasts until the file changes. An
	invalid file is logged and skipped, never raised, so a bad file cannot break a migrate.
	"""
	summary = {"created": 0, "updated": 0, "unchanged": 0, "skipped": 0}
	seen: set[str] = set()
	directory = seed_directory()
	for path in sorted(directory.glob("*.json")) if directory.is_dir() else []:
		try:
			data, digest = _read_seed_file(path)
			if data["slug"] in seen:
				raise ValueError(f"slug {data['slug']} is already used by another file")
			seen.add(data["slug"])
			outcome = _upsert(data, digest)
		except Exception as error:
			summary["skipped"] += 1
			frappe.log_error(title="Oqiva: skipped an invalid template file", message=f"{path.name}: {error}")
			continue
		summary[outcome] += 1
	return summary


def _upsert(data: dict, digest: str) -> str:
	slug = data["slug"]
	stored = frappe.db.get_value(TEMPLATE_DOCTYPE, slug, "source_hash")
	exists = frappe.db.exists(TEMPLATE_DOCTYPE, slug)
	if exists and stored == digest:
		return "unchanged"
	if exists:
		doc = frappe.get_doc(TEMPLATE_DOCTYPE, slug)
		doc.update(_values(data))
		doc.source_hash = digest
		doc.save(ignore_permissions=True)
		return "updated"
	doc = frappe.new_doc(TEMPLATE_DOCTYPE)
	doc.update({"slug": slug, "published": 1, "source_hash": digest, **_values(data)})
	doc.insert(ignore_permissions=True)
	return "created"


# ---------------------------------------------------------------------------
# reading
# ---------------------------------------------------------------------------


def _require_reader(user: str) -> None:
	if ROLE_USER not in frappe.get_roles(user):
		raise OqivaForbidden()


def _card(row) -> dict:
	try:
		preview = json.loads(row.preview or "{}")
	except ValueError:
		preview = {}
	return {
		"slug": row.name,
		"name": row.template_name,
		"description": row.description or "",
		"category": row.category,
		"tags": split_tags(row.tags),
		"preview_image": row.preview_image,
		"object_count": row.object_count or 0,
		"preview": {
			"objects": preview.get("objects", []),
			"connectors": preview.get("connectors", []),
		},
	}


def _published_rows() -> list:
	return frappe.get_all(
		TEMPLATE_DOCTYPE,
		filters={"published": 1},
		fields=LIST_FIELDS,
		order_by="sort_order asc, template_name asc",
		limit_page_length=0,
	)


def _matches(card: dict, needle: str) -> bool:
	haystack = " ".join([card["name"], card["description"], *card["tags"]])
	return needle in haystack.lower()


def list_templates(user: str, category: str | None = None, query: str | None = None) -> dict:
	"""Published templates, optionally narrowed by category and a search text.

	The document itself is not included. ``categories`` always lists every category that has a
	published template, so a filter never hides the other choices."""
	_require_reader(user)
	cards = [_card(row) for row in _published_rows()]
	categories = list(dict.fromkeys(card["category"] for card in cards))
	needle = " ".join((query or "").lower().split())
	templates = [
		card
		for card in cards
		if (not category or card["category"] == category) and (not needle or _matches(card, needle))
	]
	return {"templates": templates, "categories": categories}


def get_template(user: str, slug: str) -> dict:
	"""One published template's details and a preview. The document itself is not included."""
	_require_reader(user)
	row = _published_row(slug)
	return _card(row)


def _published_row(slug: str):
	rows = frappe.get_all(
		TEMPLATE_DOCTYPE,
		filters={"name": slug or "", "published": 1},
		fields=LIST_FIELDS,
		limit_page_length=1,
	)
	if not rows:
		raise OqivaNotFound()
	return rows[0]


def copy_for_board(slug: str) -> dict:
	"""A fresh copy of a published template's document, for a new board.

	An unknown or unpublished slug gives the same not-found as any missing record. The copy
	is parsed from the stored text, so it shares nothing with the template and later edits to
	either never reach the other."""
	found = frappe.db.get_value(
		TEMPLATE_DOCTYPE,
		{"name": slug or "", "published": 1},
		["name", "template_name", "document"],
		as_dict=True,
	)
	if not found:
		raise OqivaNotFound()
	document, count = document_service.parse_document(found.document or "")
	return {
		"slug": found.name,
		"name": found.template_name,
		"document": json.dumps(document, separators=(",", ":")),
		"schema_version": document["schemaVersion"],
		"object_count": count,
	}
