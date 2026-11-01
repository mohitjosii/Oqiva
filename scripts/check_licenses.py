#!/usr/bin/env python3
"""Fail if a shipped frontend dependency has a licence outside the allow-list.

Oqiva is MIT-licensed (ADR-002), so every dependency that ends up in the build must be
MIT-compatible (ADR-008). A copyleft licence needs its own decision record first.
Run from anywhere: ``python3 scripts/check_licenses.py``.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ALLOWED = {
	"MIT",
	"MIT-0",
	"ISC",
	"Apache-2.0",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"0BSD",
	"BlueOak-1.0.0",
	"CC0-1.0",
	"Unlicense",
	"Python-2.0",
}
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


def acceptable(expression: str) -> bool:
	"""Whether an SPDX expression may be used: any OR branch, every AND branch."""
	text = expression.strip().strip("()")
	if " OR " in text:
		return any(acceptable(part) for part in re.split(r"\s+OR\s+", text))
	if " AND " in text:
		return all(acceptable(part) for part in re.split(r"\s+AND\s+", text))
	return text in ALLOWED


def shipped_packages() -> list[tuple[str, str, str]]:
	"""(name, version, licence) for every production dependency of the frontend."""
	result = subprocess.run(
		["yarn", "--silent", "licenses", "list", "--prod", "--json"],
		cwd=FRONTEND,
		capture_output=True,
		text=True,
		check=True,
	)
	for line in result.stdout.splitlines():
		try:
			item = json.loads(line)
		except json.JSONDecodeError:
			continue
		if item.get("type") == "table":
			head = item["data"]["head"]
			columns = [head.index(name) for name in ("Name", "Version", "License")]
			return [tuple(row[i] for i in columns) for row in item["data"]["body"]]
	raise SystemExit("yarn printed no licence table. Run `yarn install` in frontend/ first.")


def main() -> int:
	packages = shipped_packages()
	rejected = [p for p in packages if not acceptable(p[2])]
	print(f"Checked {len(packages)} shipped packages against the MIT-compatible allow-list.")
	for name, version, licence in rejected:
		print(f"  NOT ALLOWED  {name}@{version}  {licence}")
	if rejected:
		print("Replace the package, or record an ADR before adding a copyleft dependency.")
	return 1 if rejected else 0


if __name__ == "__main__":
	sys.exit(main())
