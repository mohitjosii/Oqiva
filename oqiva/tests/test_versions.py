"""Version history (T8.5), and the .oqiva.json export and import (T7.4)."""

import json

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from oqiva.constants import BOARD_DOCTYPE
from oqiva.exceptions import (
	OqivaConflict,
	OqivaDocumentTooNew,
	OqivaError,
	OqivaForbidden,
	OqivaLimitExceeded,
	OqivaNotFound,
)
from oqiva.services import board_service, document_service, export_service, version_service
from oqiva.tests.test_document import connector, doc, shape
from oqiva.tests.utils import RestoresSettings, make_user, make_world, share_board

V = version_service.VERSION_DOCTYPE


def save(world, user, *objects, **kw):
	"""Save a document as ``user`` and return the new revision."""
	revision = frappe.db.get_value(BOARD_DOCTYPE, world.board, "revision")
	return document_service.save_document(
		user, world.board, doc(*objects, **kw), revision, frappe.generate_hash(length=10)
	)["revision"]


def numbers(board, **filters):
	return frappe.get_all(
		V, filters={"board": board, **filters}, pluck="version_number", order_by="version_number"
	)


class TestAutoVersions(RestoresSettings, IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("va")

	def setUp(self):
		super().setUp()
		frappe.db.delete(V, {"board": self.w.board})
		frappe.cache.delete_value(f"oqiva:pruned:{self.w.board}")

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def test_the_first_save_takes_a_version_and_a_quick_second_one_does_not(self):
		"""Success: an Auto version is written inside the save, then none until the interval has passed."""
		save(self.w, self.w.member, shape("a"))
		self.assertEqual(numbers(self.w.board, kind="Auto"), [1])
		save(self.w, self.w.member, shape("a"), shape("b", x=300))
		self.assertEqual(numbers(self.w.board), [1])

	def test_after_the_interval_a_new_version_is_taken_with_the_next_number(self):
		"""Success: ten minutes on, the next save is kept as version 2."""
		save(self.w, self.w.member, shape("a"))
		first = frappe.db.get_value(V, {"board": self.w.board}, "name")
		frappe.db.set_value(
			V, first, "creation", add_to_date(now_datetime(), minutes=-30), update_modified=False
		)
		save(self.w, self.w.member, shape("a"), shape("b", x=300))
		self.assertEqual(numbers(self.w.board), [1, 2])
		newest = frappe.db.get_value(
			V, {"board": self.w.board, "version_number": 2}, ["object_count", "created_by_user"], as_dict=True
		)
		self.assertEqual((newest.object_count, newest.created_by_user), (2, self.w.member))

	def test_a_save_that_changes_nothing_is_not_kept_again(self):
		"""Boundary: identical content to the newest version is not stored twice."""
		save(self.w, self.w.member, shape("a"))
		first = frappe.db.get_value(V, {"board": self.w.board}, "name")
		frappe.db.set_value(
			V, first, "creation", add_to_date(now_datetime(), minutes=-30), update_modified=False
		)
		revision = frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "revision")
		document_service.save_document(
			self.w.member, self.w.board, doc(shape("a")), revision, frappe.generate_hash(length=10)
		)
		self.assertEqual(numbers(self.w.board), [1])

	def test_the_interval_setting_is_used(self):
		"""Success: a one-minute interval keeps a version after two minutes, a long one does not."""
		frappe.db.set_single_value("Oqiva Settings", "auto_version_interval_min", 1)
		save(self.w, self.w.member, shape("a"))
		first = frappe.db.get_value(V, {"board": self.w.board}, "name")
		frappe.db.set_value(
			V, first, "creation", add_to_date(now_datetime(), minutes=-2), update_modified=False
		)
		save(self.w, self.w.member, shape("a"), shape("b", x=300))
		self.assertEqual(numbers(self.w.board), [1, 2])


class TestRetention(RestoresSettings, IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("vr")

	def setUp(self):
		super().setUp()
		frappe.db.delete(V, {"board": self.w.board})
		frappe.cache.delete_value(f"oqiva:pruned:{self.w.board}")

	def add(self, kind="Auto", label=None, pinned=0):
		number = version_service._insert(self.w.board, kind, doc(shape("a")), 1, 1, 1, self.w.member, label)
		if pinned:
			frappe.db.set_value(V, {"board": self.w.board, "version_number": number}, "pinned", 1)
		return number

	def test_after_sixty_automatic_versions_fifty_remain_and_named_and_pinned_survive(self):
		"""T8.5: the newest 50 automatic versions stay; Named and pinned ones never go."""
		named = self.add("Named", "Release 1")
		pinned = self.add("Auto", pinned=1)
		for _i in range(60):
			self.add("Auto")
		removed = version_service.prune(self.w.board)
		autos = numbers(self.w.board, kind="Auto", pinned=0)
		self.assertEqual(len(autos), 50)
		self.assertEqual(removed, 10)
		self.assertEqual(autos[-1], named + 61)  # the newest is kept
		self.assertIn(named, numbers(self.w.board, kind="Named"))
		self.assertIn(pinned, numbers(self.w.board, pinned=1))

	def test_the_retention_setting_is_used_and_pre_restore_counts_as_automatic(self):
		"""Success: with a retention of 3 the newest three automatic ones stay."""
		frappe.db.set_single_value("Oqiva Settings", "version_retention", 3)
		for _i in range(4):
			self.add("Auto")
		self.add("Pre-restore")
		self.add("Pre-restore")
		version_service.prune(self.w.board)
		self.assertEqual(len(numbers(self.w.board)), 3)

	def test_the_hourly_job_prunes_only_boards_over_the_limit(self):
		"""Success: prune_all trims a board over the limit and leaves a small one alone."""
		frappe.db.set_single_value("Oqiva Settings", "version_retention", 5)
		for _i in range(8):
			self.add("Auto")
		small = board_service.create_board(self.w.member, self.w.workspace, None, "Small")["name"]
		version_service._insert(small, "Auto", doc(), 1, 1, 0, self.w.member)
		version_service.prune_all()
		self.assertEqual(len(numbers(self.w.board)), 5)
		self.assertEqual(len(numbers(small)), 1)

	def test_taking_a_version_prunes_at_most_once_an_hour(self):
		"""Boundary: the prune that follows a version is rate limited by a cache key."""
		frappe.db.set_single_value("Oqiva Settings", "version_retention", 2)
		for _i in range(5):
			self.add("Auto")
		version_service._prune_if_due(self.w.board)
		self.assertEqual(len(numbers(self.w.board)), 2)
		self.add("Auto")
		version_service._prune_if_due(self.w.board)
		self.assertEqual(len(numbers(self.w.board)), 3)  # not pruned again within the hour


class TestVersionApi(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("vp")
		share_board(cls.w.board, cls.w.sharee, "view")

	def setUp(self):
		super().setUp()
		frappe.db.delete(V, {"board": self.w.board})
		save(self.w, self.w.member, shape("a"))

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def test_anyone_who_may_view_can_list_but_only_editors_can_open_one(self):
		"""Failure and success: list needs view, preview and restore need edit; an outsider sees nothing."""
		listed = version_service.list_versions(self.w.sharee, self.w.board)["versions"]
		self.assertEqual(listed[0]["version_number"], 1)
		self.assertNotIn("document", listed[0])
		self.assertEqual(listed[0]["by"]["name"], self.w.member)
		with self.assertRaises(OqivaForbidden):
			version_service.get_version(self.w.sharee, self.w.board, 1)
		with self.assertRaises(OqivaForbidden):
			version_service.begin_restore(self.w.sharee, self.w.board, 1)
		with self.assertRaises(OqivaNotFound):
			version_service.list_versions(self.w.outsider, self.w.board)
		with self.assertRaises(OqivaNotFound):
			version_service.get_version(self.w.outsider, self.w.board, 1)
		opened = version_service.get_version(self.w.member, self.w.board, 1)
		self.assertEqual(json.loads(opened["document"])["objects"][0]["id"], "a")

	def test_a_user_with_the_role_cannot_read_the_version_table_directly(self):
		"""Failure: old content is reachable only through the service's rules."""
		frappe.set_user(self.w.sharee)
		with self.assertRaises(frappe.PermissionError):
			frappe.get_list(V, filters={"board": self.w.board})
		with self.assertRaises(frappe.PermissionError):
			frappe.get_doc(V, frappe.db.get_value(V, {"board": self.w.board}, "name")).check_permission(
				"read"
			)

	def test_writes_outside_the_service_are_refused(self):
		"""Failure: the table can only be changed by the service."""
		frappe.set_user(self.w.member)
		with self.assertRaises(frappe.PermissionError):
			frappe.get_doc(
				{"doctype": V, "board": self.w.board, "version_number": 99, "kind": "Auto"}
			).insert()

	def test_save_version_names_the_current_content(self):
		"""Success: a named version holds what is saved now, with its label."""
		save(self.w, self.w.member, shape("a"), shape("b", x=300))
		made = version_service.save_named(self.w.member, self.w.board, "  Before the demo ")
		row = frappe.db.get_value(
			V,
			{"board": self.w.board, "version_number": made["version_number"]},
			["kind", "label", "object_count"],
			as_dict=True,
		)
		self.assertEqual((row.kind, row.label, row.object_count), ("Named", "Before the demo", 2))

	def test_save_version_checks_who_and_the_name(self):
		"""Failure: viewers cannot, a blank or huge name is refused, and a board holds a limited number."""
		with self.assertRaises(OqivaForbidden):
			version_service.save_named(self.w.sharee, self.w.board, "x")
		for bad in ("", "   ", "x" * 500):
			with self.assertRaises(OqivaError):
				version_service.save_named(self.w.member, self.w.board, bad)
		original = version_service.MAX_KEPT
		version_service.MAX_KEPT = 2
		self.addCleanup(setattr, version_service, "MAX_KEPT", original)
		version_service.save_named(self.w.member, self.w.board, "one")
		version_service.save_named(self.w.member, self.w.board, "two")
		with self.assertRaises(OqivaLimitExceeded):
			version_service.save_named(self.w.member, self.w.board, "three")

	def test_naming_an_automatic_version_keeps_it_and_pinning_works(self):
		"""Success: labelling promotes Auto to Named; pin and unpin flip the flag."""
		version_service.set_label(self.w.member, self.w.board, 1, "Good one")
		row = frappe.db.get_value(
			V, {"board": self.w.board, "version_number": 1}, ["kind", "label"], as_dict=True
		)
		self.assertEqual((row.kind, row.label), ("Named", "Good one"))
		self.assertTrue(version_service.set_pinned(self.w.member, self.w.board, 1, True)["pinned"])
		self.assertFalse(version_service.set_pinned(self.w.member, self.w.board, 1, False)["pinned"])
		with self.assertRaises(OqivaForbidden):
			version_service.set_pinned(self.w.sharee, self.w.board, 1, True)
		with self.assertRaises(OqivaNotFound):
			version_service.set_label(self.w.member, self.w.board, 99, "x")

	def test_begin_restore_keeps_the_current_board_and_returns_the_old_content(self):
		"""Success: a Pre-restore version of what is stored now is written first (restore can be undone)."""
		save(self.w, self.w.member, shape("a"), shape("b", x=300))
		result = version_service.begin_restore(self.w.member, self.w.board, 1)
		self.assertEqual([o["id"] for o in json.loads(result["document"])["objects"]], ["a"])
		pre = frappe.db.get_value(
			V,
			{"board": self.w.board, "version_number": result["pre_restore"]},
			["kind", "label", "object_count"],
			as_dict=True,
		)
		self.assertEqual((pre.kind, pre.object_count), ("Pre-restore", 2))
		self.assertIn("version 1", pre.label)
		# the server's own document was not touched
		stored = json.loads(frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "document"))
		self.assertEqual(len(stored["objects"]), 2)

	def test_a_version_this_app_cannot_read_is_not_offered_for_restore(self):
		"""Failure: a version from a newer format is refused, not applied."""
		frappe.db.set_value(
			V, {"board": self.w.board, "version_number": 1}, "document", json.dumps({"schemaVersion": 99})
		)
		with self.assertRaises(OqivaConflict):
			version_service.begin_restore(self.w.member, self.w.board, 1)

	def test_a_board_that_cannot_open_can_be_restored_on_the_server(self):
		"""Success: with unreadable stored content there is no live room, so the server restores."""
		frappe.db.set_value(
			BOARD_DOCTYPE, self.w.board, {"document": json.dumps({"schemaVersion": 99}), "crdt_state": "AAAA"}
		)
		result = version_service.restore_unopenable(self.w.member, self.w.board, 1)
		stored = frappe.db.get_value(
			BOARD_DOCTYPE, self.w.board, ["document", "crdt_state", "revision", "object_count"], as_dict=True
		)
		self.assertEqual(json.loads(stored.document)["objects"][0]["id"], "a")
		self.assertEqual((stored.crdt_state, stored.object_count), ("", 1))
		self.assertEqual(stored.revision, result["revision"])

	def test_a_board_that_opens_is_not_restored_behind_the_editors_back(self):
		"""Failure: the server-side restore is refused when the board opens normally."""
		with self.assertRaises(OqivaConflict):
			version_service.restore_unopenable(self.w.member, self.w.board, 1)
		with self.assertRaises(OqivaForbidden):
			frappe.db.set_value(BOARD_DOCTYPE, self.w.board, "document", "[]")
			version_service.restore_unopenable(self.w.sharee, self.w.board, 1)

	def test_purging_a_board_removes_its_versions(self):
		"""Success: no version outlives its board."""
		board = board_service.create_board(self.w.member, self.w.workspace, None, "Short lived")["name"]
		version_service._insert(board, "Named", doc(), 1, 1, 0, self.w.member, "x")
		self.assertEqual(frappe.db.count(V, {"board": board}), 1)
		board_service.delete_board_records(board)
		self.assertEqual(frappe.db.count(V, {"board": board}), 0)


class TestNewKindsAreValidated(IntegrationTestCase):
	"""The objects Phase 6 added are checked on the server like the older ones."""

	def parse(self, *objects):
		return document_service.parse_document(doc(*objects))

	def test_accepts_notes_icons_frames_and_links(self):
		note = shape("n1", kind="note", style={"fill": "#FEF08A"})
		icon = shape("i1", kind="icon", icon="server", text=None)
		emoji = shape("i2", kind="icon", emoji="🚀", text=None)
		frame = shape("f1", kind="frame", name="Plan", text=None)
		linked = shape("l1", link={"url": "https://example.com/x"})
		boardlink = shape("l2", link={"board": "abc123", "title": "Other"})
		self.assertEqual(self.parse(note, icon, emoji, frame, linked, boardlink)[1], 6)

	def test_refuses_bad_links_icons_and_frame_names(self):
		for bad in (
			shape("a", link={"url": "javascript:alert(1)"}),
			shape("a", link={"url": "data:text/html,x"}),
			shape("a", link={"url": "https://a.com/<b>"}),
			shape("a", link={"board": "../x"}),
			shape("a", link="https://example.com"),
			shape("a", kind="icon", text=None),
			shape("a", kind="icon", icon="../../x", text=None),
			shape("a", kind="icon", emoji="<img>", text=None),
			shape("a", kind="frame", name="x" * 300, text=None),
		):
			with self.assertRaises(OqivaError, msg=str(bad)):
				self.parse(bad)


class TestExportImport(RestoresSettings, IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = make_world("vx")
		share_board(cls.w.board, cls.w.sharee, "view")

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def put(self, *objects, **kw):
		save(self.w, self.w.member, *objects, **kw)

	def file(self, document=None, **over):
		body = {"format": "oqiva-board", "formatVersion": 1, "schemaVersion": 1, "title": "From file"}
		body["document"] = json.loads(document or doc(shape("a")))
		body.update(over)
		return json.dumps(body)

	def test_export_then_import_makes_an_equal_independent_board(self):
		"""Success: the exported file imports as a new board with the same content."""
		self.put(
			shape("a"), shape("b", x=300), connectors=[connector("c1", to={"objectId": "b", "anchor": "w"})]
		)
		exported = export_service.board_file(self.w.member, self.w.board)
		self.assertTrue(exported["filename"].endswith(".oqiva.json"))
		made = board_service.import_board(self.w.member, self.w.workspace, None, exported["content"])
		self.assertNotEqual(made["name"], self.w.board)
		self.assertEqual(made["title"], "Roadmap")
		original = json.loads(frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "document"))
		copy = json.loads(frappe.db.get_value(BOARD_DOCTYPE, made["name"], "document"))
		self.assertEqual([o["id"] for o in copy["objects"]], [o["id"] for o in original["objects"]])
		self.assertEqual(len(copy["connectors"]), 1)
		stored = frappe.db.get_value(
			BOARD_DOCTYPE,
			made["name"],
			["object_count", "revision", "crdt_state", "created_by_user"],
			as_dict=True,
		)
		self.assertEqual((stored.object_count, stored.revision, stored.crdt_state or ""), (3, 1, ""))

	def test_export_leaves_out_comments_shares_and_collaboration_state(self):
		"""Success: the file holds the document and a small header, nothing else."""
		self.put(shape("a"))
		data = json.loads(export_service.board_file(self.w.member, self.w.board)["content"])
		self.assertEqual(
			set(data), {"format", "formatVersion", "schemaVersion", "title", "exportedOn", "document"}
		)

	def test_export_needs_view_access(self):
		"""Failure: an outsider gets not-found; a viewer may export."""
		with self.assertRaises(OqivaNotFound):
			export_service.board_file(self.w.outsider, self.w.board)
		self.assertTrue(export_service.board_file(self.w.sharee, self.w.board)["content"])

	def test_pictures_are_left_out_with_their_lines_and_counted(self):
		"""Success: a picture lives in another board's files, so it is not imported, and neither are its lines."""
		picture = shape("p", kind="image", src="/private/files/x.png", text=None)
		document = doc(
			shape("a"),
			picture,
			connectors=[connector("c1", to={"objectId": "p", "anchor": "w"}), connector("c2")],
		)
		made = board_service.import_board(self.w.member, self.w.workspace, None, self.file(document))
		self.assertEqual(made["dropped_pictures"], 1)
		stored = json.loads(frappe.db.get_value(BOARD_DOCTYPE, made["name"], "document"))
		self.assertEqual([o["id"] for o in stored["objects"]], ["a"])
		self.assertEqual([c["id"] for c in stored["connectors"]], ["c2"])

	def test_files_that_are_not_ours_are_refused(self):
		"""T7.4: unknown format, a newer format or schema, broken JSON, no document, oversize."""
		oversize = self.file(
			doc(
				shape(
					"a",
					text={
						"align": "left",
						"size": 10,
						"color": "#000000",
						"paragraphs": [{"runs": [{"t": "x" * 9000}]}],
					},
				)
			)
		)
		cases = [
			("", OqivaError),
			("not json", OqivaError),
			("[]", OqivaError),
			(self.file(format="svg"), OqivaError),
			(self.file(formatVersion=0), OqivaError),
			(self.file(formatVersion="1"), OqivaError),
			(self.file(formatVersion=2), OqivaDocumentTooNew),
			(json.dumps({"format": "oqiva-board", "formatVersion": 1, "document": "x"}), OqivaError),
			(self.file(doc(schemaVersion=99)), OqivaDocumentTooNew),
		]
		for content, error in cases:
			with self.assertRaises(error, msg=content[:60]):
				board_service.import_board(self.w.member, self.w.workspace, None, content)
		frappe.db.set_single_value("Oqiva Settings", "max_document_bytes", 1000)
		with self.assertRaises(OqivaLimitExceeded):
			board_service.import_board(self.w.member, self.w.workspace, None, oversize)

	def test_an_imported_document_is_checked_like_a_save(self):
		"""T7.4: a script link or an invalid colour is refused, nothing runs from the text fields."""
		for bad in (shape("a", link={"url": "javascript:alert(1)"}), shape("a", style={"fill": "url(#x)"})):
			with self.assertRaises(OqivaError):
				board_service.import_board(self.w.member, self.w.workspace, None, self.file(doc(bad)))

	def test_the_object_limit_applies_to_an_import(self):
		"""Failure: a file with more objects than a board may hold is refused."""
		frappe.db.set_single_value("Oqiva Settings", "max_objects_per_board", 1)
		with self.assertRaises(OqivaLimitExceeded):
			board_service.import_board(
				self.w.member, self.w.workspace, None, self.file(doc(shape("a"), shape("b")))
			)

	def test_who_may_import_and_where(self):
		"""Failure: a guest, an outsider, or a project from another workspace is refused; a title can be chosen."""
		with self.assertRaises(OqivaForbidden):
			board_service.import_board(self.w.guest, self.w.workspace, None, self.file())
		with self.assertRaises((OqivaForbidden, OqivaNotFound)):
			board_service.import_board(self.w.outsider, self.w.workspace, None, self.file())
		other = make_world("vy")
		with self.assertRaises(OqivaError):
			board_service.import_board(self.w.member, self.w.workspace, other.project, self.file())
		made = board_service.import_board(
			self.w.member, self.w.workspace, self.w.project, self.file(), "My title"
		)
		self.assertEqual((made["title"], made["project"]), ("My title", self.w.project))

	def test_the_workspace_board_limit_applies(self):
		"""Failure: importing counts against the board limit."""
		frappe.db.set_single_value("Oqiva Settings", "max_boards_per_workspace", 1)
		with self.assertRaises(OqivaLimitExceeded):
			board_service.import_board(self.w.member, self.w.workspace, None, self.file())
