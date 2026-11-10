# Oqiva on Frappe — Phase 0 Architecture

| | |
|---|---|
| Revision | 1.1. Rev 1 was signed off by the product owner on 2026-10-31 ("for now"). Rev 1.1 applies the same-day amendment: Draw is a **reference only** and Oqiva builds its own canvas engine (ADR-008 replaces ADR-001). |
| Date | 2026-10-31 |
| Inputs | `OQIVA_SPECIFICATION.md` (Oqiva 0.1.0) · `OQIVA_FRAPPE_PLAN.md` · Frappe 16.53.0 source · Frappe Draw `c9ff6b6` (**studied for features and behaviour only; no code copied**) |
| Decisions | D1–D7 approved 2026-10-31, D1 then amended. Records are in `DECISIONS.md`. |
| Companion docs | `DECISIONS.md` (ADRs) · `DRAW_FEATURE_REFERENCE.md` (Draw features to match) · `DEVELOPMENT_PLAN.md` (phases and tasks) · `SECURITY_TEST_PLAN.md` (IDOR and permission tests) |
| Location | These files live in `frappe-bench/oqiva-docs/` until Phase 1 creates `apps/oqiva`. They then move to `apps/oqiva/docs/`. |

> **Review gate.** Rev 1 was signed off on 2026-10-31. The licence is MIT (ADR-002), so Phase 1 can start. §19's proposed answers are adopted unless the review changes them. Phases and tasks are in `DEVELOPMENT_PLAN.md`.

---

## 1. Scope

**v1 (Phases 1–10; the MVP milestone is after Phase 7):** workspaces, projects, boards, home area, Oqiva's own canvas engine (block diagrams, shape library, connectors, mind maps, flowcharts and whiteboard, matching the Draw features in `DRAW_FEATURE_REFERENCE.md`), templates, realtime co-editing, comments, sharing (people and links), notifications, version history, JSON export and import.

**Later phases:** feedback and admin workspace (11), AI (12), hardening (13).

**Non-goals (carried over from Oqiva §1.5):** native apps, enterprise SSO beyond Frappe's own, billing, template marketplace, 100+ simultaneous editors, and changing a diagram's type after creation (a Draw rule).

---

## 2. System context

```
Browser
  /oqiva/*  Vue 3 + frappe-ui SPA (www/oqiva.html)
     ├─ app shell (Oqiva):  home, workspaces, projects, search, trash, templates, notifications
     └─ editor  (Oqiva engine, own code): canvas, palettes, comments UI, export
        │  Yjs Y.Doc  ←→  y-indexeddb (offline cache)
        │
        ├── HTTPS  /api/method/oqiva.api.*     (session cookie, CSRF token)
        └── socket.io  (site namespace)  events  oqiva:*
                │
Frappe processes on this bench (Procfile):
  web (gunicorn / bench serve) ── MariaDB ── Redis (cache, queue)
  socketio  (node apps/frappe/socketio.js) ── loads apps/oqiva/realtime/handlers.js
  worker / schedule
```

**Facts checked against the source:**
- **App socket.io handlers.** `apps/frappe/realtime/index.js` loads `apps/<app>/realtime/handlers.js` for every app installed on the connecting site. Each socket gets `socket.user`, `socket.user_type` and `socket.frappe_request(path)`. That last one makes an HTTP loopback request as the socket's user, using the session cookie plus the socket secret.
- **Python realtime server.** Frappe 16.53 also ships a Python socket.io server (`python -m frappe.realtime.server`). It loads `<app>.realtime.handlers` and offers the same room and permission primitives. This bench's Procfile and supervisor config still run the **Node** server. ADR-003 has both of these as the deployment matrix.
- **App-defined rooms.** `publish_realtime` and `frappe.realtime.publish_to_room` (web process → Redis `events` → socket server) deliver to any room name, including rooms our handler `join`s.
- **Permission hooks.** `has_permission` hooks **can only deny** (`frappe/permissions.py: has_controller_permissions`). `permission_query_conditions` are ANDed with role conditions, and DocShare rows are ORed in for list queries (`db_query.py`).

---

## 3. App layout (created in Phase 1)

```
apps/oqiva/
├── realtime/handlers.js            Node socket.io relay (loaded by Frappe's Node server)
├── frontend/                       Vite SPA → builds to oqiva/public/frontend
│   └── src/
│       ├── engine/                 Oqiva canvas engine (own code; §15.1)
│       ├── engine-adapters/        persistence / comments / share / images ports → oqiva.api
│       ├── app/                    Oqiva shell: pages, home components, stores, router
│       └── shared/                 frappe-ui setup, tokens, utils
├── oqiva/
│   ├── hooks.py  setup.py  exceptions.py  boot.py
│   ├── api/                        thin whitelisted endpoints (one module per area)
│   ├── services/                   business logic + transaction boundaries
│   ├── access/                     resolve.py (AccessContext) · rules.py (may) · hooks.py (has_permission, PQC)
│   ├── realtime/handlers.py        Python-server relay (parity with handlers.js; used when bench switches)
│   ├── oqiva/doctype/…             DocTypes (§5)
│   ├── seed/templates/*.json       template documents (Oqiva document schema)
│   ├── www/oqiva.html, oqiva.py    SPA entry; lazy role grant and personal workspace
│   └── tests/
└── docs/                           this folder
```

**Layering rule (same as WorkBoard):** `api/*` validates input, calls one service, maps errors → `services/*` checks `may(ctx, action)` and owns the transaction → DocType controllers hold invariants only. Controllers refuse writes that don't come from a service (`flags.oqiva_service`). This closes the generic `/api/resource` write path while still letting Frappe's role permissions apply.

---

## 4. Roles

| Role | desk_access | Purpose |
|---|---|---|
| **Oqiva User** | 0 | Granted lazily the first time a logged-in user opens `/oqiva` (Draw's pattern; Settings › `auto_grant_role`). It works for Website Users as well. Role perms: read on Oqiva DocTypes, and write/create on those created through services. |
| **Oqiva Admin** | 1 | Admin workspace (Phase 11), settings, bug triage. It replaces Oqiva's install-wide `UserRole.ADMIN`. It does **not** bypass board access. |
| System Manager | – | No implicit board access. Our query conditions return "" only for Administrator. This fixes Draw issue #73, where System Manager got full access. |

Workspace roles (Owner, Admin, Member, Guest) are **data** in `Oqiva Workspace Member`, not Frappe roles.

---

## 5. Data model

Conventions:
- Names use `autoname: hash` (10 random characters), so they can't be enumerated.
- Soft delete uses `is_trashed` / `trashed_on`, or `is_deleted` for workspaces.
- `track_changes` is on for Workspace, Member, Project and Share Link.
- Composite unique constraints are added in `setup.ensure_setup()` with `frappe.db.add_unique`. A DocType JSON can't declare them, and `on_doctype_update` doesn't run on a normal migrate (lesson from Draw #217).

### 5.1 Oqiva Settings (Single)
| Field | Type | Default |
|---|---|---|
| auto_grant_role | Check | 1 |
| max_objects_per_board | Int | 3000 (see ADR-001 and the performance spike) |
| max_document_bytes | Int | 5 242 880 |
| max_boards_per_workspace | Int | 2000 |
| workspace_storage_bytes | Int | 2 147 483 648 |
| trash_retention_days | Int | 30 |
| auto_version_interval_min | Int | 10 |
| version_retention | Int | 50 |
| realtime_reauth_seconds | Int | 15 |
| ai_enabled, ai_api_key (Password), ai_model | – | Phase 12 |
| notification_email, notify_new_bug, notify_new_feature | – | Phase 11 |

### 5.2 Oqiva Workspace
| Field | Type | Notes |
|---|---|---|
| workspace_name | Data (req) | 1–120 characters, NFC-normalised |
| slug | Data | unique |
| owner_user | Link User (req) | the owning user, separate from `owner` (creator) |
| personal_of | Link User | **unique**; set only on the personal workspace. MariaDB allows multiple NULLs, so this gives "one personal workspace per user" without a partial index. |
| is_deleted, deleted_on | Check, Datetime | personal workspaces can't be deleted |
| storage_used_bytes | Int | updated by File hooks (§13) |

### 5.3 Oqiva Workspace Member
| Field | Type | Notes |
|---|---|---|
| workspace | Link (req) | |
| user | Link User (req) | |
| role | Select Owner/Admin/Member/Guest | exactly one Owner, who matches `owner_user` |

Constraints: **unique (workspace, user)**. Index (user).
Invariants: the Owner row can't be removed or demoted except by an ownership transfer (a service operation; the UI comes later). The Owner can't leave.

### 5.4 Oqiva Project
| Field | Type |
|---|---|
| workspace | Link (req, set only on create) |
| project_name | Data (req) |
| description | Small Text |
| color | Select (token names, not hex) |
| icon | Data (emoji or icon key) |
| archived_on | Datetime |
| is_trashed, trashed_on | Check, Datetime |

Index (workspace, is_trashed).

### 5.5 Oqiva Board
| Field | Type | Notes |
|---|---|---|
| workspace | Link (req, set only on create) | |
| project | Link Oqiva Project | must be in the same workspace; NULL = workspace root |
| title | Data (req) | 1–120 |
| description | Small Text | |
| document | JSON | Oqiva document (`schemaVersion` 1; §15.2) |
| crdt_state | Long Text | base64 Yjs update of the whole document lineage |
| revision | Int | +1 on every persisted content change |
| schema_version | Int | mirror of `document.schemaVersion` |
| last_save_id | Data | idempotency for the latest save (§8.2) |
| object_count | Int | shapes + connectors + sections |
| thumbnail | Attach Image | private |
| template | Link Oqiva Template | provenance only |
| created_by_user | Link User | creator; drives the "creator may trash" rule |
| last_opened_on | Datetime | per board (per-user recents live in Oqiva Board View) |
| archived_on | Datetime | |
| is_trashed, trashed_on, trashed_with_project | Check, Datetime, Link | project cascade marker, replacing Oqiva's timestamp matching |
| has_active_link | Check | denormalised "shared" badge |

Indexes: (workspace, is_trashed, modified), (project, is_trashed), (created_by_user).

### 5.6 Oqiva Board View (per-user recents)
board, user, last_opened_on. **unique (board, user)**. Upserted when a board is opened and pruned after 90 days. "Recent" is per user (Oqiva used a single global `last_opened_at`, which made it the same for everyone).

### 5.7 Oqiva Board Version
| Field | Type | Notes |
|---|---|---|
| board | Link (req) | |
| version_number | Int | **unique (board, version_number)**, allocated under the board row lock |
| revision | Int | board revision it captures |
| schema_version | Int | |
| document | JSON | full Oqiva document (no `crdt_state`; restore is client-side, §7.4) |
| size_bytes | Int | |
| kind | Select Auto/Named/Pre-restore | |
| label | Data | |
| pinned | Check | survives retention |

### 5.8 Oqiva Comment
Its fields cover what Draw's comments do, plus Oqiva's additions: board, parent_comment (one level), content (sanitised), anchor_type (shape/point), shape_id, board_x, board_y, mentions (JSON list of users), **object_missing**, resolved, resolved_by, resolved_on, is_deleted.
Indexes: (board, resolved), (board, shape_id), (parent_comment).

### 5.9 Sharing
- **Per person:** core **DocShare** on Oqiva Board, using Draw's level mapping: view {read}, comment {read, comment}, edit {read, comment, write}. Unlike Draw, *edit does not grant `share`*, because Oqiva's rule is that share-only users can't re-share. The custom `comment` permission type is registered idempotently and shared with Draw if Draw is installed (§17).
- **Oqiva Share Link:** board, access (Viewer/Commenter/Editor), token_hash (**unique**, HMAC-SHA256 with a key derived from the site `encryption_key`), token_hint (first 6 characters), allow_anonymous (Check, Viewer only), expires_on, revoked_on, last_used_on, created_by_user.
- **Oqiva Link Grant:** share_link, board, user, granted_on. **unique (share_link, user)**. A grant is live only while its link is live (not revoked, not expired, board not trashed). This fixes Oqiva gap #6, where revoking a link didn't cascade.
- **Invites to unregistered emails:** core **User Invitation**, plus an `Oqiva Pending Invite` (email, workspace or board, role or access). It's converted on User `after_insert` and on first SPA boot. This fixes Oqiva's INVITE shares that never activated.

### 5.10 Other DocTypes
| DocType | Fields |
|---|---|
| Oqiva Favorite | user, board · **unique (user, board)** |
| Oqiva Template | slug (unique), template_name, description, category, tags, preview_image, document (JSON, Oqiva schema), schema_version, published, sort_order |
| Oqiva Audit Log | action, resource_type, resource_name, user, ip, metadata (JSON) — events that aren't document changes (export, link redeemed or rejected, AI request). Pruned after 365 days. |
| Oqiva Bug Report / Oqiva Feature Request | Phase 11 (fields as in the plan, §5) |

**Not ported:** User, Session, VerificationToken (Frappe auth). SystemError (Error Log). FileObject (File). BoardOperation (§8.2 replaces it). AdminSettings (Oqiva Settings).

---

## 6. Authorisation

### 6.1 Resolution
`access.resolve.board_context(user, board, include_trashed=False) -> AccessContext` runs one query per source, all cached for the request on `frappe.local`:

| Source | Gives |
|---|---|
| Oqiva Workspace Member (workspace not deleted) | `role` |
| DocShare (share_doctype = Oqiva Board, user, read = 1) | `share` = max(view/comment/edit) |
| Oqiva Link Grant joined to a live Share Link | `share` (max with the above) |
| anonymous link token (Guest only, `allow_anonymous`) | `share` = Viewer |
| board.created_by_user == user | `is_creator` |
| workspace.owner_user == user | `is_owner` |

The board must exist and must not be trashed (unless `include_trashed`). Its workspace must not be deleted. If not, or if the user has **no role and no share**, the result is **not found**.

### 6.2 Rules table (`access.rules.may(ctx, action)`, a pure function with unit tests)
Rank: Guest 0 < Member 1 < Admin 2 < Owner 3. Viewer 0 < Commenter 1 < Editor 2.

| Action | Rule | Change from Oqiva |
|---|---|---|
| board:view, board:export, board:favourite | role ≥ Member **or** any share | **Guest needs a share** (fixes Oqiva gap #7) |
| board:comment, comment:create, comment:resolve | role ≥ Member **or** share ≥ Commenter | – |
| board:edit, board:rename, version:restore | role ≥ Member **or** share = Editor | – |
| board:move | board:edit **and** role ≥ Member in the workspace | share-only Editors can't move a board between projects they can't see |
| board:duplicate | board:view **and** role ≥ Member | – |
| board:share (add a person or create a link) | role ≥ Member | – |
| share:modify / share:revoke (existing row) | role ≥ Admin **or** is_creator of the board **or** created that share row | Oqiva let any Member change anyone's shares (gap #6) |
| board:archive, board:trash, board:restore, board:purge | role ≥ Admin **or** (is_creator **and** role ≥ Member) | – |
| version:list | board:view | – |
| version:preview | board:edit | Old content can hold deleted material, so it's limited to editors |
| comment:edit | author only | – |
| comment:delete | author **or** role ≥ Admin | – |
| project:view | role ≠ None | – |
| project:create, project:update | role ≥ Member | – |
| project:archive, project:trash, project:restore | role ≥ Admin | – |
| workspace:view, workspace:leave | role ≠ None (the Owner can't leave) | – |
| workspace:update, workspace:invite, member:change_role, member:remove | role ≥ Admin (an Admin can't change or remove the Owner, or another Admin unless they are the Owner) | Tightened: an Admin can't demote another Admin |
| workspace:delete | is_owner and not personal | – |

`capabilities(ctx)` returns `{can_view, can_comment, can_edit, can_rename, can_move, can_share, can_duplicate, can_trash, can_export}`. The SPA uses it to render controls. The server always re-checks.

### 6.3 Wiring into Frappe
- **Role permission** (DocPerm): Oqiva User gets read, write and create on Oqiva DocTypes (create is still blocked by `flags.oqiva_service`).
- **has_permission hooks** (deny only), for Oqiva Board, Project, Workspace, Workspace Member, Comment, Board Version and Share Link: map `ptype` → action and return `may(...)`. Comment, Version and Link inherit the board check.
- **permission_query_conditions** for Board: `workspace IN (member workspaces with role ≥ Member) OR name IN (live link grants)`. DocShare rows are ORed in by Frappe itself. Comment, Version and Link: `board IN (<board subquery>)`. Project: `workspace IN (any role)`. Only `Administrator` gets "".
- **404 policy:** every service raises `OqivaNotFound(frappe.DoesNotExistError)` when `may` fails because the user has *no relationship* to the record. It raises `OqivaForbidden(frappe.PermissionError)` only when the record is visible but the action isn't allowed. That matches Oqiva's "not found, never forbidden" behaviour for unrelated users.
- **POST only:** every endpoint that changes state is `@frappe.whitelist(methods=["POST"])` (Draw #422 CSRF lesson).
- **Rate limits:** `frappe.rate_limiter.rate_limit` on link redemption (20/min per IP), export (20/min per user), uploads (30/min), AI (10/min) and feedback (20/h).

### 6.4 Revocation while a board is open
1. The service that revokes or downgrades (share revoke, link revoke, member remove or demote, workspace delete, user disabled) publishes `oqiva:access_changed {board?, workspace?}` to `user:<target>` with `after_commit=True`. An honest client re-runs `join` and drops to read-only, or shows the access notice.
2. The relay re-authorises a socket's **write** messages once its cached authorisation is older than `realtime_reauth_seconds` (15 s). A tampered client therefore loses write access within at most 15 s.
3. Every HTTP save re-resolves access. A revoked editor's autosave fails immediately.

Together these close Oqiva gap #1 (revoked users kept their open sockets).

---

## 7. Board lifecycle

### 7.1 Create
`board.create(workspace, project?, title?, template?)` checks: `board:create` (role ≥ Member in the workspace), project in the same workspace and not trashed, and `max_boards_per_workspace`. With a template, `document` is a server-side copy of `Oqiva Template.document` (already an Oqiva document, ADR-005), so nothing is seeded on first open. That removes Oqiva's race where two people opening a new template board at once could seed it twice. `crdt_state` starts empty. The first client to open the board builds the Y.Doc from `document`.

### 7.2 Open
`board.get(name)` returns metadata, `document`, `crdt_state`, `revision`, `capabilities`, `open_comment_count` and the realtime room key. It upserts Oqiva Board View for the caller. A corrupt or too-new `document` returns `recovery: true`, and the editor opens read-only with a "restore a version" prompt. This fixes Oqiva gap #10, where a corrupt snapshot opened as empty and was then overwritten.

### 7.3 Save (§8.2 has the protocol)

### 7.4 Version history
- **When a version is taken:** inside the save transaction, if the newest Auto version is older than `auto_version_interval_min`, an `Auto` version is written. "Save version" (with a label) writes a `Named` version. Restore writes a `Pre-restore` version first.
- **Retention:** keep the newest `version_retention` Auto versions plus all Named and pinned versions. Pruning runs in the save transaction, at most once per hour per board.
- **Restore runs on the client (fixes Oqiva gap #2).** The restoring editor fetches the version's `document` and applies it to its local store as **one ordinary edit**. The CRDT bridge turns that into Yjs deletes and sets, so peers converge and normal autosave persists it. The server never overwrites `document` behind a live room. Import and AI insert follow the same rule.

**As built (Phase 7).** Versions are read only through `version_service` (`list_versions`, `get_version`, `save_named`, `set_label`, `set_pinned`, `begin_restore`, `restore_unopenable`; endpoints in `api/version.py`), because the table grants no read to ordinary users. An Auto version is skipped when the content equals the newest version. Labelling an Auto version makes it Named. Retention treats Auto and Pre-restore together. `begin_restore` writes the Pre-restore version, returns the old document and leaves the board row alone; the editor applies it with `store.replaceContent`. `restore_unopenable` is the one server-side write, allowed only while the stored document fails validation. The `.oqiva.json` file is `{format: "oqiva-board", formatVersion: 1, schemaVersion, title, exportedOn, document}`; `board.import_board` reads it with `export_service.read_board_file`, drops picture objects and their lines, and validates the rest as a save. Oqiva errors now put their message in the message log, so the browser can show it.

### 7.5 Trash, restore, purge
- **Board:** trash sets `is_trashed` and `trashed_on`. Restore requires the project and workspace to still be live; if the project is trashed, the board is restored to the workspace root and the user is told (Oqiva [FLAG] in §5.12). Purge requires the board to be trashed. It deletes the board, its versions, comments, links, grants, favourites, board views and DocShares, and it deletes or detaches files.
- **Project trash:** each live board in the project gets `is_trashed=1`, `trashed_with_project=<project>`. Project restore restores exactly the boards with that marker.
- **Daily job:** purge boards and projects trashed more than `trash_retention_days` ago.

### 7.6 Duplicate
Copies `document`, title "Copy of …" and project. `crdt_state` is empty because the copy starts a new lineage. Comments, versions and shares aren't copied.

---

## 8. Persistence, transactions, concurrency

### 8.1 Transaction boundaries
Each whitelisted call is one request transaction (Frappe's default). Services don't call `frappe.db.commit()`. Side effects (realtime publish, notifications, email) use `after_commit=True` or `frappe.enqueue(..., enqueue_after_commit=True)`.

### 8.2 Save protocol: `board.save_document(name, document, crdt_state, base_revision, save_id)`
1. `may(ctx, "board:edit")`.
2. Lock the row: `frappe.db.get_value("Oqiva Board", name, [...], for_update=True)`.
3. If `save_id == last_save_id`, this is a replay. Return the current `{revision}` without writing.
4. If `base_revision < revision`, raise `OqivaStaleRevision(server_revision)`.
5. Validate: JSON parses, `schemaVersion ≤ SUPPORTED`, size ≤ `max_document_bytes`, object count ≤ `max_objects_per_board`, and `crdt_state` is valid base64 within the size cap.
6. Write `document`, `crdt_state`, `revision + 1`, `object_count`, `schema_version` and `last_save_id`. Optionally write an Auto version (§7.4). Re-flag `object_missing` on comments by diffing comment `shape_id`s against the document's ids.
7. After commit, publish `oqiva:saved {board, revision}` to the board room.

**Client stale-revision recovery (fixes the race Draw documents in `useAutosave.js`):** on `OqivaStaleRevision`, fetch `board.get_crdt_state(name)` → `Y.applyUpdate(localDoc, serverState)` (CRDT merge is commutative and idempotent) → rebuild `document` from the merged Y.Doc → retry with the new base revision, up to 5 attempts with backoff. The retry never trusts "a peer probably has it". It merges what the server actually holds, so a concurrent writer's edits can't be overwritten even when the realtime link between the two writers is broken.

**Who saves:** a client saves only when it has **local-origin** changes that aren't yet persisted. Remote changes are their originator's job to save. This keeps N peers from each writing the same state.

### 8.3 Limits
These are checked on save, on import and on duplicate. Every limit error has a typed `exc_type`, so the SPA can show a specific message. The client sorts every failure into blocking, retryable or offline, and only a server that never answered counts as offline (a lesson from Draw #417).

---

## 9. Realtime (ADR-003)

### 9.1 Model
The server is an **authorised relay**. It holds no Y.Doc and needs no Yjs library, so the same contract can be implemented in the Node handler (today) and the Python handler (later). Persistence stays on HTTP (§8.2).

Room name: `oqiva:board:<board name>`.

### 9.2 Events
| Client → server | Payload | Allowed for | Server action |
|---|---|---|---|
| `oqiva:join` | `{board, link_token?}` (with ack) | anyone | `frappe_request('/api/method/oqiva.api.realtime.authorize', {board, link_token})` → `{access}`. If access ≠ none: join the room, cache `{access, checked_at}`, ack `{access, peers}`. Otherwise ack `{access: null}`. |
| `oqiva:leave` | `{board}` | member of the room | leave the room and emit `oqiva:peer_left` |
| `oqiva:sync` | `{board, kind: "step1"\|"step2"\|"update", data: binary, to?}` | step1: any access. step2 and update: **Editor only** (re-authorised after `realtime_reauth_seconds`) | relay to `to` or to the room (excluding the sender). Payload ≤ 900 KB. |
| `oqiva:awareness` | `{board, data: binary}` | any access | relay to the room. ≤ 8 KB. At most 30 messages/s per socket; extra messages are dropped. |
| `disconnect` | – | – | emit `oqiva:peer_left {socket_id}` to each joined room |

| Server → client | Source |
|---|---|
| `oqiva:sync`, `oqiva:awareness`, `oqiva:peer_left` | relay |
| `oqiva:saved {board, revision}` | Python after a save commits |
| `oqiva:access_changed {board?, workspace?}` | Python after a revocation commits (user room) |
| `oqiva:resync {board}` | Python after a server-side change that must be reloaded (rare: purge, schema recovery) |

Viewers and commenters can send `step1` (to receive state) and awareness (so their cursor shows) but **never** `step2` or `update`. A `step2` carries document content, so relaying one from a viewer would be a write.

### 9.3 Joining and sync sequence
1. `board.get` over HTTP returns `crdt_state`. The client seeds its Y.Doc from that first and then merges y-indexeddb into it, so a cached copy merges with the server state instead of overwriting it.
2. `oqiva:join`, then the client broadcasts `step1` (its state vector). Editors already in the room reply with a targeted `step2` (only the missing deltas, usually small). From then on, `update` messages flow both ways.
3. **Too large:** an `update` or `step2` over 900 KB isn't sent. The sender saves over HTTP, and the server publishes `oqiva:resync`. Peers fetch `crdt_state` and merge it. Frappe's Node server uses socket.io's default 1 MB `maxHttpBufferSize`, so this cap stays below it.
4. **Presence:** Yjs awareness (name, colour, cursor, selection). The top bar shows avatars. Oqiva only showed cursors.

### 9.4 Offline
A y-indexeddb cache, keyed by board and user. On reconnect, the client merges the cache with the server `crdt_state`, then saves with stale-revision recovery. The "Saved" state appears only after an HTTP save is acknowledged (Oqiva rule §28).

### 9.5 Scaling
One socket server process per bench, so rooms live in that process. That's fine for one bench; Oqiva targets fewer than 100 editors per board. A multi-host deployment needs sticky sessions on the socket.io upstream. Oqiva gap #3 is partly addressed: tickets and rate limits move to Redis or the request path, and the rooms remain per process.

---

## 10. Sharing and links
- **Share with a person:** `share.with_user(board, user, level)` checks `board:share`. The target must be an enabled user and not Guest or Administrator. Unknown emails become a Pending Invite plus a User Invitation. It calls `frappe.share.add` with the level flags and `notify=0`, and Oqiva sends its own Notification Log entry (type Share).
- **Links:** `share.create_link(board, access, expires_in_days?, allow_anonymous?)` generates a 32-byte `secrets.token_urlsafe` token. It stores `hmac_sha256(key, token)` and returns the raw token **once** in the URL `/oqiva/s/<token>`. `allow_anonymous` is allowed only for Viewer links (D6).
- **Redeem** (`allow_guest`, rate-limited by IP): unknown, revoked, expired and trashed links all give the same 404. A logged-in user gets a Link Grant upsert and is redirected to `/oqiva/board/<name>`. A Guest with `allow_anonymous` sees the read-only viewer: canvas only, with zoom and pan but no comments and no export. Otherwise a Guest is sent to log in and then returned to the link. Each attempt writes an Audit Log entry (redeemed or rejected).
- **Revoking a link** sets `revoked_on` and clears `token_hash`. Grants die with the link (§5.9).

---

## 11. Comments, mentions, notifications
- **APIs:** list, add, reply, edit, delete, resolve and reopen, with `may` checks from §6.2. They are written from scratch, with Draw's comment features as the reference.
- **Content:** sanitised with `frappe.utils.html_utils.sanitize_html`, limited to 5,000 characters.
- **Mentions:** `@user` handles are resolved server-side against the board audience (workspace members with role ≥ Member, plus DocShares, plus grants). Unknown handles are ignored.
- **Realtime:** `oqiva:comment {board, op, comment}` is published to the board room after commit. This replaces Oqiva's 15 s polling.
- **Notifications:** Notification Log entries (`document_type = Oqiva Board`, so they respect the user's Notification Settings) for share, mention, reply, access changed and workspace invite. The SPA bell listens on the user room, which replaces Oqiva's 60 s polling.

---

## 12. Search
`search.query(q, limit=20)`:
- The query is trimmed to 2–100 characters, and `%` and `_` are escaped.
- Boards and projects go through `frappe.get_list`, which applies permission query conditions, so results are scoped before matching. Fields matched: title, description, project_name.
- Comments are matched on `content` through `frappe.get_list("Oqiva Comment")`, which inherits board scope.
- Results are grouped by type, with a deep link for each.
- There's no full-text index in v1. Phase 13 can measure whether one is needed.

---

## 13. Files and quotas
- **Image insert:** the engine's image tool uploads through `oqiva.api.board.upload_image`, which creates a private Frappe **File** with `attached_to_doctype = Oqiva Board` and `attached_to_name`. Frappe serves private files only when the user has read access to the attached document, and it does that through the session cookie, which fixes Oqiva gap #8.
- **Quota:** `doc_events["File"]` `before_insert` and `on_trash` hooks, filtered to `attached_to_doctype == "Oqiva Board"`, check and update `Oqiva Workspace.storage_used_bytes` under a `for_update` lock on the workspace row.
- **Anonymous viewers and private images:** see open question Q3 in §19.

---

## 14. Templates
Templates are stored as **Oqiva documents** with a `schemaVersion`, not as Oqiva 0.1's neutral spec (ADR-005). The engine's `parseDocument` migrates older schema versions forward, which is the problem the neutral spec existed to solve.

The 14 Oqiva templates are converted once in Phase 6 (task P6.06) by a Node script that uses the engine's own shape factories and layout engines, and the output is committed to `oqiva/seed/templates/*.json`. `setup.ensure_setup()` upserts them by `slug`. The gallery has categories, tags, search and previews.

**As built (P6.05).** Each seed file is `{slug, name, description, category, tags[], sort_order, document}`. The seed loads every `*.json` in the folder, validates it with the same checks a board save uses (so a template always makes a savable board), and writes a row only when the file's hash differs from the row's `source_hash`. That keeps the run idempotent, and it keeps an admin's later change, such as unpublishing a template, until the file itself changes. An invalid file is logged and skipped, never raised. The seed runs from `ensure_setup`, so it also runs after every migrate.

The DocType's `document`, `schema_version`, `object_count` and a small `preview` are recomputed on every save, in Desk or by the seed. Only System Manager and Oqiva Admin have DocPerms; users go through `template.list_templates` and `template.get_template` (role Oqiva User, published templates only, no document body). Each card carries its `preview` (boxes with fill, stroke and a 40-character caption, plus line ends, capped at 120 of each), so the gallery draws every thumbnail from one request. `board.create_board(..., template=slug)` makes the board from a server-side copy, records the slug in `Oqiva Board.template` (provenance only) and writes a `template_used` audit entry. An unknown or unpublished slug gives `OqivaNotFound`.

---

## 15. Frontend

| Route | Page |
|---|---|
| `/oqiva` | redirects to the current workspace dashboard |
| `/oqiva/welcome` | onboarding (skippable) |
| `/oqiva/w/:workspace` | dashboard |
| `/oqiva/w/:workspace/p/:project` | project |
| `/oqiva/w/:workspace/{recent,favourites,shared,templates,trash}` | home lists |
| `/oqiva/board/:board` | editor |
| `/oqiva/s/:token` | share-link redemption, or the anonymous viewer |
| `/oqiva/notifications`, `/oqiva/settings` | user pages |

- **Engine boundary:** the editor receives an `EngineHost` object with these ports: `persistence` (load, save, getCrdtState, onSaved), `comments`, `share`, `images`, `thumbnails`, `realtime` (a provider factory) and `capabilities`. The engine only talks to these ports, never to `oqiva.api` directly, so it stays testable without a server. An ESLint rule in `engine/` forbids `call(`, `createResource(`, `/api/method` and `oqiva.api`.
- **Realtime provider:** `OqivaSocketProvider` (about 250 lines) implements the y-protocols sync and awareness messages over `frappe-ui`'s socket.
- **Styling:** chrome uses frappe-ui components and token classes. The SVG canvas is the exception: it uses literal colours from per-board theme presets. Dark mode recolours chrome only, and the canvas stays light. Oqiva's design tokens are mapped onto the Espresso tokens.

### 15.1 Engine structure (own code, ADR-008)
| Layer | Folder | Responsibility |
|---|---|---|
| Model | `engine/model/` | Document schema, factories, ids (nanoid), migrations, pure operations (insert, update, delete, group, z-order). No Vue, no DOM. |
| Geometry | `engine/geometry/` | Transforms (one screen↔canvas transform), bounds, hit-testing, anchors, rotation, connector routing (straight, curved, elbow), snapping, alignment guides. Pure. |
| Store | `engine/store/` | One reactive store, the only place mutations happen. Command history (semantic operations, about 100 steps, one undo step per user action). Selection state. |
| Yjs bridge | `engine/collab/` | Store ↔ Y.Doc mapping (per-object entries, so edits to different objects merge cleanly), echo guard, `OqivaSocketProvider`, awareness, y-indexeddb. |
| Renderer | `engine/render/` | SVG components: shapes, connectors, text (Tiptap), images, tables, strokes, comment pins, selection chrome, grid, guides, minimap. **One render-to-SVG path** shared by the editor, viewer, export and thumbnails. |
| Interaction | `engine/interaction/` | Pointer and keyboard controllers: select, marquee, move, resize, rotate, draw shape, draw connector, text editing, pan and zoom. Key handling is mode-aware and ignores shortcuts while a text field has focus. |
| Modes | `engine/modes/{block,mindmap,flowchart,whiteboard}/` | Strategy objects declaring tools, key bindings, layout engine and palette sections for each object type. They are added to the shared editor, never a separate editor. |
| UI | `engine/ui/` | Toolbars, insert menus, shape library, right palette (Arrange, Align, Distribute, Fill, Border, Text, …), floating palette, export dialog. |

### 15.2 Document schema v1 (designed in Phase 3, task P3.01)
```
{ schemaVersion: 1,
  canvas:     { mode: "infinite"|"preset", preset?, width?, height?, background, grid },
  theme:      { preset },
  objects:    [ { id, kind: shape|text|sticky|image|table|stroke|frame|section,
                  x, y, w, h, rotation, z, style{fill,border,opacity,…}, text?, data?, link?, groupId? } ],
  connectors: [ { id, from:{objectId,anchor}|{x,y}, to:…, geometry: straight|curved|elbow,
                  heads:{start,end}, style, label?, controlPoint? } ],
  mindmaps:   [ { id, origin, rootId, nodes:[{id,parentId,order,text,collapsed,color,marker,note}],
                  crosslinks:[…] } ],
  flowcharts: [ { id, direction: TB|LR, numbered, nodes:[{id,type,text,x,y,manual}],
                  edges:[{id,from,to,label,order}] } ] }
```
Positions in mind maps are derived by the layout engine and never stored. Flowchart nodes store x/y plus a `manual` flag (Tidy clears it). Every item has a stable id. Arrays are keyed by id in the Y.Doc.

**As built (Phase 8).** In the store and the Yjs document the mind maps are three flat lists, `maps`, `mapnodes` and `crosslinks`; `store.snapshot()` nests them back into `mindmaps`. A node is `{id, mapId, parentId, order, text, collapsed, color, marker, note}`; the layout (`modes/mindmap/layout.js`) works out every box from the tree, `layouts.js` keeps it as a computed value per map, and `render/mindmapScene.js` describes how a map is drawn, for the editor and for export alike. The controller holds `maps` (the layouts) and does the node hit test, the drag to re-parent and the drop target; the keyboard maps to `mm.*` commands only while the selection is nodes (`nodesOwnKeys`). The bridge repairs a map after every remote change (`dropBrokenMaps`), and `parseDocument` repairs one on every read (`sanitizeMindmaps`).

**As built (Phase 9).** In the store and the Yjs document a flowchart is three flat lists, `charts`, `flownodes` and `flowedges`; `store.snapshot()` nests them back into `flowcharts`. `modes/flowchart/` holds the pure parts: `model.js` (types, sizes, limits), `ops.js` (every edit as a change set), `layout.js` (Tidy up, where a new step goes, how far a splice shifts what follows), `routing.js` (ports and orthogonal routes), `numbering.js`, `document.js` (clean and repair), `storeOps.js` (a change set as one undo step) and `commands.js` (`fl.*`). `layouts.js` keeps sizes and routes as a computed value per chart, and `render/flowchartScene.js` describes how a chart is drawn, for the editor and for export alike. The controller holds `flows` (the layouts), the step and arrow hit tests, the "+" handle drag, the drop onto an arrow, and tells the store where maps and charts are (`store.extraBounds`) so Fit and the bounds include them; the keyboard maps to `fl.*` only while the selection is steps and arrows (`flowOwnsKeys`). The bridge repairs a chart after every remote change (`dropBrokenCharts`), and `parseDocument` on every read (`sanitizeFlowcharts`).

---

## 16. Scheduled jobs (`scheduler_events`)
| Frequency | Job |
|---|---|
| hourly | prune versions beyond retention (for boards saved since the last run); prune expired Link Grants from the lookup cache |
| daily | purge trash older than `trash_retention_days`; prune Board View older than 90 days; prune Audit Log older than 365 days |

---

## 17. Install, migrate, uninstall
- **`after_install` and `after_migrate` → `setup.ensure_setup()`** (idempotent). It creates the roles, registers the `comment` permission type if it doesn't exist (skipped when Draw already registered it), adds the composite uniques from §5, upserts templates and creates Oqiva Settings defaults. It uses hooks, not patches, because patches are marked done on a fresh install (Draw's lesson).
- **`before_uninstall`:** delete Oqiva DocShares and Notification Logs whose `document_type` starts with "Oqiva". Remove the roles. Leave the `comment` permission type in place if Draw is installed.
- **`add_to_apps_screen`:** "Oqiva", route `/oqiva`, `has_permission → oqiva.api.boot.has_app_permission`.

---

## 18. Testing strategy
- **Python (FrappeTestCase):**
  - a `rules.may` table test covering every action × role × share;
  - service tests;
  - the IDOR matrix (`SECURITY_TEST_PLAN.md`);
  - save protocol: stale revision, replay, limits, concurrent saves under the row lock;
  - link lifecycle;
  - project trash cascade.
- **Frontend (vitest):** heavy unit tests on the pure engine layers (model operations, geometry, routing, layouts, hit-testing, transforms at 10%, 100% and 400% zoom, stroke thinning, paste-to-tree parsing, cycle prevention, edges kept through flowchart reflow). Also the adapters, `OqivaSocketProvider` (two in-memory peers) and stale-revision merge recovery. "It renders" is not a test on its own.
- **End-to-end (Playwright):**
  - Oqiva journey A (sign up → board → shapes → reload → persisted);
  - Oqiva journey B (share → co-edit → comment);
  - offline then reconnect;
  - revoke while open.
- **Gates:** ruff, semgrep (Frappe and Akhilam rules), `require_type_annotated_api_methods = True`.

---

## 19. Open questions for this review

| # | Question | Proposed answer |
|---|---|---|
| Q1 | Max objects per board: Oqiva allowed 10,000, while Draw's budget is 300 shapes at 60 fps. | Start at 3,000. The renderer spike (task P1.04) benchmarks 300, 1,000 and 3,000 objects and fixes the number. Viewport culling is planned from the start. |
| Q2 | Should Frappe Drive integration and Draw-style Collections be built? | Not in v1. Collections can be added after v1 if requested. |
| Q3 | Anonymous viewer and private images | Serve images to anonymous viewers through `oqiva.api.share.link_file(token, file)`, which checks the token and that the file is attached to the link's board. |
| Q4 | Should workspace ownership transfer be in v1? | The service exists (needed for "delete user"). The UI waits for Phase 13. |
| Q5 | Python realtime server | Ship `handlers.py` alongside `handlers.js` from Phase 5 (task P5.02), with the same contract and tests. Default to Node until the bench switches. |
| Q6 | Bench vs Draw coexistence | Both apps can be installed. They share nothing except the `comment` permission type. |

---

## 20. Implementation notes for Phases 1 and 2

Where the built code differs from, or settles, something in this document.

| Topic | What was built | Why |
|---|---|---|
| DocType permissions | **Oqiva User has read only.** Services write with `ignore_permissions` after checking the rules table, and each controller refuses any write that did not come from a service (`access/guard.py`). §4 said read, write and create. | A write permission would be dead weight, because the guard refuses the write anyway. Read-only is the stricter default. |
| API errors | There is no `oqiva_api` decorator. Typed errors propagate, and Frappe returns the class name as `exc_type` (404 for `OqivaNotFound`, 403 for `OqivaForbidden`, 417 for the rest). The SPA switches on `exc_type`. | A decorator that catches and re-wraps would hide the real HTTP status. |
| Boot | `boot.get_boot` is a **POST**. It grants the Oqiva User role, creates the personal workspace and applies pending invites. | A GET that writes is rolled back by Frappe. |
| Board content | `board.get_board` returns metadata and capabilities, not the document. `open_board` (POST) records the visit. The document, `save_document` and `get_crdt_state` arrive in P3.08. A new board's `document` is the empty document in `constants.py`, and `Oqiva Board.template` arrives with templates in Phase 6. | The editor does not exist yet. |
| Roles | `ensure_roles` corrects `desk_access` on a role that already exists. Frappe creates a role the moment a doctype that grants it is synced, with desk access on, before `after_migrate` runs. | Found while testing: Oqiva User had desk access. |
| Invites | A repeat invite updates the role. Each workspace holds at most 100 pending invites. If the site cannot send email, the invite is still saved and the API says `email_sent: false`. | Stops the invite box being used for mass email, and stops a mail misconfiguration blocking invites. |
| Listing | Services call `frappe.get_list(..., user=user)` so the permission-query conditions run for the user being checked, not only for the session user. | Makes the services testable and safe to call from jobs. |
| Frontend library | frappe-ui **0.1.278** (the version WorkBoard uses), Vue 3.5, Tailwind 3. `rollup` is pinned to 4.63.5 in `frontend/package.json`: 4.67 crashes with "illegal instruction" on this server's CPU, which has no AVX2. | Newer versions are untested here. |
| Icon buttons | frappe-ui's `Button` overwrites `aria-label` with its `label` prop, so icon-only buttons carry a `title` instead, which also names them for screen readers. | Found by the browser test. |
| Socket in the SPA | frappe-ui's socket is switched off (`FrappeUI` option `socketio: false`) until Phase 5. | It tried to open a connection nothing listens to. |
| Onboarding | `/welcome` asks for a workspace name only. Role chips were left out. | They changed nothing yet. |
| Semgrep | The official Frappe semgrep rules report 0 findings on `oqiva/`, `realtime/` and `scripts/`. | Part of P1.10. |

---

## 21. Implementation notes for Phase 3 (canvas engine core)

The engine lives in `frontend/src/engine/`. Its layers follow section 15.1, and a test (`boundary.test.js`) fails if any engine file calls the server, so the engine can be tested and reused on its own.

| Layer | Files | What it does |
|---|---|---|
| Model | `model/` | Document schema v1 with `parseDocument` (migrates, clamps, drops what cannot be drawn, keeps object kinds from newer versions), themes, shape geometry, factories |
| Geometry | `geometry/` | The one screen to board transform (zoom 10-400% about the cursor, fit, pan clamping), rotated bounds, outline-accurate hit testing, resize and rotation maths in the object's own frame |
| Text | `text/` | Rich text model, wrapping layout, auto height, conversion to and from Tiptap (ADR-010) |
| Store | `store/` | Operations (add, remove, update, canvas, theme), each returning its inverse; history of up to 100 steps with coalescing; gestures that turn a drag into one step; selection, limits |
| Interaction | `interaction/` | A pointer controller driven by plain event objects, a pure keymap, commands, view helpers |
| Render | `render/`, `ui/` | `BoardCanvas` (grid, page, only the objects on screen), `ShapeView`, selection overlay, text editor overlay, floating palette, save indicator, shortcuts dialog |
| Persistence | `persistence/` | An autosave state machine (1.5 s debounce, retry with backoff, retry-safe save ids, conflict stop), failure classification |

Decisions and behaviour worth knowing:

- **Objects are values.** An edit replaces an object, so an unchanged object is the same object. Vue skips redrawing it, and bounds are cached per object.
- **Every change is an operation** with a recorded inverse, so undo never stores pointer positions. The same stream will feed realtime in Phase 5. Savers hear about a finished step, never about the frames of a drag.
- **Only what is on screen is drawn** (plus a margin), and no text is drawn below 35% zoom (ADR-009). A board opened framed to fit shows every object, so it draws them all, without text.
- **Saved honestly.** The indicator says Saved only after the server confirmed. A retry of unchanged content reuses its save id, so a save whose reply was lost is recognised and not reported as a conflict. A real conflict stops saving and keeps the board read-only until reload.
- **A new empty text box leaves no trace**: its creation is taken back out of history, so it cannot be redone either.
- **The board page follows the route.** It takes the board name as an argument when it sends a request, and clears the previous board while the next one loads. A browser run found it asking for a board after the person had already left.
- **Limits.** Server and client both enforce the object limit (`max_objects_per_board`) and the document size limit. Lowering a limit never stops an existing board opening.
- **Settings are numbers.** Frappe returns a Long Int setting as text, so `get_setting` converts every value. A test found this when a size comparison failed.
- **Tests that change settings put them back** (`RestoresSettings`), because Frappe rolls back only when a test class ends.
- **The one test that commits** (`TestConcurrentSaves`) deletes only the rows it made, and only `@oqiva.test` users.

## 22. Implementation notes for Phase 4 (connectors, right palette, export)

| Area | Files | What it does |
|---|---|---|
| Lines | `geometry/connectors.js`, `model/connectorTools.js`, `render/ConnectorView.vue`, `render/connectorPaths.js` | Anchors, snapping, fan-out, straight, elbow and curved routes, hit testing, a cached path per line |
| One drawing path | `render/nodes.js`, `render/SvgTree.js` | Every object and line is described as plain data, drawn on screen by `SvgTree` and turned into a string by `serializeNode` for export |
| Store | `store/createStore.js`, `store/clone.js`, `store/arrange.js`, `store/tableOps.js` | Two lists (objects, lines) under one set of operations; pure functions for z-order, align, distribute, size, rotate, flip, groups and tables |
| Interaction | `interaction/{controller,actions,palette,clipboard,guides,images,placement,tables}.js` | Line tools and handles, hover arrows, palette rules and actions, clipboard, smart guides, edge auto-pan, picture insertion |
| Export | `export/{scene,svg,pictures,raster,files,exporter,thumbnail}.js` | What an export holds, the SVG, embedding pictures, PNG/JPEG/PDF, download and print, thumbnails |
| UI | `ui/{RightPalette,PaletteTile,ColorSwatches,ExportMenu,LineLabelEditor,TableSizePicker}.vue` | The panel on the right, the colour grid, the Export menu, line labels, the table size picker |
| Backend | `services/{file_service,export_service,audit_service}.py`, `api/export.py`, Oqiva Audit Log | Picture and thumbnail storage, quota, export check and audit, validation of lines, pictures and tables in `document_service.py` |

Things worth knowing:

- **Gestures cover both lists.** A drag that moves shapes and free lines is one undo step. Deleting a shape removes its lines in the same step.
- **Guides** compare the dragged box with the boxes of the other objects on screen (and the page of a preset board) within 6 screen pixels; they let go as soon as the pointer moves on, and Alt turns them off.
- **Auto-pan** is one animation-frame loop that does nothing unless a drag is under way. The controller stays free of timers: the canvas calls `autoPanTick(elapsed)`.
- **Clipboard** is held in memory and survives moving between boards in one tab. Pasting a picture from the system clipboard goes through the browser's paste event, because that is the only way to receive a file.
- **Keyboard and overlays.** While a menu, popover or dialog is open the editor ignores its own shortcuts, so Escape closes the menu instead of clearing the selection behind it (found in a browser run: the editor's handler ran first and marked the key as handled).
- **Form controls.** A slider or checkbox does not count as typing, so Ctrl+Z still undoes after dragging one.
- **Recent colours** are kept in this browser's local storage, never in the document.
- **Server validation** now covers lines (ids, ends, shapes, arrowheads, bend, style, label), pictures (address must be a private file path) and tables (rows 1-30, columns 1-20, cell text and fills, 50,000 characters in all), as well as flips and groups. The client drops what it cannot draw; the server refuses it.
- **Tests that touch files** delete the File rows they make, which also removes the files from disk.
- **Browser run.** `e2e/phase4.e2e.mjs` covers lines, the palette, clipboard, guides, auto-pan, pictures, tables, every export format (it reads the downloaded bytes back), print, thumbnails and the home tile. A fresh pair of test users is best for each full run, because the workspace menu grows with every run.

## 23. Implementation notes for Phase 5 (collaboration and sharing)

| Area | Files | What it does |
|---|---|---|
| Sharing | `services/share_service.py`, `api/share.py`, `components/ShareDialog.vue` | Share by name or email at view, comment or edit (never share-again), change and revoke, leave, waiting invites that turn into shares when the person arrives |
| Links | `services/link_service.py`, doctypes Oqiva Share Link and Link Grant, `views/ShareLinkView.vue`, `components/ShareLinks.vue` | Hashed secrets, grants, revoke cascade, the redeem page, the anonymous read-only viewer, pictures for visitors |
| Access everywhere | `access/resolve.py`, `access/hooks.py`, `board_service.py` | Link grants count in single-board access, bulk capabilities, the list permission hook and "Shared with me" |
| Realtime (server) | `realtime/handlers.js`, `utils/realtime.py` | The relay (join, editors-only writes, caps, throttle, re-check every 15 s) and the pushes after commit: `oqiva:access_changed`, `oqiva:saved`, `oqiva:resync`, `oqiva:comment` |
| Collaboration (browser) | `engine/collab/{ydoc,bridge,provider,presence,session}.js` | The Yjs layout, store bridge, socket provider, presence, the offline copy |
| Saving | `persistence/autosave.js`, `document_service.py` | `crdt_state` with every save, `get_crdt_state`, merge-before-retry, `resync` |
| Comments | `services/comment_service.py`, `api/comment.py`, `engine/comments/`, `ui/Comment{Panel,Pins,Composer}.vue` | Threads, mentions, pins that follow shapes, resolve, flags for removed shapes |
| Notifications | `services/notification_service.py`, `api/notification.py`, `data/notifications.js`, `components/Notification{Bell,List}.vue`, `views/NotificationsView.vue` | The person's Oqiva notifications, the bell and page, kept current by Frappe's own live "notification" event |

Things worth knowing:

- **Tests run as Administrator, people do not.** Services that call Frappe's own helpers (`frappe.share.remove`, which checks the *caller's* share permission) passed every test and failed for a real member in the browser. `TestAsTheRealPerson` runs the share services as a normal member to keep this honest.
- **Bulk code paths must know every kind of access.** The board list built capabilities from shares only, so a person who had opened an Editor link saw a view-only board. Capabilities, the list hook and "Shared with me" now all read link grants.
- **The relay is tested without a database.** `realtime/harness/relay.test.mjs` runs the real `handlers.js` on a socket.io server whose authorize call is scripted (`node --test realtime/harness`). It needs `apps/frappe/node_modules` for socket.io.
- **The bench's socket server runs the handler it loaded at start.** After changing `handlers.js`, restart that process. It asks the web server for access using the port in the bench config.
- **Browser runs.** `collab.e2e.mjs` (three people, presence, live sync, revocation, offline merge), `comments.e2e.mjs` (comments, mentions, bell, notifications page) and `phase5.e2e.mjs` (sharing and links) need a fresh trio of test users each, and the bench's socket server.
- **Stale-save replies are normal.** A 417 from `save_document` is the answer that makes an editor merge and retry; the browser runs treat it as expected.

