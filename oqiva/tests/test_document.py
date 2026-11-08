"""Loading and saving a board's content (T5.1 to T5.4, T7.4)."""

import json
import threading

import frappe
from frappe.tests import IntegrationTestCase

from oqiva.exceptions import (
	OqivaDocumentTooNew,
	OqivaError,
	OqivaForbidden,
	OqivaLimitExceeded,
	OqivaNotFound,
	OqivaStaleRevision,
)
from oqiva.services import board_service, document_service
from oqiva.tests.utils import RestoresSettings, make_user, make_world, share_board


def shape(object_id="a", **over):
	item = {
		"id": object_id,
		"kind": "shape",
		"shape": "rectangle",
		"x": 10,
		"y": 20,
		"w": 100,
		"h": 60,
		"rotation": 0,
		"z": 1,
		"style": {"fill": "#E7F0FE", "stroke": "#2563EB", "strokeWidth": 2, "opacity": 1},
		"text": {
			"align": "center",
			"size": 16,
			"color": "#1E3A8A",
			"paragraphs": [{"runs": [{"t": "Hi", "b": 1}]}],
		},
	}
	item.update(over)
	return item


def connector(connector_id="c1", **over):
	item = {
		"id": connector_id,
		"from": {"objectId": "a", "anchor": "e"},
		"to": {"x": 300, "y": 40},
		"geometry": "straight",
		"heads": {"start": "none", "end": "arrow"},
		"bend": 0,
		"style": {"stroke": "#475569", "strokeWidth": 2, "dash": "solid", "opacity": 1},
		"label": None,
		"z": 1,
	}
	item.update(over)
	return item


def table(rows=2, cols=2, **over):
	item = shape(
		"t1",
		kind="table",
		table={
			"rowH": [40] * rows,
			"colW": [100] * cols,
			"cells": [[None] * cols for _ in range(rows)],
			"fills": [[None] * cols for _ in range(rows)],
		},
	)
	item.update(over)
	return item


def doc(*objects, **over):
	body = {
		"schemaVersion": 1,
		"canvas": {"mode": "infinite", "background": None, "grid": "off"},
		"theme": {"preset": "ocean"},
		"objects": list(objects),
		"connectors": [],
		"mindmaps": [],
		"flowcharts": [],
	}
	body.update(over)
	return json.dumps(body)


class TestRichObjects(IntegrationTestCase):
	"""Lines, pictures and tables are checked as strictly as shapes."""

	def parse(self, *objects, connectors=()):
		return document_service.parse_document(doc(*objects, connectors=list(connectors)))

	def bad(self, *objects, connectors=()):
		with self.assertRaises(OqivaError):
			self.parse(*objects, connectors=connectors)

	def test_accepts_a_line_in_every_shape_and_with_free_or_attached_ends(self):
		lines = [
			connector("c1"),
			connector("c2", geometry="elbow", to={"objectId": "a", "anchor": "nw"}),
			connector("c3", geometry="curved", bend=-120.5, label={"text": "yes"}),
			connector(
				"c4",
				heads={"start": "dot", "end": "open"},
				style={"stroke": "#FF0000", "strokeWidth": 4, "dash": "dotted", "opacity": 0.5},
			),
		]
		self.assertEqual(self.parse(shape("a"), connectors=lines)[1], 5)

	def test_refuses_lines_that_are_not_well_formed(self):
		for change in (
			{"id": "bad id!"},
			{"from": "a"},
			{"from": {"objectId": "a", "anchor": "up"}},
			{"to": {"x": "left", "y": 3}},
			{"to": {"x": 1e9, "y": 0}},
			{"geometry": "zigzag"},
			{"heads": {"end": "rocket"}},
			{"heads": "arrow"},
			{"bend": 1e6},
			{"bend": "far"},
			{"z": float("inf")},
			{"style": {"stroke": "url(#x)"}},
			{"style": {"dash": "wavy"}},
			{"style": {"opacity": 2}},
			{"label": {"text": "x" * 201}},
			{"label": "yes"},
			{"label": {"text": 5}},
		):
			self.bad(shape("a"), connectors=[connector(**change)])

	def test_a_line_id_may_not_repeat_or_clash_with_a_shape(self):
		self.bad(shape("a"), connectors=[connector("c1"), connector("c1")])
		self.bad(shape("a"), connectors=[connector("a")])

	def test_accepts_flips_and_groups_and_refuses_bad_ones(self):
		self.assertEqual(self.parse(shape("a", flipX=True, flipY=False, groupId="g_1"))[1], 1)
		for change in ({"flipX": 1}, {"flipY": "yes"}, {"groupId": "bad id"}, {"groupId": 5}):
			self.bad(shape("a", **change))

	def test_accepts_a_picture_from_the_files_folder_only(self):
		from oqiva.tests.test_files import image

		self.assertEqual(self.parse(image("i", "/private/files/abc123.png"))[1], 1)
		for src in (
			"/files/abc.png",
			"https://example.com/x.png",
			"//example.com/x.png",
			"/private/files/../secret.png",
			"/private/files/a b.png",
			"javascript:alert(1)",
			"data:image/png;base64,AAAA",
			"/private/files/" + "a" * 300 + ".png",
			None,
			5,
		):
			self.bad(image("i", src))
		self.bad(image("i", "/private/files/a.png", alt="x" * 201))

	def test_accepts_a_table_and_refuses_one_whose_cells_do_not_fit(self):
		self.assertEqual(self.parse(table(3, 4))[1], 1)
		self.bad(table(rows=0))
		self.bad(table(rows=31))
		self.bad(table(cols=21))
		self.bad(table(table={"rowH": [40], "colW": [100], "cells": [[None, None]], "fills": [[None]]}))
		self.bad(table(table={"rowH": [40], "colW": [100], "cells": [[None]], "fills": [[None], [None]]}))
		self.bad(table(table={"rowH": [5], "colW": [100], "cells": [[None]], "fills": [[None]]}))
		self.bad(table(table={"rowH": [40], "colW": [100], "cells": [[None]], "fills": [["red"]]}))
		self.bad(table(table="a table"))

	def test_a_tables_cells_are_checked_like_any_text(self):
		cell = {"align": "left", "size": 16, "color": "#000000", "paragraphs": [{"runs": [{"t": "ok"}]}]}
		good = table(1, 1)
		good["table"]["cells"] = [[cell]]
		self.assertEqual(self.parse(good)[1], 1)
		bad = table(1, 1)
		bad["table"]["cells"] = [[{**cell, "color": "url(#x)"}]]
		self.bad(bad)

	def test_a_table_cannot_hold_an_unbounded_amount_of_text(self):
		cell = {
			"align": "left",
			"size": 16,
			"color": "#000000",
			"paragraphs": [{"runs": [{"t": "x" * 9000}]}],
		}
		big = table(3, 3)
		big["table"]["cells"] = [[cell] * 3 for _ in range(3)]  # 81,000 characters across nine cells
		self.bad(big)

	def test_still_keeps_an_object_kind_from_a_newer_version(self):
		self.assertEqual(self.parse({"id": "n1", "kind": "hologram", "anything": [1, 2]})[1], 1)


class TestValidation(RestoresSettings, IntegrationTestCase):
	def parse(self, raw, **kwargs):
		return document_service.parse_document(raw, **kwargs)

	def test_accepts_an_empty_document_and_real_shapes(self):
		"""Success: a blank board and one with shapes, text and a connector list are valid."""
		self.assertEqual(self.parse(doc())[1], 0)
		parsed, count = self.parse(doc(shape("a"), shape("b", kind="text"), connectors=[connector("c1")]))
		self.assertEqual(count, 3)
		self.assertEqual(parsed["schemaVersion"], 1)

	def test_keeps_object_kinds_from_a_newer_version(self):
		"""Boundary: an unknown kind with a valid id is accepted untouched."""
		self.assertEqual(self.parse(doc({"id": "future1", "kind": "hologram", "anything": [1, 2]}))[1], 1)
		with self.assertRaises(OqivaError):
			self.parse(doc({"id": "bad id!", "kind": "hologram"}))

	def test_rejects_content_that_is_not_a_document(self):
		"""Failure: bad JSON, wrong shapes and missing or non-integer versions are refused."""
		bad = (
			"not json",
			"[]",
			"null",
			'"text"',
			json.dumps({"objects": []}),
			json.dumps({"schemaVersion": "1"}),
			json.dumps({"schemaVersion": True}),
			json.dumps({"schemaVersion": -1}),
			doc(objects="nope"),
		)
		for raw in bad:
			with self.assertRaises(OqivaError, msg=raw):
				self.parse(raw)

	def test_refuses_a_document_from_a_newer_version(self):
		"""Failure: a newer schema is not guessed at."""
		with self.assertRaises(OqivaDocumentTooNew):
			self.parse(json.dumps({"schemaVersion": 99, "objects": []}))

	def test_rejects_bad_objects(self):
		"""Failure: bad ids, repeated ids, non-finite or missing numbers are refused."""
		cases = [
			shape("a b"),
			shape(""),
			shape("x" * 65),
			shape("a", w=0),
			shape("a", x="10"),
			shape("a", x=True),
			shape("a", h=1e9),
			shape("a", rotation=None),
		]
		for case in cases:
			with self.assertRaises(OqivaError, msg=str(case)):
				self.parse(doc(case))
		with self.assertRaises(OqivaError):
			self.parse(doc(shape("a"), shape("a")))
		not_a_number = (
			'{"schemaVersion": 1, "objects": [{"id": "n", "kind": "shape", "x": NaN, '
			'"y": 0, "w": 1, "h": 1, "rotation": 0, "z": 0}]}'
		)
		with self.assertRaises(OqivaError):
			self.parse(not_a_number)

	def test_rejects_colours_that_could_load_an_outside_address(self):
		"""Failure: only hex colours are accepted, so url(...) can never reach the browser (T7.4)."""
		styles = (
			{"fill": "url(http://evil.example/x)"},
			{"stroke": "red"},
			{"fill": "#12"},
			{"opacity": 2},
			{"strokeWidth": -1},
		)
		for style in styles:
			with self.assertRaises(OqivaError, msg=str(style)):
				self.parse(doc(shape("a", style=style)))
		with self.assertRaises(OqivaError):
			self.parse(doc(canvas={"background": "url(http://evil.example)"}))
		with self.assertRaises(OqivaError):
			self.parse(doc(shape("a", text={"paragraphs": [{"runs": [{"t": "x", "c": "javascript:1"}]}]})))

	def test_rejects_malformed_text(self):
		"""Failure: text needs paragraphs of runs, and is capped in length."""
		texts = (
			{"paragraphs": "x"},
			{"paragraphs": [{"runs": "x"}]},
			{"paragraphs": [{"runs": [{"t": 5}]}]},
			{"paragraphs": [{"runs": [{"t": "x" * 10_001}]}]},
		)
		for text in texts:
			with self.assertRaises(OqivaError, msg=str(text)):
				self.parse(doc(shape("a", text=text)))

	def test_enforces_the_size_and_object_limits(self):
		"""Failure: a document over either limit is refused, unless limits are switched off for reading."""
		frappe.db.set_single_value("Oqiva Settings", "max_objects_per_board", 2)
		many = doc(shape("a"), shape("b"), shape("c"))
		with self.assertRaises(OqivaLimitExceeded):
			self.parse(many)
		self.assertEqual(self.parse(many, enforce_limits=False)[1], 3)
		frappe.db.set_single_value("Oqiva Settings", "max_objects_per_board", 3000)
		frappe.db.set_single_value("Oqiva Settings", "max_document_bytes", 200)
		with self.assertRaises(OqivaLimitExceeded):
			self.parse(doc(shape("a")))
		self.assertEqual(self.parse(doc(shape("a")), enforce_limits=False)[1], 1)

	def test_counts_connectors_and_nodes_toward_the_limit(self):
		"""Success: everything drawable counts, not only shapes."""
		raw = doc(
			shape("a"),
			connectors=[connector("c1"), connector("c2")],
			mindmaps=[{"id": "m", "nodes": [{}, {}, {}]}],
			flowcharts=[{"id": "f", "nodes": [{}]}],
		)
		self.assertEqual(self.parse(raw)[1], 7)


class TestSaveAndLoad(RestoresSettings, IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("doc")

	def new_board(self):
		return board_service.create_board(self.w.member, self.w.workspace, None, "Content")["name"]

	def save(self, board, raw, base, save_id, user=None):
		return document_service.save_document(user or self.w.member, board, raw, base, save_id)

	def test_a_new_board_loads_blank_at_revision_one(self):
		"""Success: the first load is the empty document at revision 1."""
		loaded = document_service.load_document(self.w.member, self.new_board())
		self.assertEqual(loaded["revision"], 1)
		self.assertIsNone(loaded["recovery"])
		self.assertEqual(json.loads(loaded["document"])["objects"], [])
		self.assertTrue(loaded["capabilities"]["can_edit"])
		self.assertEqual(loaded["limits"]["max_objects_per_board"], 3000)

	def test_save_then_load_round_trips_and_bumps_the_revision(self):
		"""Success: a save is stored whole, counted, and the revision goes up by one."""
		board = self.new_board()
		result = self.save(board, doc(shape("a"), shape("b", x=300)), 1, "save000001")
		self.assertEqual(result, {"revision": 2, "replayed": False})
		loaded = document_service.load_document(self.w.member2, board)
		self.assertEqual(loaded["revision"], 2)
		self.assertEqual(json.loads(loaded["document"])["objects"][1]["x"], 300)
		row = frappe.db.get_value(
			"Oqiva Board", board, ["object_count", "schema_version", "last_save_id"], as_dict=True
		)
		self.assertEqual((row.object_count, row.schema_version, row.last_save_id), (2, 1, "save000001"))

	def test_a_stale_save_is_refused_and_writes_nothing(self):
		"""Failure: saving against an old revision raises and leaves the board as it was (T5.1)."""
		board = self.new_board()
		self.save(board, doc(shape("a")), 1, "save000001")
		with self.assertRaises(OqivaStaleRevision):
			self.save(board, doc(shape("b")), 1, "save000002", user=self.w.member2)
		stored = json.loads(frappe.db.get_value("Oqiva Board", board, "document"))
		self.assertEqual([o["id"] for o in stored["objects"]], ["a"])
		with self.assertRaises(OqivaStaleRevision):
			self.save(board, doc(), 5, "save000003")  # a revision from the future is no better

	def test_a_repeated_save_id_is_a_replay_not_a_conflict(self):
		"""Success: resending a save whose reply was lost returns the same revision (T5.2)."""
		board = self.new_board()
		first = self.save(board, doc(shape("a")), 1, "save000001")
		again = self.save(board, doc(shape("a")), 1, "save000001")
		self.assertEqual(first["revision"], 2)
		self.assertEqual(again, {"revision": 2, "replayed": True})
		self.assertEqual(frappe.db.get_value("Oqiva Board", board, "revision"), 2)

	def test_a_save_needs_an_id_and_a_valid_document(self):
		"""Failure: nothing is stored for a missing id, an invalid document or one over the limit (T5.4)."""
		board = self.new_board()
		for save_id in ("", "bad id", None):
			with self.assertRaises(OqivaError):
				self.save(board, doc(), 1, save_id)
		with self.assertRaises(OqivaError):
			self.save(board, "not json", 1, "save000001")
		frappe.db.set_single_value("Oqiva Settings", "max_objects_per_board", 1)
		with self.assertRaises(OqivaLimitExceeded):
			self.save(board, doc(shape("a"), shape("b")), 1, "save000002")
		self.assertEqual(frappe.db.get_value("Oqiva Board", board, "revision"), 1)

	def test_only_editors_save_and_only_people_with_access_load(self):
		"""Failure: viewers and commenters cannot save; outsiders and plain guests get not found."""
		board = self.new_board()
		viewer, commenter, editor = (
			make_user(f"doc_{n}@oqiva.test") for n in ("viewer", "commenter", "editor")
		)
		share_board(board, viewer, "view")
		share_board(board, commenter, "comment")
		share_board(board, editor, "edit")
		for user in (viewer, commenter):
			with self.assertRaises(OqivaForbidden):
				self.save(board, doc(), 1, "save000001", user=user)
			self.assertTrue(document_service.load_document(user, board)["document"])
		self.assertEqual(self.save(board, doc(), 1, "save000002", user=editor)["revision"], 2)
		for user in (self.w.outsider, self.w.guest):
			with self.assertRaises(OqivaNotFound):
				document_service.load_document(user, board)
			with self.assertRaises(OqivaNotFound):
				self.save(board, doc(), 2, "save000003", user=user)
			with self.assertRaises(OqivaNotFound):
				document_service.get_revision(user, board)

	def test_a_trashed_board_cannot_be_saved(self):
		"""Failure: nothing can be saved to a board in Trash."""
		board = self.new_board()
		board_service.trash_board(self.w.member, board)
		with self.assertRaises(OqivaNotFound):
			self.save(board, doc(), 1, "save000001")

	def test_a_damaged_or_newer_document_loads_as_a_recovery_not_a_blank_board(self):
		"""Success: a bad stored document is reported, never silently replaced with an empty one."""
		board = self.new_board()
		# The column only holds valid JSON, so a damaged document is valid JSON that is not a board.
		frappe.db.set_value("Oqiva Board", board, "document", "[1, 2, 3]")
		damaged = document_service.load_document(self.w.member, board)
		self.assertEqual((damaged["recovery"], damaged["document"]), ("corrupt", None))
		frappe.db.set_value("Oqiva Board", board, "document", json.dumps({"schemaVersion": 7, "objects": []}))
		newer = document_service.load_document(self.w.member, board)
		self.assertEqual((newer["recovery"], newer["document"]), ("too_new", None))
		frappe.db.set_value("Oqiva Board", board, "document", None)
		blank = document_service.load_document(self.w.member, board)
		self.assertIsNone(blank["recovery"])
		self.assertEqual(json.loads(blank["document"])["schemaVersion"], 1)

	def test_a_board_over_a_lowered_limit_still_opens(self):
		"""Boundary: lowering a limit never locks people out of their own boards."""
		board = self.new_board()
		self.save(board, doc(shape("a"), shape("b")), 1, "save000001")
		frappe.db.set_single_value("Oqiva Settings", "max_objects_per_board", 1)
		self.assertIsNone(document_service.load_document(self.w.member, board)["recovery"])

	def test_get_revision_reports_the_last_save(self):
		"""Success: the revision and save id are available without loading the document."""
		board = self.new_board()
		self.save(board, doc(), 1, "save000001")
		expected = {"revision": 2, "last_save_id": "save000001"}
		self.assertEqual(document_service.get_revision(self.w.member, board), expected)


class TestConcurrentSaves(IntegrationTestCase):
	"""Two people saving at the same moment, each on their own database connection (T5.3).

	The only test that commits. It cleans up after itself, touching only the rows it made.
	"""

	def test_exactly_one_of_two_simultaneous_saves_wins(self):
		world = make_world("cc")
		board = board_service.create_board(world.member, world.workspace, None, "Race")["name"]
		frappe.db.commit()  # nosemgrep -- another connection must be able to see the board
		site, sites_path = frappe.local.site, frappe.local.sites_path
		barrier = threading.Barrier(2)
		outcomes = []

		def attempt(user, raw, save_id):
			frappe.init(site=site, sites_path=sites_path)
			frappe.connect()
			frappe.set_user(user)
			try:
				barrier.wait(10)
				result = document_service.save_document(user, board, raw, 1, save_id)
				frappe.db.commit()  # nosemgrep -- releases the row lock, as a request would
				outcomes.append(("saved", result["revision"]))
			except OqivaStaleRevision:
				frappe.db.rollback()
				outcomes.append(("stale", None))
			finally:
				frappe.destroy()

		try:
			threads = [
				threading.Thread(target=attempt, args=(world.member, doc(shape("one")), "saveAAAAAA1")),
				threading.Thread(target=attempt, args=(world.member2, doc(shape("two")), "saveBBBBBB1")),
			]
			for thread in threads:
				thread.start()
			for thread in threads:
				thread.join(30)
			kinds = sorted(kind for kind, _revision in outcomes)
			self.assertEqual(kinds, ["saved", "stale"], outcomes)
			frappe.db.rollback()  # end this connection's snapshot so it reads what the others committed
			self.assertEqual(frappe.db.get_value("Oqiva Board", board, "revision"), 2)
		finally:
			remove_committed_world(world)


def remove_committed_world(world) -> None:
	"""Delete what ``make_world`` committed, and nothing else.

	Every delete is limited to this world's own workspaces, boards and `@oqiva.test` users.
	"""
	workspaces = [world.workspace, world.other_workspace]
	boards = frappe.get_all("Oqiva Board", filters={"workspace": ["in", workspaces]}, pluck="name")
	if boards:
		frappe.db.delete("DocShare", {"share_doctype": "Oqiva Board", "share_name": ["in", boards]})
		for doctype in ("Oqiva Board View", "Oqiva Favorite"):
			frappe.db.delete(doctype, {"board": ["in", boards]})
		frappe.db.delete("Oqiva Board", {"name": ["in", boards]})
	for doctype in ("Oqiva Project", "Oqiva Workspace Member"):
		frappe.db.delete(doctype, {"workspace": ["in", workspaces]})
	frappe.db.delete("Oqiva Workspace", {"name": ["in", workspaces]})
	for user in world.users.values():
		if user.endswith("@oqiva.test"):
			frappe.delete_doc("User", user, force=True, ignore_permissions=True)
	frappe.db.commit()  # nosemgrep -- clean-up of data this test committed
