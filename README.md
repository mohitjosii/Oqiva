# Oqiva

A shared visual workspace for diagrams, flows and ideas, built as a Frappe app. Teams
organise boards into projects inside workspaces, share them with the right level of
access, and draw on an infinite canvas together.

**Status:** version 1.1 is feature-complete (Phases 1 to 10, 12 and 13; Phase 11, in-app feedback and an
admin console, was built and set aside). It has workspaces, projects and boards; a canvas editor with shapes,
connectors, mind maps, flowcharts and a whiteboard; live editing; sharing and links; comments; version
history; export and import; about forty templates; and AI diagram generation (off by default). See
the release notes for what it does and what is known not to work yet.

## Documentation
The documentation (user guide, admin guide, deployment, release notes, architecture, decisions, security test
plan, performance and the development plan) is kept outside this repository, in the bench's `docs/` folder.
The user guide is also on the Oqiva website.

## Install

```bash
bench get-app https://github.com/mohitjosii/Oqiva.git --branch version-16
bench --site your-site install-app oqiva
bench build --app oqiva                      # builds the SPA in frontend/
bench --site your-site migrate
# live editing needs the bench's socket server and AI diagrams need a worker: bench start, or supervisor
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

Browser checks live in `e2e/` (see its README): seventeen runs from `home.e2e.mjs` to `journeys.e2e.mjs`, plus
`a11y.e2e.mjs` (accessibility rules) and `perf.e2e.mjs` (3,000 shapes, a 600-node map, ten editors). Spikes
that settled early risks live in `spikes/`.

## Layout

| Path | What it holds |
|---|---|
| `oqiva/access/` | Who the caller is to a record (`resolve.py`), the rules table (`rules.py`), Frappe permission hooks, and the service-write guard |
| `oqiva/services/` | Business logic. Every write is checked here, then made |
| `oqiva/api/` | Thin whitelisted endpoints. Every endpoint that changes state is POST only |
| `oqiva/oqiva/doctype/` | The DocTypes |
| `realtime/handlers.js` | The relay that Frappe's socket server loads for live editing |
| `frontend/` | The Vue 3 and frappe-ui single-page app |

## Licence

MIT. See `license.txt`.
