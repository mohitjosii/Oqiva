"""Pictures, thumbnails, storage quota, the audit log and the export check (T4.x)."""

import base64
import json
import re

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, now_datetime

from oqiva.constants import AUDIT_DOCTYPE, BOARD_DOCTYPE
from oqiva.exceptions import OqivaError, OqivaForbidden, OqivaLimitExceeded, OqivaNotFound
from oqiva.services import audit_service, document_service, export_service, file_service
from oqiva.tests.test_document import doc, shape
from oqiva.tests.utils import RestoresSettings, make_world, share_board

PNG = base64.b64decode(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 40
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def image(object_id, src, **over):
	item = {
		"id": object_id,
		"kind": "image",
		"shape": "rectangle",
		"x": 0,
		"y": 0,
		"w": 100,
		"h": 100,
		"rotation": 0,
		"z": 1,
		"style": {"fill": None, "stroke": None, "strokeWidth": 0, "opacity": 1},
		"text": None,
		"src": src,
		"alt": "",
	}
	item.update(over)
	return item


class FileTestCase(RestoresSettings, IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.w = make_world("files")

	def tearDown(self):
		# Uploaded files also sit on disk, which a database rollback does not remove.
		boards = frappe.get_all(BOARD_DOCTYPE, filters={"workspace": self.w.workspace}, pluck="name")
		for name in frappe.get_all(
			"File",
			filters={"attached_to_doctype": BOARD_DOCTYPE, "attached_to_name": ["in", boards]},
			pluck="name",
		):
			frappe.delete_doc("File", name, ignore_permissions=True, force=True)
		super().tearDown()

	def upload(self, content=PNG, user=None, board=None):
		return file_service.upload_image(user or self.w.member, board or self.w.board, content)


class TestSniffing(IntegrationTestCase):
	def test_recognises_the_four_picture_types_and_nothing_else(self):
		self.assertEqual(file_service.sniff_image(PNG)[1], "image/png")
		self.assertEqual(file_service.sniff_image(JPEG)[1], "image/jpeg")
		self.assertEqual(file_service.sniff_image(b"GIF89a" + b"\x00" * 10)[1], "image/gif")
		self.assertEqual(file_service.sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 ")[1], "image/webp")
		for other in (SVG, b"<html>", b"", b"RIFF\x00\x00\x00\x00WAVEfmt ", b"PK\x03\x04"):
			self.assertIsNone(file_service.sniff_image(other))

	def test_safe_filenames(self):
		self.assertEqual(export_service.safe_filename("Q4 plan: draft/1", "png"), "Q4-plan-draft1.png")
		self.assertEqual(export_service.safe_filename("../../etc/passwd", "pdf"), "etcpasswd.pdf")
		self.assertEqual(export_service.safe_filename("", "svg"), "board.svg")
		self.assertEqual(export_service.safe_filename("Plan", None), "Plan")
		self.assertLessEqual(len(export_service.safe_filename("x" * 500, "png")), 84)


class TestUpload(FileTestCase):
	def test_a_member_adds_a_picture_that_is_private_and_attached_to_the_board(self):
		result = self.upload()
		self.assertRegex(result["src"], r"^/private/files/[0-9a-f]{32}\.png$")
		file = frappe.get_doc("File", result["file"])
		self.assertEqual(file.is_private, 1)
		self.assertEqual((file.attached_to_doctype, file.attached_to_name), (BOARD_DOCTYPE, self.w.board))
		self.assertEqual(file.file_size, len(PNG))
		self.assertEqual(result["content_type"], "image/png")

	def test_the_same_picture_can_be_added_twice_and_shares_one_file_on_disk(self):
		first, second = self.upload(), self.upload()
		self.assertEqual(first["src"], second["src"])  # Frappe stores identical content once
		self.assertNotEqual(first["file"], second["file"])
		self.assertEqual(file_service.storage_used(self.w.workspace), len(PNG) * 2)  # both uploads count

	def test_the_name_the_user_gave_never_reaches_the_disk(self):
		self.assertNotIn("..", self.upload()["src"])

	def test_people_who_may_not_edit_cannot_add(self):
		share_board(self.w.board, self.w.sharee, "view")
		with self.assertRaises(OqivaForbidden):
			self.upload(user=self.w.sharee)
		with self.assertRaises(OqivaNotFound):
			self.upload(user=self.w.outsider)

	def test_refuses_script_carrying_and_other_files_and_records_it(self):
		before = frappe.db.count(AUDIT_DOCTYPE, {"action": "upload.rejected"})
		for bad in (SVG, b"<html><script>", b"MZ\x90\x00"):
			with self.assertRaises(OqivaError):
				self.upload(bad)
		self.assertEqual(frappe.db.count(AUDIT_DOCTYPE, {"action": "upload.rejected"}), before + 3)
		with self.assertRaises(OqivaError):
			self.upload(b"")

	def test_refuses_a_picture_over_the_size_limit(self):
		frappe.db.set_single_value("Oqiva Settings", "upload_max_bytes", len(PNG) - 1)
		with self.assertRaises(OqivaLimitExceeded):
			self.upload()
		frappe.db.set_single_value("Oqiva Settings", "upload_max_bytes", len(PNG))
		self.upload()

	def test_a_workspace_that_is_out_of_storage_cannot_add_more(self):
		self.assertEqual(file_service.storage_used(self.w.workspace), 0)
		frappe.db.set_single_value("Oqiva Settings", "workspace_storage_bytes", len(PNG) * 2)
		self.upload()
		self.upload()
		self.assertEqual(file_service.storage_used(self.w.workspace), len(PNG) * 2)
		with self.assertRaises(OqivaLimitExceeded):
			self.upload()

	def test_storage_is_counted_per_workspace(self):
		self.upload()
		self.assertEqual(file_service.storage_used(self.w.other_workspace), 0)
		self.assertEqual(file_service.storage_used(self.w.workspace), len(PNG))

	def test_deleting_a_file_gives_the_space_back(self):
		result = self.upload()
		frappe.delete_doc("File", result["file"], ignore_permissions=True, force=True)
		self.assertEqual(file_service.storage_used(self.w.workspace), 0)

	def test_who_may_fetch_the_file_follows_who_may_see_the_board(self):
		file = frappe.get_doc("File", self.upload()["file"])
		share_board(self.w.board, self.w.sharee, "view")
		for user, expected in (
			(self.w.member2, True),
			(self.w.guest, False),  # a guest sees only boards shared with them
			(self.w.sharee, True),
			(self.w.outsider, False),
		):
			self.assertEqual(frappe.has_permission("File", "read", doc=file, user=user), expected, user)


class TestPurge(FileTestCase):
	def test_purging_a_board_removes_its_pictures_and_thumbnail_and_gives_the_space_back(self):
		from oqiva.services import board_service

		board = board_service.create_board(self.w.member, self.w.workspace, self.w.project, "To purge")[
			"name"
		]
		picture = file_service.upload_image(self.w.member, board, PNG)
		file_service.save_thumbnail(self.w.member, board, PNG + b"\x00")
		self.assertEqual(frappe.db.count("File", {"attached_to_name": board}), 2)
		board_service.delete_board_records(board)
		self.assertEqual(frappe.db.count("File", {"attached_to_name": board}), 0)
		self.assertFalse(frappe.db.exists("File", picture["file"]))
		self.assertEqual(file_service.storage_used(self.w.workspace), 0)


class TestImagesInDocuments(FileTestCase):
	def save(self, *objects, user=None):
		base = frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "revision")
		return document_service.save_document(user or self.w.member, self.w.board, doc(*objects), base, "s1")

	def test_a_picture_that_was_uploaded_to_this_board_saves(self):
		src = self.upload()["src"]
		self.assertFalse(self.save(image("i1", src))["replayed"])
		stored = json.loads(frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "document"))
		self.assertEqual(stored["objects"][0]["src"], src)

	def test_a_picture_with_no_file_behind_it_is_refused(self):
		with self.assertRaises(OqivaError):
			self.save(image("i1", "/private/files/" + "0" * 32 + ".png"))

	def test_a_picture_may_come_from_another_board_the_user_can_see(self):
		from oqiva.services import board_service

		second = board_service.create_board(self.w.member, self.w.workspace, self.w.project, "Second")["name"]
		src = file_service.upload_image(self.w.member, second, PNG)["src"]
		self.assertFalse(self.save(image("i1", src))["replayed"])

	def test_a_picture_from_a_board_the_user_cannot_see_is_refused(self):
		from oqiva.services import board_service

		hidden = board_service.create_board(self.w.outsider, self.w.other_workspace, None, "Hidden")["name"]
		src = file_service.upload_image(self.w.outsider, hidden, PNG)["src"]
		with self.assertRaises(OqivaError):
			self.save(image("i1", src))

	def test_a_file_that_is_not_attached_to_a_board_is_refused(self):
		stray = frappe.get_doc(
			{"doctype": "File", "file_name": "stray.png", "is_private": 1, "content": PNG}
		).insert(ignore_permissions=True)
		try:
			with self.assertRaises(OqivaError):
				self.save(image("i1", stray.file_url))
		finally:
			frappe.delete_doc("File", stray.name, ignore_permissions=True, force=True)

	def test_a_public_file_is_refused(self):
		with self.assertRaises(OqivaError):
			self.save(image("i1", "/files/anything.png"))


class TestThumbnail(FileTestCase):
	def test_saves_a_thumbnail_and_replaces_the_old_one_with_its_file(self):
		first = file_service.save_thumbnail(self.w.member, self.w.board, PNG)["thumbnail"]
		self.assertEqual(frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "thumbnail"), first)
		second = file_service.save_thumbnail(self.w.member, self.w.board, PNG + b"\x00")["thumbnail"]
		self.assertNotEqual(first, second)
		self.assertFalse(frappe.db.exists("File", {"file_url": first}))
		self.assertTrue(frappe.db.exists("File", {"file_url": second}))
		self.assertEqual(frappe.db.count("File", {"attached_to_name": self.w.board}), 1)

	def test_only_a_small_png_is_accepted(self):
		for bad in (JPEG, SVG, b"", PNG + b"\x00" * (256 * 1024)):
			with self.assertRaises(OqivaError):
				file_service.save_thumbnail(self.w.member, self.w.board, bad)

	def test_people_who_may_not_edit_cannot_set_it(self):
		share_board(self.w.board, self.w.sharee, "view")
		with self.assertRaises(OqivaForbidden):
			file_service.save_thumbnail(self.w.sharee, self.w.board, PNG)

	def test_saving_a_thumbnail_does_not_change_the_boards_modified_time(self):
		before = frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "modified")
		file_service.save_thumbnail(self.w.member, self.w.board, PNG)
		self.assertEqual(frappe.db.get_value(BOARD_DOCTYPE, self.w.board, "modified"), before)


class TestExport(FileTestCase):
	def test_records_an_export_and_names_the_file_safely(self):
		frappe.db.set_value(BOARD_DOCTYPE, self.w.board, "title", "Roadmap: Q4/2026")
		result = export_service.prepare(self.w.member, self.w.board, "png", "selection")
		self.assertEqual(result, {"filename": "Roadmap-Q42026.png", "format": "png", "scope": "selection"})
		entry = frappe.get_all(
			AUDIT_DOCTYPE,
			filters={"action": "export", "resource_name": self.w.board},
			fields=["user", "resource_type", "metadata"],
		)[-1]
		self.assertEqual((entry.user, entry.resource_type), (self.w.member, BOARD_DOCTYPE))
		self.assertEqual(json.loads(entry.metadata), {"format": "png", "scope": "selection"})

	def test_print_has_no_file_extension_and_jpeg_is_jpg(self):
		self.assertTrue(
			re.fullmatch(r"[\w-]+", export_service.prepare(self.w.member, self.w.board, "print")["filename"])
		)
		self.assertTrue(
			export_service.prepare(self.w.member, self.w.board, "jpeg")["filename"].endswith(".jpg")
		)

	def test_refuses_unknown_formats_and_scopes(self):
		for fmt, scope in (("exe", "board"), ("png", "everything"), ("", "board")):
			with self.assertRaises(OqivaError):
				export_service.prepare(self.w.member, self.w.board, fmt, scope)

	def test_a_guest_without_a_share_may_not_export(self):
		with self.assertRaises(OqivaNotFound):
			export_service.prepare(self.w.outsider, self.w.board, "png")
		with self.assertRaises(OqivaNotFound):  # a guest cannot even tell the board exists
			export_service.prepare(self.w.guest, self.w.board, "png")
		share_board(self.w.board, self.w.guest, "view")
		self.assertEqual(export_service.prepare(self.w.guest, self.w.board, "png")["format"], "png")

	def test_the_endpoint_is_limited_to_twenty_a_minute_per_user(self):
		from oqiva.api import export as export_api

		frappe.cache.delete_keys("rl:oqiva.api.export")
		frappe.local.request = frappe._dict(method="POST")
		frappe.set_user(self.w.member)
		try:
			for _ in range(20):
				export_api.prepare(self.w.board, "png")
			with self.assertRaises(frappe.RateLimitExceededError):
				export_api.prepare(self.w.board, "png")
		finally:
			frappe.set_user("Administrator")
			frappe.local.request = None
			frappe.cache.delete_keys("rl:oqiva.api.export")


class TestAuditLog(IntegrationTestCase):
	def test_cannot_be_written_outside_a_service(self):
		entry = frappe.get_doc({"doctype": AUDIT_DOCTYPE, "action": "x"})
		with self.assertRaises(OqivaForbidden):
			entry.insert(ignore_permissions=True)

	def test_old_entries_are_pruned_and_recent_ones_stay(self):
		audit_service.record("test.old", "Administrator", metadata={"n": 1})
		audit_service.record("test.new", "Administrator")
		old = frappe.get_all(AUDIT_DOCTYPE, filters={"action": "test.old"}, pluck="name")
		frappe.db.set_value(
			AUDIT_DOCTYPE, old[0], "creation", add_days(now_datetime(), -400), update_modified=False
		)
		audit_service.prune_audit_log()
		self.assertFalse(frappe.db.exists(AUDIT_DOCTYPE, old[0]))
		self.assertTrue(frappe.db.exists(AUDIT_DOCTYPE, {"action": "test.new"}))
		frappe.db.delete(AUDIT_DOCTYPE, {"action": ["in", ["test.new", "test.old"]]})

	def test_a_failed_write_does_not_raise(self):
		audit_service.record("x" * 500, "Administrator")  # too long for the field
