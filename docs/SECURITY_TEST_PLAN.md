# Oqiva on Frappe — Permission, IDOR and Security Test Plan

These cases are written as `FrappeTestCase` (Python) unless marked **[E2E]** (Playwright) or **[RT]** (realtime harness: two socket.io clients against the bench). Each row says which part of `ARCHITECTURE.md` it proves. Phase 1 implements the rules-table and IDOR suites. Later phases add their rows.

## Fixtures
Workspace **W1**: Owner `o@`, Admin `a@`, Member `m@`, Member `m2@`, Guest `g@`.
Workspace **W2**: Owner `x@` (unrelated to W1).

Board **B1** in W1, project P1, created by `m@`.
Shares on B1:
- `sv@`: DocShare view
- `sc@`: DocShare comment
- `se@`: DocShare edit
- `g@`: none; a second board **B2** is shared with `g@` at view

Link **L1** on B1 (Editor) redeemed by `le@`. Link **L2** on B1 (Viewer, `allow_anonymous`).

## 1. Rules table (`access.rules.may`), pure unit tests
- **T1.1** Every action in ARCHITECTURE §6.2, crossed with each role (Owner, Admin, Member, Guest, none) and each share (none, Viewer, Commenter, Editor), matches the expected truth table. The table is generated from §6.2, so a change to the doc without a change to the code fails the test.
- **T1.2** When both a role and a share apply, the more permissive one wins (Guest + Editor share → can edit).
- **T1.3** A share never grants trash, archive, duplicate, share management or project/workspace actions.
- **T1.4** An Admin can't demote or remove the Owner. An Admin can't demote another Admin. The Owner can't leave.

## 2. IDOR: unrelated user `x@` against W1 resources
Every case must return **404** (`DoesNotExistError`), never 403 and never data. This applies to both the whitelisted API and the generic `/api/resource` route.

| # | Target | Calls |
|---|---|---|
| T2.1 | B1 | `board.get`, `save_document`, `rename`, `move`, `duplicate`, `trash`, `restore`, `purge`, `favourite`, `export.prepare`, `export.board_json`, `version.list`, `version.get`, `share.list`, `share.create_link`, `realtime.authorize` |
| T2.2 | B1 via REST | `GET /api/resource/Oqiva Board/<B1>`, `GET /api/resource/Oqiva Board?filters=[["workspace","=","W1"]]` returns an empty list, `PUT` and `DELETE` |
| T2.3 | Comments, versions, links of B1 | `GET /api/resource/Oqiva Comment?filters=[["board","=",B1]]` is empty; `GET` by name gives 404; the same for Oqiva Board Version and Oqiva Share Link (`token_hash` never readable) |
| T2.4 | W1, P1 | `workspace.members`, `project.list`, `project.update`, `GET /api/resource/Oqiva Workspace Member?...` is empty |
| T2.5 | Search | `search.query("<B1 title>")` and `search.query("<comment text on B1>")` return nothing |
| T2.6 | Files | a private image File attached to B1 can't be downloaded (`/private/files/...` gives 403 or 404) |
| T2.7 | Notifications | `x@` can't read the Notification Log rows of W1 users |

## 3. Role and share boundaries on B1
- **T3.1** `g@` (Guest, no share): `board.get(B1)` gives 404, and B1 is absent from lists and search. `board.get(B2)` works. *(Fixes Oqiva gap #7.)*
- **T3.2** `sv@`: get and export work. save, rename and comment give 403. `realtime.authorize` returns Viewer.
- **T3.3** `sc@`: comment and resolve work. save gives 403.
- **T3.4** `se@`: save and rename work. `move` to P2 gives 403 because they aren't a member. `trash`, `duplicate` and `share.with_user` give 403.
- **T3.5** `m2@` (Member, not creator): edit works. trash B1 gives 403. `a@` can trash B1. `m@` (creator) can trash B1.
- **T3.6** `m2@` can't revoke `se@`'s share, which was created by `m@`. `m@` and `a@` can. *(Fixes Oqiva gap #6.)*
- **T3.7** The `comment:edit` author check: `a@` can delete `m@`'s comment but can't edit it.
- **T3.8** System Manager (not Administrator) with no membership gets 404 on B1. *(Draw #73 regression.)*

## 4. Share links
- **T4.1** A token is shown once. The database stores only `token_hash` and `token_hint`. `token_hash` isn't in any API response.
- **T4.2** Unknown, revoked, expired and trashed-board tokens all return the same 404 body and status. Response time is not asserted.
- **T4.3** Revoking L1 removes `le@`'s access immediately (`board.get` gives 404) because the grant is no longer live.
- **T4.4** The redeem rate limit allows 20 per minute per IP; the 21st gets 429.
- **T4.5** `allow_anonymous` can't be set on Commenter or Editor links (validation error).
- **T4.6** Anonymous L2: Guest `public_board(token)` works and is read-only. `comment.add` and `save_document` as Guest are rejected. A private image on B1 loads only through `share.link_file(token, file)`. A file attached to a different board through the same token gives 404.
- **T4.7** Redeem attempts are written to Oqiva Audit Log (redeemed or rejected) without the raw token.

## 5. Save protocol and limits
- **T5.1** `base_revision` lower than the stored revision raises `OqivaStaleRevision` with the server revision.
- **T5.2** Replaying the same `save_id` returns the same revision and writes nothing.
- **T5.3** Two concurrent saves on separate DB connections, both at base N: exactly one succeeds and the other is stale. This proves the row lock.
- **T5.4** Too large, too many objects, `schemaVersion` greater than supported, and invalid base64 `crdt_state` are each rejected with a typed error, and nothing is written.
- **T5.5** Comment `object_missing` is set when a shape is removed and cleared when it returns.
- **T5.6 [E2E]** Two editors whose realtime link is cut (the socket is blocked for one of them) both keep drawing. After reconnecting, the final stored document has **both** editors' shapes, which proves merge-before-retry (fixes the race Draw documents in `useAutosave.js`).

## 6. Realtime [RT]
- **T6.1** `join` without access acks `{access: null}` and receives no room traffic.
- **T6.2** A viewer emitting `update` or `step2`: nothing reaches other clients, and the editors' documents don't change.
- **T6.3** Awareness over 8 KB is dropped. More than 30 messages per second are throttled.
- **T6.4** `se@`'s share is revoked while they are connected. They receive `oqiva:access_changed`. A tampered client that ignores it and keeps emitting `update` stops being relayed within 15 s.
- **T6.5** A user disabled while connected: writes stop within 15 s.
- **T6.6** A user on another site (multi-tenant namespace) can't join a room on this site.
- **T6.7** Payloads over 900 KB are refused by the client provider and fall back to HTTP save plus `oqiva:resync`.

## 7. Input safety
- **T7.1** Comment content containing `<script>`, `onerror=` or `javascript:` links is sanitised in storage and when rendered.
- **T7.2** Board and project names: NFC normalisation, control and bidi characters stripped, 120-character cap. Emoji and non-Latin text are accepted.
- **T7.3** Search: `%` and `_` in the query are escaped and match literally.
- **T7.4** Imported `.oqiva.json`: an unknown `format`, a schema that is too new, or a size over the limit are rejected. SVG or HTML inside text fields doesn't run (rich text is sanitised by the engine on import and on render, with DOMPurify and an allow-list).
- **T7.5** Every state-changing endpoint rejects GET (POST only, the Draw #422 lesson).
- **T7.6** Generic REST `POST /api/resource/Oqiva Board` with a valid payload is rejected by the `flags.oqiva_service` guard.

## 8. Lifecycle
- **T8.1** Trashing project P1 trashes its live boards with `trashed_with_project=P1`. Restoring the project restores exactly those boards, not boards trashed earlier on their own.
- **T8.2** Restoring a board whose project is still trashed puts it at the workspace root.
- **T8.3** The trash purge job removes a board trashed 31 days ago along with its versions, comments, links, grants, favourites, views and DocShares. A board trashed 29 days ago is kept.
- **T8.4** Personal workspace: exactly one per user, even under concurrent first visits (the unique `personal_of` constraint). It can't be deleted.
- **T8.5** Version retention: after 60 Auto versions, 50 remain, and Named and pinned versions survive.

## 9. Pictures, thumbnails and export (Phase 4)
Where each is tested is noted in brackets. `test_files.py` is the backend file, `phase4.e2e.mjs` the browser run.

- **T9.1** An uploaded SVG, HTML, script or executable is refused whatever its name or claimed type, and the refusal is recorded in the audit log. Only PNG, JPEG, GIF and WebP are accepted, recognised by their first bytes. [`TestSniffing`, `TestUpload`]
- **T9.2** The name the browser sends never reaches the disk: files get random names. [`TestUpload`]
- **T9.3** A picture over `upload_max_bytes` is refused. A workspace over `workspace_storage_bytes` cannot add more; deleting a file gives the space back; storage is counted per workspace. [`TestUpload`]
- **T9.4** Only people who may edit a board can upload to it or set its thumbnail; a stranger gets a not-found, a viewer a forbidden. [`TestUpload`, `TestThumbnail`]
- **T9.5** A picture's file can be fetched by those who may view its board and by nobody else. [`TestUpload` (file permission); browser run, a second signed-in person is refused]
- **T9.6** A document with a picture address that is not a private file of a board the saver may view (a public file, an outside URL, `..`, a `data:` URI, a file of a hidden board, a file attached to nothing) is refused at save. [`TestImagesInDocuments`, `TestRichObjects`]
- **T9.7** Lines, pictures and tables with malformed or out-of-range data are refused at save, as are repeated ids and non-hex colours; an object kind from a newer version is still kept. [`TestRichObjects`]
- **T9.8** A thumbnail must be a PNG of at most 256 KB; replacing it deletes the previous file; setting it does not change the board's modified time. [`TestThumbnail`]
- **T9.9** `export.prepare` needs `board:export` (a Guest needs a share), refuses unknown formats and scopes, writes an audit entry with the user, board, format and scope, gives a file name with only letters, digits, dashes and spaces, and is limited to 20 a minute per user. [`TestExport`]
- **T9.9a** Purging a board deletes its pictures and thumbnail files and gives the storage back. [`TestPurge`]
- **T9.10** The audit log cannot be written outside a service, and entries older than 365 days are pruned. [`TestAuditLog`]
- **T9.11** An exported SVG contains no link to a private file and no script; text, labels and picture descriptions are escaped. [`export.test.js`, browser run]

## 10. Phase 5 coverage (sharing, links, comments, collaboration)
Where each case of sections 3 to 6 is proved. `test_sharing.py`, `test_links.py`, `test_comments.py`, `test_notifications.py` and `test_phase5_api.py` are backend; the relay harness is `realtime/harness/relay.test.mjs`; browser runs are in `e2e/`.

- **T3.2, T3.3, T3.4** view, comment and edit boundaries through the endpoints. [`test_phase5_api.py` TestSharedPeopleBoundaries]
- **T3.6** a member cannot revoke a share someone else made; the board's creator, an Admin and the sharer can. [`test_sharing.py` TestChangingAndRevoking]
- **T3.7** the comment author edits, an Admin deletes but cannot edit. [`test_comments.py` TestEditingAndDeleting]
- **T4.1 to T4.3, T4.5** secrets shown once and only hashed; uniform not-found; revoke ends access at once; no anonymous Commenter or Editor links. [`test_links.py`]
- **T4.4** the 21st redemption in a minute from one address is refused. [`test_phase5_api.py` TestRedeemRateLimit]
- **T4.6** a visitor sees the board read-only; every signed-in endpoint refuses a Guest; a picture comes only through the link and only the board's own. [`test_links.py` TestVisitorsWhoAreNotSignedIn, `test_phase5_api.py` TestGuests; browser `phase5.e2e.mjs`]
- **T4.7** redeem attempts are written to the audit log without the secret. [`test_links.py`]
- **T5.1 to T5.4** stale save carries the server revision; replay returns the same result; the save lock; an invalid or oversized collaboration state is refused and nothing is written. [`test_document.py` TestCollaborationState and earlier]
- **T5.5** comments are flagged when their shape is removed and cleared when it returns. [`test_comments.py` TestPinsFollowTheBoard]
- **T5.6** two people who lose the connection both keep drawing and both shapes survive; offline work is saved on return. [`collab.e2e.mjs`; merge logic in `bridge.test.js`, `provider.test.js`, `autosave.test.js`]
- **T6.1 to T6.7** join without access, viewers cannot write, awareness caps and throttle, revoked and disabled people cut off within the window, other sites cannot reach a room, oversized payloads refused. [`realtime/harness/relay.test.mjs`; the revocation seen live in `collab.e2e.mjs`]
- **T2.1, T2.3** a stranger gets not-found from every new endpoint, and the generic list and read layer shows no comments of boards they cannot see. [`test_phase5_api.py` TestOutsiderCannotReachTheNewSurface, `test_comments.py` TestWhoCanSeeCommentsThroughFrappe]
- **T7.1** comment text is stored as plain text and shown as text; markup never runs. [`test_comments.py` TestAdding; browser `comments.e2e.mjs`]
- **Not covered:** a peer with edit rights storing a corrupt collaboration state is handled by every loader sanitising (unit-tested in `bridge.test.js`) but not by the server, which cannot read it.

