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

## ADR-010: The engine draws text itself and uses Tiptap only to edit it
**Status:** Accepted (Phase 3, 2026-11-01)
**Context:** Text in shapes must look the same in the editor, the viewer, exports and thumbnails (one render-to-SVG path), and must be saved as plain data. Putting Tiptap's HTML inside the canvas (a `foreignObject`) would break SVG and PNG export and tie the saved format to the editor library.
**Decision:**
- A shape's text is stored as our own small model: paragraphs of runs `{t, b, i, u, c}`, with size, colour and alignment on the object.
- The canvas lays the text out itself (`engine/text/layout.js`, wrapping at spaces, breaking over-long words, honouring line breaks) and draws it as SVG `<text>`. Measuring uses the browser's font engine, and the layout is the same function in tests with a fake ruler.
- While text is edited, a Tiptap editor is laid exactly over the shape (same position, rotation and zoom). On every keystroke its content is converted to our model and applied as a live gesture, so the whole edit is one undo step and the shape grows to keep its text inside.
- Colours anywhere in a document must be plain hex. The client drops anything else, and the server refuses it, so a collaborator's document can never make a browser fetch an address of their choosing.

**Consequences:** Export, thumbnails and the viewer need no HTML. The HTML editor and the SVG text can wrap a line differently by a character or two, because they use different layout engines. Both use the same font, size and line height, and the SVG layout is what is saved and shown. Replacing Tiptap later would not touch the saved format.

## ADR-011: One document saved whole, under a row lock, against a revision
**Status:** Accepted (Phase 3, 2026-11-01)
**Decision:** `board.save_document` takes the whole document, the revision the client last saw and a save id. It validates the document's structure and size, locks the board row, and writes only if the revision still matches. A repeated save id returns the earlier result. Loading reports `corrupt` or `too_new` instead of opening a blank board, so a damaged document can never be overwritten by accident.
**Tested:** two saves from two database connections at the same moment: exactly one wins, the other gets a stale-revision error (`test_document.py`, T5.3).
**Consequences:** Until realtime arrives (Phase 5) a second writer stops with "changed somewhere else" and must reload. Saving the whole document is simple and safe at the 3,000-object limit (about 1 MB); deltas can come later if measurements say so.

## ADR-012: Export is drawn in the browser from the one SVG; the server only checks and records it
**Status:** Accepted (Phase 4, 2026-11-08)
**Context:** Export must look like the screen, work offline from the server's point of view, and not make the server render anything. The architecture already has one render-to-SVG path (ADR-010), and `render/nodes.js` describes every object and line as plain data.
**Decision:**
- Export builds one SVG string from those descriptions (`export/svg.js`), with pictures fetched and embedded as data so the file stands alone. SVG is saved as that string. PNG and JPEG draw it onto a canvas. PDF puts a 2x PNG on a single page the size of the board (jsPDF, loaded only when a PDF is asked for). Print puts the SVG into a hidden frame, so only the board is on the paper.
- Backgrounds: a board with its own background colour keeps it in every format. With none, PNG and SVG are transparent, and JPEG, PDF, print and thumbnails get white.
- Size: a picture is limited to 8,192 pixels on a side and 40 million pixels; a larger one is exported at a smaller scale and the person is told.
- Before drawing, the browser calls `export.prepare`. The server checks `board:export`, writes an Oqiva Audit Log entry (format and scope), limits the caller to 20 exports a minute, and returns a safe file name. If it refuses, nothing is drawn.
- Thumbnails come from the same SVG, at most 480 pixels on the long side (256 KB at most), sent by `board.save_thumbnail` no more than once every 30 seconds and only after edits. Pictures show as a placeholder in a thumbnail so it never fetches them. If anything fails the tile keeps its placeholder.
- The licence allow-list gains **Zlib**. jsPDF (MIT) needs `fast-png`, which needs `pako` (MIT and Zlib). Zlib is permissive and GPL-compatible, so it is not a copyleft case.

**Consequences:**
- A PDF is a picture, not selectable text. Real vector PDF needs a second renderer; that waits until someone asks.
- Exported text uses whatever font the browser has for "Inter, system-ui, sans-serif": web fonts are not available to an SVG drawn as an image. Lines are laid out with Inter's measurements, so a line can wrap a little differently in an export where Inter is not installed.
- A line's label sits on a white pill, which shows on a transparent export placed on a dark page.
- Export does not need the realtime or save paths, and works for anyone who may view the board (Guests need a share).

## ADR-013: Pictures are private Files attached to the board; access follows the board
**Status:** Accepted (Phase 4, 2026-11-08)
**Decision:**
- `board.upload_image` stores the bytes as a private Frappe File attached to the board, under a random name with an extension taken from the file's own first bytes (PNG, JPEG, GIF or WebP). The name the browser sent is never used. SVG is refused because it can carry script. A document stores only the file's URL.
- Who may fetch a picture is Frappe's own file check, which asks the board's permission hook, so it follows who may view the board. A signed-in person with no access gets a refusal (browser test).
- `board.save_document` refuses a document whose pictures are not private files attached to a board the saver may view. A picture can therefore be copied between a person's own boards, and a document cannot point at somebody else's file.
- Frappe stores identical content once, so two uploads of the same bytes share one file URL (still two File rows, which is also how a picture stays available while any board using it exists).
- Storage per workspace is the sum of `file_size` over File rows attached to its boards, worked out when an upload arrives, so a counter cannot drift. The limit is `workspace_storage_bytes`; the largest single picture is `upload_max_bytes` (default 10 MB, new in Oqiva Settings). An upload is limited to 30 a minute per person.
- Rejected uploads are written to the audit log.

**Consequences:** Deleting a File gives the space back at once, and purging a board deletes its pictures and thumbnail with it (Frappe removes a document's attachments; tested). Deleting a picture *object* from a board keeps its file until the board is purged, because undo needs it, so storage can only be freed by purging boards or deleting files.

## ADR-014: The right palette shows the intersection, except for arrangement; lines are stored by their ends
**Status:** Accepted (Phase 4, 2026-11-08)
**Decision:**
- A palette tile appears only if **every** selected thing supports it (`interaction/palette.js`), so no tile silently skips part of the selection. Corner radius, for example, needs every selected thing to be a rectangle or a picture.
- The exception is arrangement (align, distribute, space, size, swap, rotate, flip, group): when a marquee catches shapes it also catches the lines between them, and those lines follow their shapes anyway, so they are set aside rather than hiding every arrangement tile. A table is left out of flip and of same-size, because a mirrored table reads backwards and its size is the sum of its cells.
- A line is stored as `{from, to, geometry, heads, bend, style, label}` where an end is an object id and one of eight anchors, or a free point. The route is worked out when drawing, so a line follows move, resize and rotate with nothing stored twice. Lines sharing an anchor are spread along its side (anchor fan-out).
- Elbow lines use right angles with a single middle turn and do not steer around other shapes.

**Consequences:** Deleting a shape deletes its lines in the same undo step. A copied line keeps its attachments only when both its shapes are copied too; otherwise it stays where it was as a free line.

## ADR-015: A board is a Yjs document of nested maps; saving merges before it retries
**Status:** Accepted (Phase 5, 2026-11-10)
**Context:** Two people must be able to draw on one board, including while one of them is offline, without either losing work. Saving stays on HTTP (ADR-011); the live link is only an accelerator.
**Decision:**
- **Layout.** The document holds one map each for `objects`, `connectors`, `canvas` and `theme`. Every object and line is its own nested map whose keys are the object's top-level fields. Two people changing different fields of one object (one moves it, one recolours it) both win; changing the same field settles on one value for everyone; deleting beats a concurrent change. Nested values (style, text, table cells, a line's ends) are replaced whole.
- **Same bytes everywhere.** A board with no collaboration state yet is seeded from its saved content with a fixed client id and sorted keys, so two browsers that seed on their own produce identical updates and add up to one copy.
- **Bridge.** Every committed step becomes a change to the document (inside a transaction marked local, so nothing echoes). Changes from outside become `applyRemote` operations in the store, which never enter this person's undo history and never mark the board changed. A drag shows to others when it ends, not frame by frame.
- **Nothing from a peer is trusted.** Each incoming item is rebuilt from its map and put through the same sanitising as a loaded document (and must be filed under its own id). A line left pointing at a deleted shape is dropped everywhere.
- **Saving.** `board.save_document` takes the content and the collaboration state (`crdt_state`, base64, at most twice the document limit, well-formedness only: the server has no Yjs). A save without a state clears the stored one, so the two never disagree. **Merge before retry:** when someone else saved first (`OqivaStaleRevision`), the editor fetches `board.get_crdt_state`, merges it into its own document (which cannot lose either side's work), rebuilds the content and saves again on top of the new revision, up to five times with a pause between. Only when the server has nothing to merge does it stop as a conflict. A client saves only its own changes; what peers did is theirs to save.
- **Offline.** An IndexedDB copy (y-indexeddb, keyed by user and board) merges with the server state on open. If the document then holds changes the server's state lacks, the board is marked changed so they are saved.
- **Live link.** `collab/provider.js` speaks the relay's protocol (join; `step1` state vector to everyone; `step2` targeted replies; `update`; awareness). A newcomer's state is asked for once per arrival, so changes made apart flow both ways. Only editors send state or updates; a payload over 900 KB is not sent, the editor saves over HTTP with `resync`, and the server asks everyone to fetch.
- **Presence.** Yjs awareness: name, colour, pointer (at most 20 a second), selection. Peers' names and colours are cleaned before use.

**Consequences:** The stored `crdt_state` keeps deletion records, so it can grow; compaction is a later job. Someone who may only view receives everything and sends only awareness. A peer with edit rights can store a corrupt state, which every loader sanitises or ignores (a state that cannot be read falls back to the saved content). The relay is the Node handler only: Frappe 16.53 has no Python socket server, so there is no `handlers.py` (the contract stays in ARCHITECTURE section 9).

## ADR-016: Share links are hashed secrets; a redeemed link is a grant; visitors see through link endpoints
**Status:** Accepted (Phase 5, 2026-11-10)
**Decision:**
- A link's secret is 32 random bytes shown once. Only an HMAC-SHA256 of it (keyed from the site's encryption key) and its first six characters are stored. Unknown, revoked, expired and trashed-board links give the same not-found.
- A signed-in person who opens a link gets an Oqiva Link Grant (one per link and person). The grant gives the link's level for as long as the link is live: revoking or expiry takes effect at once, because access is read from the database on every request. The grant counts in capabilities, the permission-checked board list, "Shared with me" and file access.
- A link for anyone who is not signed in exists only at Viewer level. That visitor gets no session and no standing access: they use three guest endpoints (`redeem_link`, `view_shared`, `link_file`), rate-limited by address, that return the board's content and its own pictures and nothing else. Everything else refuses a Guest.
- Opening a link before the welcome page keeps the destination: the welcome page returns to where the person was going.
- Redeem attempts, creation and revocation go to the audit log without the secret.

## ADR-017: Comments are plain text in one-level threads, kept when deleted, pinned to a shape or a place
**Status:** Accepted (Phase 5, 2026-11-10)
**Decision:** Text is stored with markup stripped and control and direction characters removed, and drawn as text. A thread is a first comment plus replies (never a reply to a reply); anyone who may comment adds, replies and resolves; only the author edits; the author or a workspace Admin deletes (soft, with the thread). `@address` mentions are resolved on the server against the board's audience (members, shares, live grants); unknown or outside addresses are ignored, and edits notify only people newly mentioned. A shape-pinned comment is flagged when the shape is no longer on the board (checked on every save) and unflagged if it returns. Live updates carry only a notice, and each browser refetches its own view, so the server decides what each person may do. The generic list and read layer is limited to boards the person can see, and nothing can be written outside the services.


## ADR-018: Frames are the sections; links and notes are part of the document; library shapes are presets
**Status:** Accepted (Phase 6)
**Decision:** A named region ("section") is one kind of object, `frame`, drawn behind everything and picked by its name tag or border so its inside stays free. Moving it carries what is wholly inside it; nothing is "parented", so a document never stores which shape is in which frame. A link is an optional `{url}` or `{board}` field on any object, and only `https`, `mailto` or a board name is accepted when a document is read. A sticky note is the kind `note`. Library shapes are not a document concept: a preset is catalogue data that becomes an ordinary shape (or a new silhouette geometry), so documents never refer to the library. Icons come from a fixed built-in set and are stored by name; emoji are stored as characters.
**Consequence:** Older documents and peers on the previous version keep working (an unknown kind is kept, not drawn). A template is just a document.

## ADR-019: Restore is a client edit; the table is closed to users; import leaves pictures out
**Status:** Accepted (Phase 7)
**Decision:** The version table (`Oqiva Board Version`) grants no read to ordinary users: old content can hold deleted material, so everything goes through the version service, which applies `version:list` (anyone who may view), and `version:preview` and `version:restore` (editors). Restoring is one ordinary edit in the editor (`store.replaceContent`): the server first keeps the board as it is (a Pre-restore version) and returns the old document, the editor applies it, and the CRDT bridge and autosave do the rest, so a peer editing at the same time converges instead of being overwritten. The only server-side restore is for a board whose stored content cannot be opened (corrupt or too new), where there is no live room to protect. Labelling an automatic version makes it a Named one, so it is kept. An import is read by the server like a save, with its pictures dropped (they are files of the board they came from) and the lines attached to them with them.
**Consequence:** Undo reverses a restore. A version from a newer format is refused rather than half-applied. Pictures do not travel in a `.oqiva.json`.

## ADR-022: A freehand stroke is an ordinary object whose points are fractions of its box; the pen is thinned while drawing, never after
**Status:** Accepted (Phase 10)
**Decision:** A pen or highlighter stroke is an object of kind `stroke`, not a new list, so selection, move, resize, rotate, copy, arrange, undo, Yjs merging, limits and export already work for it. Its points are stored as fractions (0 to 1) of its box, which already includes half the pen's width: resizing is then only a change of w and h, and no code has to rewrite points. The points kept are the ones that survive thinning while the pen moves; a finished stroke is never smoothed or simplified, so two people always see the same ink, and what is drawn is always worked out from the stored points by the same function. The eraser never edits a stroke's points in place: ink mode replaces a stroke with the pieces that survive (new objects), object mode removes objects, and either is one undo step that is shown while it happens and applied when the pointer lifts. The laser and the eraser's tip are only state on one screen and are never part of the document. Hand-drawn rendering takes its random seed from the object's id, so it never changes between draws, screens or exports.
**Consequence:** A long erase can make many small strokes (each counts as an object); the object limit still holds. A rotated stroke is erased in board space and its pieces are made unrotated. Pen pressure is simulated, not recorded.

## ADR-021: Flowcharts store a centre and a `manual` flag; size and routes are derived; Tidy up is one step
**Status:** Accepted (Phase 9)
**Decision:** A flowchart is a chart record, its steps and its arrows, saved nested in the document (`flowcharts`) and held as three flat lists in the store and the Yjs document, like mind maps (ADR-020). Unlike a mind map, a step's position is stored (its centre), because people place steps by hand and a drop onto empty canvas must stay where it was dropped; a `manual` flag says which steps were placed by hand, and Tidy up (a layered layout) is the one command that ignores positions: it clears every flag and moves every step in a single undo step. Everything else is derived: a step's size comes from its type and its text, and an arrow's route (orthogonal, between ports on the sides that face the flow) is worked out from the positions, so a label can never drift from its arrow and a swap of type or an insert never leaves a stale route. Operations are pure functions from a chart's records to a change set (`add`, `update`, `remove`, a chart patch), which the store applies as one step; the change set is also what the tests check. The repair that runs on every read and after every remote change drops an arrow to a missing step, a repeated arrow and an empty chart.
**Consequence:** Two people moving different steps both win; two people deleting and connecting the same step are repaired the same way on every screen. Routes do not steer round steps that lie in their way (a limit of the port router, not of the data), apart from one rule: a decision's side exit that would run into another step leaves by the forward side instead. A hand-placed step can still sit on an arrow until Tidy up. Dragging several steps at once and copy and paste of steps are not in v1.

## ADR-020: Mind maps are trees of plain-text nodes, stored nested and held flat; positions are never stored
**Status:** Accepted (Phase 8)
**Decision:** A mind map is a tree of nodes with plain-text content, saved nested in the document (`mindmaps`, ARCHITECTURE section 15.2) and held flat in the store and the Yjs document: one list each for maps, nodes and cross-links. Flat lists give each node its own undo entries and its own merge, so one person renaming a node and another moving it both win. Positions are always worked out by the layout from the tree, so a map can never be saved in an overlapping or stale arrangement, and nothing about position has to be merged. Sibling order is an integer, and ties (two people adding under one node at once) are broken by id, so everyone sees the same order. A map that two people have broken between them (an orphan, a cross-link to a deleted node) is repaired the same way on every screen and in the shared document, and the same repair runs on every document that is read, on the server and in the browser, so a map that cannot be a tree is never drawn. Restoring a version replaces maps like everything else.
**Consequence:** A node is selected like any object but is not one: generic Delete, copy and arrange ignore it, and the mind map owns Tab, Enter, the arrows and Delete while only nodes are selected. The outline is a second view of the same data, so it cannot get out of step. Node text has no formatting in v1.

## ADR-023: The model describes a diagram, the browser draws it; one background job, one client edit
**Status:** Accepted (Phase 12)
**Decision:** AI diagram generation is off unless an administrator sets a provider (Anthropic or Gemini) and a key in Oqiva Settings. The model is asked for a small description only (a title, nodes and edges, at most 60 and 120), never for drawings, HTML or board records. The server validates that description as a whole and rejects it entirely if anything is wrong, so nothing is ever half applied. The request is a background job (the provider can take longer than a web request should) whose outcome is kept for ten minutes and pushed to the asker as a live event; the browser also polls for it, so the feature works when the live link is down. The browser turns the description into a mind map, a flowchart or an architecture diagram with the layout code the editor already has, and inserts it with one `store.applyOps`, the same rule as restoring a version (ADR-019): one undo step, an ordinary edit for peers and for saving, and no server write to a board. Each provider is called with `requests` and its documented headers rather than an SDK: it is one POST, Frappe already ships `requests`, and the app gains no dependency to keep licensed and updated. A model name belongs to one provider (`claude-` or `gemini-`), so switching provider falls back to that provider's default instead of sending a name it would reject; the Gemini model goes into the request address, so only a plain identifier is accepted there. The prompt is sent and never stored: the audit log holds its length.
**Consequence:** The server can be tested with a mocked provider and no network; a provider that returns nonsense costs a retry, not a corrupt board. An architecture diagram is made of plain shapes and connectors, so it can be edited, exported and shared like anything else, but it is not "live": Tidy up does not apply to it. Changing the model or provider means a settings change only. The cost is whatever the provider charges; only the 10-a-minute limit per person bounds it.

