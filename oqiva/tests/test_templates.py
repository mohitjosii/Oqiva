"""Templates: the seed, the catalogue API and creating a board from a template (P6.05)."""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from oqiva.api import board as board_api
from oqiva.api import template as template_api
from oqiva.constants import ROLE_ADMIN
from oqiva.exceptions import OqivaError, OqivaForbidden, OqivaLimitExceeded, OqivaNotFound
from oqiva.services import board_service, template_service
from oqiva.tests.utils import RestoresSettings, make_user, make_world

DOCTYPE = "Oqiva Template"


def sample_document(label: str = "Start here") -> dict:
	return {
		"schemaVersion": 1,
		"canvas": {"mode": "infinite", "preset": "16:9", "background": None, "grid": "off"},
		"theme": {"preset": "ocean"},
		"objects": [
			{
				"id": "a1",
				"kind": "shape",
				"shape": "rectangle",
				"x": 0,
				"y": 0,
				"w": 160,
				"h": 80,
				"rotation": 0,
				"z": 0,
				"style": {"fill": "#E7F0FE", "stroke": "#2563EB"},
				"text": {"paragraphs": [{"runs": [{"t": label}]}]},
			},
			{
				"id": "b2",
				"kind": "shape",
				"shape": "ellipse",
				"x": 300,
				"y": 40,
				"w": 120,
				"h": 80,
				"rotation": 0,
				"z": 1,
				"style": {"fill": "#FFF7E0", "stroke": "#B45309"},
			},
		],
		"connectors": [
			{
				"id": "c1",
				"from": {"objectId": "a1", "anchor": "e"},
				"to": {"objectId": "b2", "anchor": "w"},
				"geometry": "straight",
				"heads": {"start": "none", "end": "arrow"},
				"z": 2,
			}
		],
		"mindmaps": [],
		"flowcharts": [],
	}


def seed_file(slug: str, **overrides) -> dict:
	data = {
		"slug": slug,
		"name": f"Template {slug}",
		"description": "A test template.",
		"category": "Testing",
		"tags": ["one", "two"],
		"sort_order": 5,
		"document": sample_document(),
	}
	return {**data, **overrides}


def make_template(slug: str, published: bool = True, **overrides) -> str:
	"""Insert a template the way the seed does, then optionally unpublish it."""
	data = seed_file(slug, **overrides)
	template_service._upsert(data, "hash-" + slug)
	if not published:
		frappe.db.set_value(DOCTYPE, slug, "published", 0)
	return slug


class TestSeed(RestoresSettings, IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.folder = tempfile.TemporaryDirectory()
		self.addCleanup(self.folder.cleanup)
		patcher = patch.object(template_service, "seed_directory", lambda: Path(self.folder.name))
		patcher.start()
		self.addCleanup(patcher.stop)
		self.addCleanup(frappe.db.delete, DOCTYPE, {"name": ["like", "seed-%"]})

	def write(self, name: str, content) -> None:
		text = content if isinstance(content, str) else json.dumps(content)
		(Path(self.folder.name) / name).write_text(text)

	def test_seed_creates_every_file_and_is_idempotent(self):
		"""Success: a second run changes nothing, adds no rows and leaves modified alone."""
		self.write("one.json", seed_file("seed-one"))
		self.write("two.json", seed_file("seed-two", sort_order=2))
		first = template_service.seed_templates()
		self.assertEqual((first["created"], first["skipped"]), (2, 0))
		rows = frappe.get_all(DOCTYPE, filters={"name": ["like", "seed-%"]}, fields=["name", "modified"])
		self.assertEqual(len(rows), 2)
		second = template_service.seed_templates()
		self.assertEqual(second, {"created": 0, "updated": 0, "unchanged": 2, "skipped": 0})
		again = frappe.get_all(DOCTYPE, filters={"name": ["like", "seed-%"]}, fields=["name", "modified"])
		self.assertEqual(
			sorted((r.name, r.modified) for r in rows), sorted((r.name, r.modified) for r in again)
		)

	def test_seed_updates_only_the_file_that_changed(self):
		"""Success: an edited file updates its row, and a row an admin unpublished stays unpublished."""
		self.write("one.json", seed_file("seed-one"))
		self.write("two.json", seed_file("seed-two"))
		template_service.seed_templates()
		frappe.db.set_value(DOCTYPE, "seed-two", "published", 0)
		before = frappe.db.get_value(DOCTYPE, "seed-two", "modified")
		self.write("one.json", seed_file("seed-one", name="Renamed", document=sample_document("New text")))
		result = template_service.seed_templates()
		self.assertEqual((result["updated"], result["unchanged"]), (1, 1))
		row = frappe.get_doc(DOCTYPE, "seed-one")
		self.assertEqual(row.template_name, "Renamed")
		self.assertIn("New text", row.document)
		self.assertEqual(frappe.db.get_value(DOCTYPE, "seed-two", "modified"), before)
		self.assertEqual(frappe.db.get_value(DOCTYPE, "seed-two", "published"), 0)

	def test_invalid_files_are_skipped_and_logged(self):
		"""Failure: bad files never raise and never block the good one."""
		too_new = seed_file("seed-new", document={**sample_document(), "schemaVersion": 99})
		self.write("good.json", seed_file("seed-good"))
		self.write("broken.json", "{not json")
		self.write("list.json", "[]")
		self.write("missing.json", {"slug": "seed-missing"})
		self.write("badslug.json", seed_file("Not A Slug"))
		self.write("version.json", too_new)
		self.write("notdict.json", seed_file("seed-nd", document=[]))
		self.write("badtags.json", seed_file("seed-tags", tags="one,two"))
		self.write("zz-duplicate.json", seed_file("seed-good", name="Again"))
		with patch.object(frappe, "log_error") as log_error:
			result = template_service.seed_templates()
		self.assertEqual((result["created"], result["skipped"]), (1, 8))
		self.assertEqual(log_error.call_count, 8)
		self.assertTrue(frappe.db.exists(DOCTYPE, "seed-good"))
		self.assertEqual(frappe.db.get_value(DOCTYPE, "seed-good", "template_name"), "Template seed-good")
		self.assertFalse(frappe.db.exists(DOCTYPE, "seed-nd"))

	def test_a_file_over_the_document_limit_is_skipped(self):
		"""Boundary: the board document size limit applies to a template's document."""
		frappe.db.set_single_value("Oqiva Settings", "max_document_bytes", 300)
		self.write("big.json", seed_file("seed-big"))
		with patch.object(frappe, "log_error"):
			result = template_service.seed_templates()
		self.assertEqual((result["created"], result["skipped"]), (0, 1))
		self.assertFalse(frappe.db.exists(DOCTYPE, "seed-big"))

	def test_a_missing_folder_is_not_an_error(self):
		"""Boundary: no seed folder means nothing to do."""
		self.folder.cleanup()
		self.assertEqual(template_service.seed_templates()["created"], 0)


class TestShippedSeedFiles(IntegrationTestCase):
	def test_every_shipped_file_is_valid_and_slugs_are_unique(self):
		"""Success: each file under oqiva/seed/templates passes the same checks the seed applies."""
		files = sorted(template_service.seed_directory().glob("*.json"))
		self.assertTrue(files)
		slugs = []
		for path in files:
			data, _digest = template_service._read_seed_file(path)
			template_service.document_service.parse_document(json.dumps(data["document"]))
			self.assertEqual(path.stem, data["slug"], path.name)
			slugs.append(data["slug"])
		self.assertEqual(len(slugs), len(set(slugs)))
		self.assertIn("blank", slugs)

	def test_the_blank_template_is_installed(self):
		"""Success: migrate seeded the blank template."""
		self.assertEqual(frappe.db.get_value(DOCTYPE, "blank", ["published", "category"]), (1, "Basics"))


class TestCatalogue(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("tpl")
		make_template("cat-flow", category="Flowcharts", sort_order=2, tags=["process", "steps"])
		make_template("cat-plan", name="Quarterly plan", category="Planning", sort_order=1)
		make_template("cat-hidden", published=False)
		cls.nobody = make_user("tpl_norole@oqiva.test", roles=())

	def tearDown(self):
		frappe.set_user("Administrator")

	def slugs(self, **filters):
		return [t["slug"] for t in template_api.list_templates(**filters)["templates"]]

	def test_member_lists_published_templates_without_documents(self):
		"""Success: cards carry metadata and a preview, never the document, and unpublished is hidden."""
		frappe.set_user(self.w.member)
		result = template_api.list_templates()
		slugs = [t["slug"] for t in result["templates"]]
		self.assertIn("cat-flow", slugs)
		self.assertIn("blank", slugs)
		self.assertNotIn("cat-hidden", slugs)
		self.assertLess(slugs.index("cat-plan"), slugs.index("cat-flow"))
		card = next(t for t in result["templates"] if t["slug"] == "cat-flow")
		self.assertEqual(
			set(card),
			{
				"slug",
				"name",
				"description",
				"category",
				"tags",
				"preview_image",
				"object_count",
				"preview",
			},
		)
		self.assertEqual(card["tags"], ["process", "steps"])
		self.assertEqual(card["object_count"], 3)
		self.assertEqual(len(card["preview"]["objects"]), 2)
		self.assertIn("Flowcharts", result["categories"])

	def test_filters_by_category_and_search(self):
		"""Success: category is exact, search is case-insensitive over name, description, tags."""
		frappe.set_user(self.w.member)
		flowcharts = self.slugs(category="Flowcharts")  # the real catalogue has flowcharts too
		self.assertIn("cat-flow", flowcharts)
		self.assertNotIn("cat-plan", flowcharts)
		self.assertIn("cat-plan", self.slugs(query="  QUARTERLY "))
		self.assertNotIn("cat-plan", self.slugs(query="quarterly", category="Flowcharts"))
		self.assertNotIn("cat-flow", self.slugs(query="quarterly", category="Flowcharts"))
		self.assertIn("cat-flow", self.slugs(query="STEPS"))
		self.assertEqual(self.slugs(query="zzz-no-match"), [])
		everything = template_api.list_templates(category="Planning", query="zzz")
		self.assertIn("Flowcharts", everything["categories"])

	def test_get_template_returns_a_preview(self):
		"""Success: one template with the reduced preview and no document."""
		frappe.set_user(self.w.member)
		found = template_api.get_template("cat-flow")
		self.assertNotIn("document", found)
		first = found["preview"]["objects"][0]
		self.assertEqual(first["id"], "a1")
		self.assertEqual(first["label"], "Start here")
		self.assertEqual(first["style"], {"fill": "#E7F0FE", "stroke": "#2563EB"})
		self.assertEqual(found["preview"]["connectors"][0]["to"], {"objectId": "b2", "anchor": "w"})

	def test_unpublished_and_unknown_look_the_same(self):
		"""Failure: an unpublished template is as missing as one that never existed."""
		frappe.set_user(self.w.member)
		for slug in ("cat-hidden", "no-such-template", ""):
			with self.assertRaises(OqivaNotFound):
				template_api.get_template(slug)

	def test_guests_and_users_without_the_role_are_refused(self):
		"""Failure: no endpoint works for Guest, and a signed-in user needs the Oqiva User role."""
		frappe.set_user("Guest")
		with self.assertRaises(frappe.PermissionError):
			template_api.list_templates()
		with self.assertRaises(frappe.PermissionError):
			template_api.get_template("blank")
		frappe.set_user(self.nobody)
		with self.assertRaises(OqivaForbidden):
			template_api.list_templates()

	def test_users_cannot_read_or_write_the_table_directly(self):
		"""Failure: only System Manager and Oqiva Admin touch Oqiva Template in Desk."""
		admin = make_user("tpl_deskadmin@oqiva.test", roles=(ROLE_ADMIN,))
		for ptype, user, expected in (
			("read", self.w.member, False),
			("write", self.w.member, False),
			("create", self.w.owner, False),
			("read", admin, True),
			("write", admin, True),
			("delete", admin, True),
		):
			self.assertEqual(frappe.has_permission(DOCTYPE, ptype, user=user), expected, (ptype, user))
		frappe.set_user(self.w.member)
		with self.assertRaises(frappe.PermissionError):
			frappe.get_list(DOCTYPE, fields=["name"])

	def test_admin_edits_are_validated_and_recomputed(self):
		"""Failure and success: a Desk save refuses a bad document and refreshes the derived fields."""
		make_template("cat-edit")
		doc = frappe.get_doc(DOCTYPE, "cat-edit")
		doc.document = json.dumps({"schemaVersion": 99, "objects": []})
		with self.assertRaises(OqivaError):
			doc.save()
		doc = frappe.get_doc(DOCTYPE, "cat-edit")
		doc.document = json.dumps({**sample_document(), "objects": [], "connectors": []})
		doc.tags = " a , A,b ,,"
		doc.save()
		self.assertEqual((doc.object_count, doc.tags), (0, "a, b"))
		self.assertEqual(json.loads(doc.preview)["objects"], [])
		with self.assertRaises(OqivaError):
			frappe.get_doc(
				{**seed_file("x"), "doctype": DOCTYPE, "slug": "Bad Slug", "document": "{}"}
			).insert()


class TestPreview(IntegrationTestCase):
	def test_preview_keeps_only_what_a_thumbnail_needs(self):
		"""Boundary: long text is cut, extra fields are dropped, free line ends keep their position."""
		document = sample_document("x" * 100)
		document["objects"][0]["text"]["paragraphs"].append({"runs": [{"t": "second line"}]})
		document["objects"].append(
			{"id": "t1", "kind": "text", "x": 1.234, "y": 2, "w": 50, "h": 20, "rotation": 0, "z": 5}
		)
		document["connectors"].append(
			{"id": "c2", "from": {"x": 1.26, "y": 2}, "to": {"x": 9, "y": 9}, "z": 6}
		)
		preview = template_service.build_preview(document)
		self.assertEqual(len(preview["objects"][0]["label"]), 40)
		self.assertEqual(preview["objects"][2]["x"], 1.2)
		self.assertIsNone(preview["objects"][2]["label"])
		self.assertEqual(preview["connectors"][1]["from"], {"x": 1.3, "y": 2})
		self.assertEqual(
			set(preview["objects"][0]), {"id", "kind", "shape", "x", "y", "w", "h", "style", "label"}
		)

	def test_preview_is_capped(self):
		"""Boundary: a huge template cannot produce a huge preview."""
		document = sample_document()
		document["objects"] = [
			{"id": f"o{i}", "kind": "shape", "x": i, "y": 0, "w": 10, "h": 10, "z": i} for i in range(500)
		]
		preview = template_service.build_preview(document)
		self.assertEqual(len(preview["objects"]), template_service.MAX_PREVIEW_ITEMS)


class TestBoardFromTemplate(RestoresSettings, IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("tb")
		make_template("use-me", name="Retro board")
		make_template("use-hidden", published=False)

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def create(self, **kwargs):
		kwargs.setdefault("template", "use-me")
		return board_service.create_board(self.w.member, self.w.workspace, **kwargs)

	def test_copies_the_document_into_a_fresh_board(self):
		"""Success: content, title, provenance, revision 1, empty crdt state, owner and count."""
		board = self.create()
		self.assertEqual(board["title"], "Retro board")
		self.assertEqual(board["revision"], 1)
		self.assertEqual(board["object_count"], 3)
		row = frappe.db.get_value(
			"Oqiva Board",
			board["name"],
			["document", "crdt_state", "template", "created_by_user"],
			as_dict=True,
		)
		self.assertEqual(row.template, "use-me")
		self.assertEqual(row.created_by_user, self.w.member)
		self.assertFalse(row.crdt_state)
		self.assertEqual(json.loads(row.document), sample_document())
		self.assertTrue(board["capabilities"]["can_edit"])

	def test_explicit_title_and_project_are_kept(self):
		"""Success: a title given by the caller wins, and a project in the workspace is used."""
		board = self.create(title="  Sprint   42 ", project=self.w.project)
		self.assertEqual((board["title"], board["project"]), ("Sprint 42", self.w.project))

	def test_the_board_is_independent_of_later_template_edits(self):
		"""Success: editing the template afterwards leaves existing boards alone, and the reverse."""
		board = self.create()
		doc = frappe.get_doc(DOCTYPE, "use-me")
		doc.document = json.dumps({**sample_document("Changed"), "objects": []})
		doc.save()
		stored = json.loads(frappe.db.get_value("Oqiva Board", board["name"], "document"))
		self.assertEqual(stored, sample_document())
		frappe.db.set_value("Oqiva Board", board["name"], "document", json.dumps({"schemaVersion": 1}))
		self.assertEqual(json.loads(frappe.db.get_value(DOCTYPE, "use-me", "document"))["objects"], [])

	def test_two_boards_from_one_template_are_separate_rows(self):
		"""Success: each call gives a new board."""
		self.assertNotEqual(self.create()["name"], self.create()["name"])

	def test_unknown_or_unpublished_slug_is_not_found(self):
		"""Failure: the same not-found for both, and no board is left behind."""
		count = frappe.db.count("Oqiva Board", {"workspace": self.w.workspace})
		for slug in ("nope", "use-hidden"):
			with self.assertRaises(OqivaNotFound):
				self.create(template=slug)
		self.assertEqual(frappe.db.count("Oqiva Board", {"workspace": self.w.workspace}), count)

	def test_the_usual_create_checks_still_apply(self):
		"""Failure: role, membership, project and quota are checked for a template board too."""
		with self.assertRaises(OqivaForbidden):
			board_service.create_board(self.w.guest, self.w.workspace, template="use-me")
		with self.assertRaises(OqivaNotFound):
			board_service.create_board(self.w.outsider, self.w.workspace, template="use-me")
		with self.assertRaises(OqivaError):
			self.create(project="no-such-project")
		frappe.db.set_single_value("Oqiva Settings", "max_boards_per_workspace", 1)
		with self.assertRaises(OqivaLimitExceeded):
			self.create()

	def test_a_template_over_the_current_limit_is_refused(self):
		"""Boundary: a copy that could not be saved is not created."""
		frappe.db.set_single_value("Oqiva Settings", "max_document_bytes", 300)
		with self.assertRaises(OqivaLimitExceeded):
			self.create()

	def test_the_api_creates_from_a_template_as_a_member(self):
		"""Success: the whitelisted call works as an ordinary user and records an audit entry."""
		frappe.set_user(self.w.member)
		board = board_api.create_board(self.w.workspace, template="use-me")
		self.assertEqual(frappe.db.get_value("Oqiva Board", board["name"], "template"), "use-me")
		entry = frappe.db.get_value(
			"Oqiva Audit Log", {"action": "template_used", "resource_name": board["name"]}, "user"
		)
		self.assertEqual(entry, self.w.member)
		blank = board_api.create_board(self.w.workspace)
		self.assertIsNone(frappe.db.get_value("Oqiva Board", blank["name"], "template"))


class TestMindMapPreview(IntegrationTestCase):
	def entry(self):
		def node(node_id, parent, order, text, **over):
			return {"id": node_id, "parentId": parent, "order": order, "text": text, **over}

		return {
			"id": "m",
			"origin": {"x": 0, "y": 0},
			"rootId": "r",
			"layout": "both",
			"nodes": [
				node("r", None, 0, "Centre"),
				node("a", "r", 0, "Right one"),
				node("b", "r", 1, "Left one"),
				node("c", "r", 2, "Right two"),
				node("a1", "a", 0, "Deeper"),
				node("hid", "c", 0, "Hidden", collapsed=False),
				node("c1", "hid", 0, "Under hidden"),
			],
			"crosslinks": [],
		}

	def test_a_mind_map_is_sketched_for_the_gallery(self):
		"""Success: boxes for the nodes (right and left of the centre) and a line for each branch."""
		preview = template_service.build_preview(
			{"objects": [], "connectors": [], "mindmaps": [self.entry()]}
		)
		boxes = {o["id"]: o for o in preview["objects"]}
		self.assertEqual(set(boxes), {"r", "a", "b", "c", "a1", "hid", "c1"})
		self.assertEqual(boxes["r"]["label"], "Centre")
		centre = boxes["r"]["x"] + boxes["r"]["w"] / 2
		self.assertGreater(boxes["a"]["x"], centre)
		self.assertLess(boxes["b"]["x"], centre)
		self.assertEqual(len(preview["connectors"]), 6)

	def test_collapsed_nodes_hide_their_children_and_a_broken_map_gives_nothing(self):
		"""Boundary: a collapsed branch is not drawn; a map with no root yields no boxes."""
		entry = self.entry()
		entry["nodes"][5]["collapsed"] = True
		preview = template_service.build_preview({"objects": [], "connectors": [], "mindmaps": [entry]})
		self.assertNotIn("c1", {o["id"] for o in preview["objects"]})
		entry["rootId"] = "nobody"
		self.assertEqual(template_service.build_preview({"mindmaps": [entry]})["objects"], [])


class TestFlowchartPreview(IntegrationTestCase):
	def entry(self):
		def node(node_id, kind, x, y, text):
			return {"id": node_id, "type": kind, "x": x, "y": y, "text": text, "manual": False}

		return {
			"id": "f",
			"direction": "TB",
			"numbered": False,
			"nodes": [
				node("s", "terminator", 0, 0, "Start"),
				node("d", "decision", 0, 150, "Ready?"),
				node("p", "process", 300, 150, "Go"),
			],
			"edges": [
				{"id": "e1", "from": "s", "to": "d", "label": "", "order": 0},
				{"id": "e2", "from": "d", "to": "p", "label": "Yes", "order": 0},
				{"id": "e3", "from": "d", "to": "ghost", "label": "", "order": 1},
			],
		}

	def test_a_flowchart_is_sketched_for_the_gallery(self):
		"""Success: each step is a box of its type's shape, and each arrow joins the facing sides."""
		preview = template_service.build_preview(
			{"objects": [], "connectors": [], "flowcharts": [self.entry()]}
		)
		boxes = {o["id"]: o for o in preview["objects"]}
		self.assertEqual(set(boxes), {"s", "d", "p"})
		self.assertEqual(boxes["d"]["shape"], "diamond")
		self.assertEqual(boxes["s"]["label"], "Start")
		lines = {c["id"]: c for c in preview["connectors"]}
		self.assertEqual(set(lines), {"e1", "e2"})  # the arrow to a missing step is left out
		self.assertEqual(lines["e1"]["from"]["anchor"], "s")  # downward
		self.assertEqual(lines["e2"]["from"]["anchor"], "e")  # rightward

	def test_an_arrow_that_loops_back_is_left_out_of_the_sketch(self):
		"""Boundary: a thumbnail shows the forward flow only."""
		entry = self.entry()
		entry["edges"].append({"id": "back", "from": "p", "to": "s", "label": "", "order": 0})
		entry["nodes"].append(
			{"id": "up", "type": "process", "x": 0, "y": -200, "text": "Above", "manual": False}
		)
		entry["edges"].append({"id": "loop", "from": "d", "to": "up", "label": "", "order": 2})
		preview = template_service.build_preview({"flowcharts": [entry]})
		self.assertNotIn("loop", {c["id"] for c in preview["connectors"]})

	def test_steps_without_a_position_are_left_out(self):
		"""Boundary: a step that has no usable position is not drawn."""
		entry = self.entry()
		entry["nodes"][1]["x"] = "left"
		preview = template_service.build_preview({"flowcharts": [entry]})
		self.assertNotIn("d", {o["id"] for o in preview["objects"]})

	def test_the_flowchart_templates_in_the_catalogue_carry_their_steps(self):
		"""Success: the seeded flowchart templates are real flowcharts with a preview of them."""
		seeded = frappe.get_all(
			"Oqiva Template",
			filters={"slug": ("in", ("decision-tree", "user-signup-flow"))},
			fields=["slug", "document", "preview"],
		)
		self.assertEqual(len(seeded), 2)
		for row in seeded:
			document = json.loads(row.document)
			self.assertEqual(len(document["flowcharts"]), 1)
			self.assertEqual(document["objects"], [])
			self.assertGreaterEqual(len(json.loads(row.preview)["objects"]), 8)
