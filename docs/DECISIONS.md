# Oqiva on Frappe — Architecture Decision Records

Status key: **Accepted** = approved by the product owner on 2026-10-31 (plan decisions D1–D7). **Accepted (refined)** = approved in principle and refined by Phase 0 research; the refinement needs confirmation at the review gate.

---

## ADR-001: Canvas engine is Draw's, vendored (D1)
**Status:** Superseded by ADR-008 on 2026-10-31. The product owner decided Draw is a reference only. Kept for the record.
**Context:** Oqiva used tldraw 5.4.2 (React; watermark or paid licence; needs a Node sync server). Frappe Draw (Vue 3 + frappe-ui) already provides block diagrams, mind maps, flowcharts and whiteboards on one SVG canvas, with about 120 test files.
**Decision:** Copy Draw's engine (`diagram/`, `stores/`, `composables/`, canvas, toolbar, palette and comment components) into `oqiva/frontend/src/engine` at commit `c9ff6b6`. Make minimal edits and put a port/adapter boundary around it (VENDORING.md).
**Rejected:**
- *Depend on Draw and extend `Draw Diagram` with Custom Fields.* Frappe `has_permission` hooks can only deny, and query conditions are ANDed, so Draw's owner and share rules would always cut off workspace-based access. Verified in `frappe/permissions.py: has_controller_permissions`.
- *Import Draw's source through a Vite alias.* Draw changes too fast (about 590 PRs).
- *tldraw.* Different UI stack, licence cost and a Node sync sidecar.

**Consequences:** We own the engine. Draw fixes have to be cherry-picked (monthly review; VENDORING.md §5). Draw's documented performance budget of 300 shapes at 60 fps becomes ours. Oqiva's 10,000-object limit is not assumed (ARCHITECTURE Q1).

## ADR-002: Licence is MIT (D2)
**Status:** Accepted, product owner, 2026-10-31. This replaces the earlier AGPL-3.0 decision, which ADR-008 made unnecessary.
**Context:** With no Draw code in the app, AGPL isn't required. Every planned dependency is MIT, ISC or Apache-2.0 (ADR-008), and Frappe itself is MIT.
**Decision:** The `oqiva` app is licensed **MIT**. `bench new-app oqiva` is run with `--license mit` (task P1.01).
**Consequences:**
- The CI dependency licence check (task P1.11) allows only MIT-compatible licences.
- A copyleft dependency (GPL, AGPL, LGPL, EPL, MPL) needs an explicit ADR before it is added.
- Draw code stays excluded (ADR-008). Copying any of it would conflict with MIT.

## ADR-003: Realtime is an authorised Yjs relay over Frappe socket.io (D3)
**Status:** Accepted (refined)
**Context:** Draw syncs Yjs peer to peer over `y-webrtc` through the public `wss://signal.frappe.cloud`. No server stands between the peers, so read-only access is enforced only by withholding the room password. Frappe loads `apps/<app>/realtime/handlers.js` into its Node socket.io server (and `<app>.realtime.handlers` into the newer Python server), and gives each socket an authenticated `frappe_request` loopback.
**Decision:** Clients exchange y-protocols sync and awareness messages through our socket.io handler. The handler:
- authorises `join` through `oqiva.api.realtime.authorize`;
- relays `step2` and `update` only from Editors, re-authorising after 15 s;
- holds **no** Y.Doc.

Persistence stays on the revision-checked HTTP save, and stale revisions are resolved by **merging the server's `crdt_state` before retrying** (ARCHITECTURE §8.2).
**Refinement versus the plan:** The plan said the server would persist Yjs updates. Research changed that to clients persisting through HTTP while the server relays. Reasons:
1. No Yjs on the server, so the identical contract works for the Node and Python realtime servers.
2. Persistence keeps a single, already-tested write path with validation and limits.
3. Merge-before-retry removes the overwrite race that Draw documents in `useAutosave.js` (the "LIMIT OF peered" comment).

**Rejected:**
- *Server-side Y.Doc* (y-websocket style). Needs `yjs` in Node and `pycrdt` in Python, and a flush path that runs as some user.
- *y-webrtc with self-hosted signalling.* Still has no server-side read-only enforcement.

**Consequences:**
- Payloads are capped at 900 KB to stay under socket.io's 1 MB default. Larger changes go through HTTP save plus `oqiva:resync`.
- Rooms live in one process per bench, so multi-host needs sticky sessions.
- A Phase 1 spike must prove it: two browsers, a 1,000-shape board, a viewer trying to inject `update` and `step2` (must be dropped), revocation within 15 s, and offline then reconnect.

**Spike result (P1.03, 2026-11-01): go.** `realtime/handlers.js` was loaded by Frappe's own socket server and driven by four real users (an editor, a second editor with a share, a viewer with a view share, and an outsider) through `spikes/realtime/run.mjs`. All 22 checks passed:
- access levels came back correctly (edit, edit, view, none), and a bad board name was refused;
- a 1,000-object board encodes to 91 KB, and a late editor received all of it in 75 ms;
- a viewer's update never reached an editor, and the outsider received nothing;
- an update over 900 KB was dropped while normal ones kept flowing; awareness over 8 KB was dropped and bursts were throttled to 30 messages a second;
- peers were told when someone left, and a returning editor caught up on what they missed;
- after a share was removed, the revoked editor's updates stopped within the re-check window (2 s in the test, 15 s by default), and they were told their access had ended.

Not yet covered: the Python realtime server twin (P5.02), many concurrent editors (P13.02), and browsers (the spike used Node clients).

## ADR-004: Accounts are Frappe Users (D4)
**Status:** Accepted
**Decision:** Use Frappe login, sign-up, password reset, sessions, 2FA and social login. "Oqiva User" is a role without desk access, granted lazily on first `/oqiva` visit (configurable). Suspending a user means disabling the Frappe User, which ends their sessions. The realtime loopback then fails, and the relay stops their writes within 15 s.
**Dropped from Oqiva:** argon2 and JWT, refresh rotation, the sessions and verification-token tables, and Oqiva auth gaps #4 and #5.

## ADR-005: Templates are stored as Oqiva documents
**Status:** Accepted (updated for ADR-008)
**Context:** Oqiva 0.1 stored neutral node/edge specs and seeded them on the client on first open. That could double-seed when two people opened a new board at once, and tldraw had no schema migration for stored snapshots.
**Decision:** Store `Oqiva Template.document` as an Oqiva document (schema v1, ARCHITECTURE §15.2) with `schemaVersion`. At board creation the server copies it. The engine's `parseDocument` migrates older versions forward. Oqiva's 14 templates are converted once by a script that uses the engine's factories and layouts.

## ADR-006: Admin is a Desk workspace (D5)
**Status:** Accepted
**Decision:** The admin console is a Desk Workspace named "Oqiva Admin" (role Oqiva Admin), containing Number Cards (users, active in the last 7 days, workspaces, boards, open bugs), Dashboard Charts (sign-ups and boards created over 7, 30 and 90 days), list views (User, Bug Report, Feature Request, Audit Log, Error Log) and the System Health Report.
**Consequence:** No custom admin SPA. Oqiva admin features with no Desk equivalent, such as assigning a bug to an admin, use Frappe's built-in Assign To.

## ADR-007: Anonymous read-only links (D6) and v1 scope (D7)
**Status:** Accepted
**Decision:** A share link can be marked `allow_anonymous`, for Viewer access only. Anonymous visitors get a canvas-only viewer (the same behaviour as Draw's), with no comments, no export and no presence identity. Link creation defaults to requiring sign-in. v1 is Phases 1–10 (`DEVELOPMENT_PLAN.md`), with the MVP after Phase 7. Feedback, admin, AI and hardening are Phases 11–13.

## ADR-008: Own canvas engine; Draw is a reference only (amends D1)
**Status:** Accepted, product owner, 2026-10-31
**Context:** The product owner asked that Draw only be *studied* for features and behaviour, not copied.
**Decision:** Build Oqiva's canvas engine from scratch in Vue 3 + SVG (structure in ARCHITECTURE §15.1). Target the Draw features catalogued in `DRAW_FEATURE_REFERENCE.md` plus Oqiva's own canvas features.
**Clean-room rules:**
1. No code, tests, CSS or spec text is copied from `apps/draw`. You may run Draw and read its public README and design specs **to learn the behaviour**.
2. Engine code is written from our own design notes (`DRAW_FEATURE_REFERENCE.md`, the task descriptions in `DEVELOPMENT_PLAN.md`). Reviewers reject a PR that resembles Draw's source file by file.
3. Algorithms (balanced mind-map layout, orthogonal routing, stroke thinning) are implemented from general published techniques. Where a library exists, use a permissively licensed one.

**Allowed third-party libraries** (all permissive; anything new needs approval: what it is, why, its size and the alternative):

| Library | Licence | Use |
|---|---|---|
| vue, vue-router, frappe-ui | MIT | SPA, chrome |
| yjs, y-protocols, y-indexeddb, lib0 | MIT | CRDT, sync protocol, offline cache |
| @tiptap/* | MIT | rich text in shapes |
| nanoid | MIT | stable ids |
| perfect-freehand | MIT | pen and highlighter stroke outlines |
| roughjs | MIT | hand-drawn sketch style |
| @dagrejs/dagre | MIT | flowchart Tidy-up layout (layered) |
| jspdf | MIT | binary PDF export (print fallback) |
| dompurify | MIT or Apache-2.0 | sanitising rich text |

**Consequences:**
- Canvas work grows from one phase (port) to five engine phases. The total estimate rises by about 14–16 weeks (`DEVELOPMENT_PLAN.md`).
- There's no AGPL obligation (ADR-002 reopened).
- Draw's lessons are kept as **requirements**, not code. Examples: merge-before-retry saves, POST-only writes, no System Manager leak, composite uniques in `after_migrate`, and thinning strokes while drawing rather than on pointer-up.

## ADR-009: Boards are limited to 3,000 objects, with culling and level-of-detail from the start
**Status:** Accepted (spike P1.04, 2026-11-01)
**Context:** Oqiva allowed 10,000 objects per board. The question was whether an SVG canvas can hold that and still pan, zoom and drag smoothly. `spikes/renderer/run.mjs` renders N rounded rectangles with labels in headless Chromium and times 90 animation frames of panning, zooming and dragging one object.

| Objects | Mounted | Pan (avg / p95) | Zoom (avg / p95) | Drag one object (avg) |
|---|---|---|---|---|
| 300 | all | 18 / 33 ms | 35 / 50 ms | 17 ms |
| 1,000 | all | 18 / 17 ms | 58 / 83 ms | 18 ms |
| 3,000 | all | 19 / 33 ms | 124 / 217 ms | 17 ms |
| 3,000 | only visible (49) | 18 / 33 ms | 25 / 50 ms | 18 ms |
| 10,000 | all | 31 / 50 ms | 398 / 650 ms | 30 ms |
| 10,000 | only visible (49) | 26 / 50 ms | 44 / 83 ms | 17 ms |

These numbers come from a virtual machine with no GPU, so the browser rasterised in software. Real hardware should do better. Treat the table as relative.

**Decision:**
- `max_objects_per_board` stays at **3,000** (the default in Oqiva Settings). 10,000 is not offered in v1.
- The renderer **mounts only the objects that intersect the viewport** (P3.04). Without it, zoom at 3,000 objects takes 124 ms a frame.
- Zoomed far out, the viewport holds hundreds of objects, which is where the remaining zoom cost sits. The renderer therefore draws a **simplified shape (no text) below a zoom threshold**.
- Dragging one object is cheap at any size, so dragging needs no special handling.
- Re-measure on real hardware in P13.02 before raising the limit.
