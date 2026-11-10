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

Ten runs: `home.e2e.mjs` (the home area), `editor.e2e.mjs` (the canvas editor),
`phase4.e2e.mjs` (lines, palette, clipboard, pictures, tables, export), `phase5.e2e.mjs` (sharing and
links), `collab.e2e.mjs` (three people live; needs the bench's socket server) and
`comments.e2e.mjs` (comments, mentions, notifications), `fixes.e2e.mjs` (hover arrows, shape kinds, toolbar, line types, table borders) `phase6.e2e.mjs` (shape library, notes, frames, icons, links, minimap, templates), `phase7.e2e.mjs` (history, restore, board files) and `phase8.e2e.mjs` (mind maps). `collab` and `comments` need three test users in the
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

On a machine without the browser's system libraries, point `LD_LIBRARY_PATH` at a folder
of extracted packages, and set `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` if Playwright does not
recognise the operating system.
