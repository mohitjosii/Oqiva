# Oqiva end-to-end checks

Browser checks that drive the real app against a running bench. They are not part of
`bench run-tests`; run them by hand before a release or when the UI changes.

## Setup

```bash
cd apps/oqiva/e2e && yarn install
npx playwright-core install chromium   # once
```

Create two throwaway users on a development site (never on a production site) and put
their credentials in a JSON file:

```json
{ "a": { "user": "e2e_a@example.com", "password": "..." },
  "b": { "user": "e2e_b@example.com", "password": "..." },
  "c": { "user": "e2e_c@example.com", "password": "..." } }
```

## Run

Seventeen runs: `home.e2e.mjs` (the home area), `editor.e2e.mjs` (the canvas editor),
`phase4.e2e.mjs` (lines, palette, clipboard, pictures, tables, export), `phase5.e2e.mjs` (sharing and
links), `collab.e2e.mjs` (three people live; needs the bench's socket server) and
`comments.e2e.mjs` (comments, mentions, notifications), `fixes.e2e.mjs` (hover arrows, shape kinds, toolbar, line types, table borders) `phase6.e2e.mjs` (shape library, notes, frames, icons, links, minimap, templates), `phase7.e2e.mjs` (history, restore, board files) `phase8.e2e.mjs` (mind maps) `phase9.e2e.mjs` (flowcharts) and `phase10.e2e.mjs` (whiteboard: pen, eraser, laser, sketch style) `ux.e2e.mjs` (phone drawer, first-board tips, minimap, marquee, a two-finger pinch and a shared laser) and `journeys.e2e.mjs` (journey A: a new person from the welcome page to the Trash and back; journeys B, C and D are in `phase5` and `collab`), `a11y.e2e.mjs` (accessibility rules: names, labels, focus, dialogs, contrast, target size, 320 px) and `perf.e2e.mjs` (3,000 shapes, a 600-node mind map, ten people editing; needs ten users numbered "1" to "10" in the credentials file; prints measurements) and `phase12.e2e.mjs` (Create with AI: the real server's "not enabled" answer, then the three AI endpoints answered by the test so no provider key or worker is needed: waiting, drawing as one undo step, placement, saving, failures, cancel, phone width). `collab` and `comments` need three test users in the
credentials file (`a`, `b`, `c`). Use a fresh pair of
throwaway users when you can: each run creates a workspace, and the workspace menu grows with
every one. `png.mjs` makes the small pictures the runs upload.

```bash
OQIVA_E2E_CREDS=/path/to/creds.json node home.e2e.mjs
```

| Variable | Default | Meaning |
|---|---|---|
| `OQIVA_E2E_URL` | `http://127.0.0.1` | Where the site is served |
| `OQIVA_E2E_SITE` | `frappe.com` | Sent as `X-Frappe-Site-Name` so the right site answers |
| `OQIVA_E2E_SHOTS` | none | A folder; screenshots are written there when set |

The page must be opened with a port in its address (`OQIVA_E2E_URL=http://127.0.0.1:8001`, from `bench serve --port 8001`): the
socket client picks `https` when the address has no port (so on port 80 live editing and comments fail with a
connection refused), and the bench's gunicorn on port 8000 does not serve the app's assets. Use fresh test
users for `comments` (earlier runs leave notifications that the bell step counts).

On a machine without the browser's system libraries, point `LD_LIBRARY_PATH` at a folder
of extracted packages, and set `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` if Playwright does not
recognise the operating system.
