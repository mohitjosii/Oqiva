# Oqiva

A shared visual workspace for diagrams, flows and ideas, built as a Frappe app. Teams
organise boards into projects inside workspaces, share them with the right level of
access, and (from Phase 3) draw on an infinite canvas together.

**Status:** Phases 1 to 3 are built: workspaces, members and invites, projects, the
board list and lifecycle, favorites, recents, search, the permission model, and the
canvas editor core (shapes, selection, move, resize, rotate, text, undo and redo, zoom
and pan, grid and page sizes, autosave). Connectors, the right-hand palette, export,
sharing, comments and realtime arrive in later phases. See `docs/DEVELOPMENT_PLAN.md`.

## Install

```bash
bench get-app oqiva /path/to/oqiva          # or the git URL
bench --site your-site install-app oqiva
bench build --app oqiva                      # builds the SPA in frontend/
```

Open `/oqiva`. The first visit creates your personal workspace.

## Develop

```bash
# backend tests (need allow_tests in the site config)
bench --site your-site run-tests --app oqiva

# frontend
cd frontend
yarn install
yarn dev        # hot reload, proxied to the bench
yarn test
yarn build      # writes oqiva/public/frontend and oqiva/www/oqiva.html

# lint and the dependency licence check
ruff check oqiva && ruff format --check oqiva
python3 scripts/check_licenses.py
```

Browser checks live in `e2e/` (see its README): `home.e2e.mjs` walks the home area and
`editor.e2e.mjs` drives the canvas. Spikes that settled early risks live
in `spikes/`.

## Layout

| Path | What it holds |
|---|---|
| `oqiva/access/` | Who the caller is to a record (`resolve.py`), the rules table (`rules.py`), Frappe permission hooks, and the service-write guard |
| `oqiva/services/` | Business logic. Every write is checked here, then made |
| `oqiva/api/` | Thin whitelisted endpoints. Every endpoint that changes state is POST only |
| `oqiva/oqiva/doctype/` | The DocTypes |
| `realtime/handlers.js` | The relay that Frappe's socket server loads for live editing |
| `frontend/` | The Vue 3 and frappe-ui single-page app |
| `docs/` | Architecture, decisions, the Draw feature reference, the development plan, the security test plan |

## Licence

MIT. See `license.txt`.
