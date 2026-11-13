"""How long the server takes with a board at the default size limit (Phase 13, P13.02). It prints what it
measured and fails only when something is many times slower than when this was written."""

import json
import time

import frappe
from frappe.tests import IntegrationTestCase

from oqiva.api import board as board_api
from oqiva.tests.utils import make_world


def big_document(shapes: int) -> str:
	objects = [
		{
			"id": f"s{i}",
			"kind": "shape",
			"shape": "rectangle",
			"x": (i % 60) * 190,
			"y": (i // 60) * 120,
			"w": 160,
			"h": 90,
			"rotation": 0,
			"z": i + 1,
			"style": {
				"fill": "#DBEAFE",
				"stroke": "#2563EB",
				"strokeWidth": 2,
				"dash": "solid",
				"opacity": 1,
				"radius": 8,
			},
			"text": {
				"align": "center",
				"size": 16,
				"color": "#1E293B",
				"paragraphs": [{"runs": [{"t": f"Shape number {i}"}]}],
			},
		}
		for i in range(shapes)
	]
	return json.dumps(
		{
			"schemaVersion": 1,
			"canvas": {"mode": "infinite", "background": None, "grid": "off"},
			"theme": {"preset": "ocean"},
			"objects": objects,
			"connectors": [],
			"mindmaps": [],
			"flowcharts": [],
		}
	)


def timed(label: str, work):
	start = time.perf_counter()
	result = work()
	took = (time.perf_counter() - start) * 1000
	print(f"  {label}: {took:.0f} ms")
	return result, took


class TestABoardAtTheLimit(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		self.w = make_world("perf")
		frappe.set_user(self.w.member)

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def test_saving_and_opening_3000_shapes(self):
		"""Boundary: a board with the default maximum of 3,000 shapes saves and opens quickly."""
		document = big_document(3000)
		print(f"\n  document size: {len(document) / 1024:.0f} KB")
		revision = board_api.load_document(self.w.board)["revision"]
		saved, took = timed(
			"save 3000 shapes (check, write, version, audit)",
			lambda: board_api.save_document(self.w.board, document, revision, "perf-1"),
		)
		self.assertLess(took, 3000)
		opened, took = timed("open it", lambda: board_api.load_document(self.w.board))
		self.assertLess(took, 1500)
		self.assertEqual(len(json.loads(opened["document"])["objects"]), 3000)
		_, took = timed(
			"save it again, one change",
			lambda: board_api.save_document(
				self.w.board,
				document.replace("Shape number 0", "Shape number zero"),
				saved["revision"],
				"perf-2",
			),
		)
		self.assertLess(took, 3000)
		_, took = timed("list the workspace's boards", lambda: board_api.list_boards("all", self.w.workspace))
		self.assertLess(took, 1000)
