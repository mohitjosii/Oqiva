# Oqiva on Frappe — Phase-wise Development Plan and Tasks

| | |
|---|---|
| Date | 2026-10-31 |
| Basis | `ARCHITECTURE.md` Rev 1.1 · `DECISIONS.md` (ADR-001 to ADR-008) · `DRAW_FEATURE_REFERENCE.md` (DF-…) · `SECURITY_TEST_PLAN.md` (T…) · `OQIVA_SPECIFICATION.md` |
| Approach | A new Frappe app `oqiva` with its **own canvas engine** (ADR-008). Draw is a reference only. |
| Supersedes | The phase list in `OQIVA_FRAPPE_PLAN.md` §7. That plan assumed Draw's code would be copied. |

## How to read this
- **Task ID** `P<phase>.<nn>`. **Lane**: BE (Python and DocTypes), FE (SPA shell), ENG (canvas engine), QA, PO (product-owner decision).
- **Days** are ideal developer-days for one experienced Frappe and Vue developer. Weeks = days ÷ 5, rounded up, plus about 10% buffer per phase.
- **Refs** point at the feature (DF-…), test (T…) or architecture section (§…) the task delivers.
- **Definition of done for every task:**
  - code and unit tests;
  - ruff, semgrep (Frappe and Akhilam rules), eslint and prettier all green;
  - typed whitelisted APIs (POST for writes);
  - docs updated if behaviour changed;
  - reviewed and committed.
- **Every phase ends with a review gate:** a demo against the acceptance criteria plus sign-off before the next phase starts (the WorkBoard practice).

## Milestones
| Milestone | After phase | What you get | 1 developer | 2 developers (§Team) |
|---|---|---|---|---|
| **M0** Architecture signed off | 0 | Docs (done 2026-10-31) | – | – |
| Foundation and home area | 2 | Phases 1 and 2 built 2026-11-01, awaiting review | – | – |
| **M1 MVP** (internal UAT) | 7 | Oqiva parity for block diagrams: workspaces, projects, boards, editor, connectors, shape library, templates, realtime, comments, sharing, versions, export and import | ~25 weeks | ~15–16 weeks |
| **M2 v1** | 10 | MVP plus Draw-level mind maps, flowcharts and whiteboard | ~34 weeks | ~23–25 weeks |
| **M3 v1.1** | 13 | Feedback, admin console, AI and hardening, release | ~40 weeks | ~27–28 weeks |

---

## Phase 0: Architecture ✅ (signed off 2026-10-31)
| ID | Task | Status |
|---|---|---|
| P0.01 | ARCHITECTURE, DECISIONS, SECURITY_TEST_PLAN | Done |
| P0.02 | Amendment: own engine (ADR-008), Draw feature reference, this plan | Done |
| P0.03 | Licence choice (ADR-002): **MIT** | Done (2026-10-31) |

---

## Phase 1: Foundation and spikes ✅ (built 2026-11-01, awaiting review gate)

> **Status.** All 11 tasks are done. `bench run-tests --app oqiva` passes (90 tests), the frontend suite passes (20 tests), the Frappe semgrep rules report 0 findings, and the dependency licence check passes (245 shipped packages). Spike results are in ADR-003 and ADR-009. Differences from the plan are listed in ARCHITECTURE.md, "Implementation notes for Phases 1 and 2". The CI workflow is written but has not run on GitHub yet.
**Goal:** installable app, data foundation, permission model, SPA shell, and the two technical risks retired.

| ID | Lane | Task | Refs | Days | Depends |
|---|---|---|---|---|---|
| P1.01 | BE | `bench new-app oqiva` (MIT licence). Install on `frappe.com`. Git repo, pre-commit (ruff, semgrep, eslint, prettier). Move `oqiva-docs/` to `apps/oqiva/docs/`. | §3 | 0.5 | P0.03 |
| P1.02 | BE | Roles (Oqiva User, Oqiva Admin), **Oqiva Settings**, `setup.ensure_setup()` (roles, `comment` permission type, composite uniques), `after_install`, `after_migrate`, `before_uninstall` | §4, §17, L4, L5 | 1 | P1.01 |
| P1.03 | ENG | **Realtime spike:** a minimal `realtime/handlers.js` (join and authorise, relay sync and awareness) plus two browser tabs syncing a Y.Doc. Prove: viewer `update`/`step2` dropped; 1,000-object initial sync size; revocation within 15 s; offline then reconnect. Record go/no-go in ADR-003. | ADR-003, T6.1–T6.4 | 3 | P1.01 |
| P1.04 | ENG | **Renderer spike:** SVG with 300, 1,000 and 3,000 objects (shape plus text). Drag at 60 fps, pan and zoom, viewport culling. Fix `max_objects_per_board`. | Q1 | 2 | P1.01 |
| P1.05 | BE | DocTypes **Oqiva Workspace**, **Workspace Member**, **Project**, **Board** (fields from §5) with the `flags.oqiva_service` write guard | §5.2–5.5 | 1.5 | P1.02 |
| P1.06 | BE | `access/`: `resolve` (AccessContext), `rules.may`, `capabilities`; `has_permission` and query-condition hooks; `exceptions.py` (OqivaNotFound, OqivaForbidden, …); `oqiva_api` typed-error decorator | §6 | 2 | P1.05 |
| P1.07 | BE | Services and APIs: workspace (create, rename, delete, members, change role, remove, leave), project (create, update, archive, trash, restore), personal workspace on first boot (unique `personal_of`) | §6.2, §5.2 | 2 | P1.06 |
| P1.08 | FE | SPA shell: Vite + Vue 3 + frappe-ui, `www/oqiva.html` and `oqiva.py` (boot, lazy role grant), router skeleton, login redirect, dark mode for chrome, `add_to_apps_screen` | §15 | 2 | P1.01 |
| P1.09 | QA | Tests: rules table **T1.1–T1.4**; IDOR **T2.4**, plus T2.1–T2.2 for the API surface that exists; **T3.8**; personal workspace **T8.4** | SECURITY_TEST_PLAN | 2 | P1.07 |
| P1.10 | QA | CI (GitHub Actions): ruff, semgrep, vitest, `bench run-tests --app oqiva` on a service MariaDB | – | 1 | P1.01 |
| P1.11 | QA | Dependency licence check in CI (allow-list from ADR-008) | ADR-002, ADR-008 | 0.5 | P1.10 |

**Acceptance:**
- The app installs, migrates and uninstalls cleanly.
- A new user gets exactly one personal workspace.
- Workspace and project APIs follow the §6.2 matrix.
- Unrelated users get 404.
- Both spikes have a recorded decision.
- CI is green.

---

## Phase 2: Home area ✅ (built 2026-11-01, awaiting review gate)

> **Status.** All 9 tasks are done. A browser run of the home area (`e2e/home.e2e.mjs`, 14 steps) passes against the running site. Gaps against the plan: the `/welcome` page asks only for a workspace name (no role chips), and there is no board editor yet (the board page is a placeholder until Phase 3).
**Goal:** everything outside the canvas: navigate, organise, find and trash boards.

| ID | Lane | Task | Refs | Days | Depends |
|---|---|---|---|---|---|
| P2.01 | BE | Board services and APIs: create (blank), rename, description, move, duplicate, archive, trash, restore, purge, favourite; **Oqiva Board View** recents; **Oqiva Favorite**; project trash cascade (`trashed_with_project`); daily purge job | §7.1, §7.5–7.6, §16 | 3 | P1.07 |
| P2.02 | FE | Sidebar, workspace switcher, create and rename workspace dialogs, collapsible sidebar (preference) | – | 1.5 | P1.08 |
| P2.03 | FE | Dashboard: grid and list toggle, 12 most recent boards, "New board", first-run empty state; board tile with thumbnail or placeholder and ⋯ menu (rename, description, duplicate, move, favourite, trash) | DF-D9 | 2 | P2.01 |
| P2.04 | FE | Project page, create and edit project dialog (name, description, colour token, icon), archive and trash | – | 1.5 | P2.01 |
| P2.05 | FE | Recent, Favourites, Shared with me and Trash pages (restore; permanent delete after typing the board name) | – | 1.5 | P2.01 |
| P2.06 | BE+FE | Members and invites dialog: change role, remove, leave; invite a registered user (added at once) or an email (**Oqiva Pending Invite** plus User Invitation, converted on sign-up) | §5.9 | 2 | P1.07 |
| P2.07 | BE+FE | `search.query` (scoped before matching, LIKE wildcards escaped) and a Ctrl/Cmd+K dialog grouped by type | §12 | 1.5 | P2.01 |
| P2.08 | FE | `/welcome` onboarding (skippable); shared empty, loading and error states; 404 page | – | 1 | P1.08 |
| P2.09 | QA | Tests **T2.1–T2.5** (board part), **T3.1, T3.5**, **T7.2, T7.3, T7.5, T7.6**, **T8.1–T8.3** | – | 1.5 | P2.07 |

**Acceptance:** the full home journey works. Search never returns inaccessible items. Trash, restore and purge behave as in §7.5.

---

## Phase 3: Canvas engine core (about 4.5 weeks)
**Goal:** a block-diagram editor that persists: shapes, selection, transforms and text.

| ID | Lane | Task | Refs | Days | Depends |
|---|---|---|---|---|---|
| P3.01 | ENG+BE | **Document schema v1:** factories, nanoid ids, `parseDocument` and migrations, server-side structural validation and limit counting | §15.2, ADR-005 | 2 | P1.04 |
| P3.02 | ENG | Store plus command history (semantic operations, transactions folded into one undo step, about 100 steps), selection state | DF-E4, L10 | 2 | P3.01 |
| P3.03 | ENG | Viewport: **one** screen↔canvas transform; zoom 10–400% centred on the cursor; pan (scroll, Shift+scroll, Space, hand tool); Fit and 100%; scrollbars; infinite and preset canvas with an elastic pan area; background; grid (2 densities); floating bottom palette | DF-C1–C7, L8 | 3 | P3.02 |
| P3.04 | ENG | SVG renderer with **one render-to-SVG path** (editor, viewer, export, thumbnails) and viewport culling | L11 | 2 | P3.03 |
| P3.05 | ENG | Basic shapes and the draw tool (click to draw, drag and drop, dashed preview, Shift for 1:1), polygon side picker, block arrows, text box, designed defaults, theme presets | DF-S1–S3, DF-P11 | 2.5 | P3.04 |
| P3.06 | ENG | Selection (click, Shift+click, marquee, select all, Esc), move, 8-handle resize (Shift keeps ratio), rotation handle with 15° snap, flip | DF-E1, DF-S4–S5 | 3 | P3.05 |
| P3.07 | ENG | Text: Tiptap editing inside shapes, 12 px padding, wrap and auto-grow, inscribed rectangle for diamond and triangle, size/B/I/U/colour/alignment, auto-fit; double-click empty canvas creates a shape | DF-T1–T5 | 3 | P3.06 |
| P3.08 | ENG+BE | Editor page plus **EngineHost** ports. Persistence adapter: load, autosave (1.5 s debounce, `save_id`, revision), save indicator, failure classification. `board.save_document` with the row lock, limits and replay handling. | §8.2, DF-D1, L6 | 2.5 | P3.01 |
| P3.09 | ENG | Duplicate, delete, nudge; mode-aware keymap that is ignored while editing text; shortcut reference dialog (`?`) | DF-E2, DF-E5, L9 | 1 | P3.06 |
| P3.10 | QA | Tests: transforms at 10, 100 and 400% after a pan; hit-testing; history; schema migrations; **T5.1–T5.4** | – | 2 | all |

**Acceptance:**
- Draw, select, move, resize, rotate and edit text on shapes.
- Undo and redo work reliably.
- Edits persist within about 1.5 s and survive reload.
- A stale save is blocked server-side.
- 60 fps drag at the Phase 1 benchmark size.

---

## Phase 4: Connectors, right palette, export (about 5 weeks)
| ID | Lane | Task | Refs | Days | Depends |
|---|---|---|---|---|---|
| P4.01 | ENG | Anchors (8 per shape, rotate with it, shown only while connecting), the six connector tools, snap to anchor, unattached ends, attached ends follow move, resize and rotate | DF-K1–K3, DF-S4 | 3 | P3.06 |
| P4.02 | ENG | Connector editing: drag endpoints to re-attach or detach, curved midpoint control, orthogonal elbow route, midpoint label pill, stroke, dash and arrowheads | DF-K4, K6, K7 | 2.5 | P4.01 |
| P4.03 | ENG | Hover arrows (quick add a connected shape, ready to type), **anchor fan-out** on a shared side, deleting a shape removes its connectors in one undo step | DF-K5, Oqiva | 2 | P4.02 |
| P4.04 | ENG | Right palette framework (shows the intersection of options for every selected object) plus Arrange, group and ungroup, Align (reference object or canvas), Distribute, remove gaps, Same size, Swap, Rotate and Flip | DF-P1–P4 | 3 | P3.06 |
| P4.05 | ENG | Fill, border and dash, text, transparency, format painter, Espresso colour picker plus recent colours, corner radius | DF-P5–P9, DF-S10 | 2.5 | P4.04 |
| P4.06 | ENG | Clipboard (internal, plus OS image paste), smart guides with a light snap, edge auto-pan | DF-E3, E6, E7 | 2.5 | P3.06 |
| P4.07 | ENG+BE | Images: `board.upload_image` (private File attached to the board), workspace storage quota hooks, image object | DF-S6, §13 | 1.5 | P3.08 |
| P4.08 | ENG | Tables: size picker, cell selection and editing, add and remove rows and columns, cell formatting | DF-S7 | 3 | P3.07 |
| P4.09 | ENG+BE | Export PNG (1× and 2×), JPEG, SVG and PDF (jsPDF, with print as fallback); selection export; print stylesheet. Thumbnails (at most once per 30 s, placeholder on failure) through `board.save_thumbnail`. `export.prepare` with audit and rate limit. | DF-D4, DF-D5 | 2.5 | P3.04 |
| P4.10 | QA | Tests: connector follow and rotation geometry, palette intersection rule, guide snapping, export background rules (none → transparent, white for JPEG), file quota | – | 1.5 | all |

**Acceptance:** connectors snap and follow; all six tools work; quick-add works; every palette tile acts in one click; all export formats have the correct backgrounds; thumbnails appear on the home tiles.

---

## Phase 5: Collaboration and sharing (about 4.5 weeks)
| ID | Lane | Task | Refs | Days | Depends |
|---|---|---|---|---|---|
| P5.01 | ENG | Yjs bridge (store ↔ Y.Doc, one entry per object, echo guard); y-indexeddb offline cache and merge order; **merge-before-retry** recovery for stale saves | §8.2, §9.3–9.4, L1 | 3 | P3.08, P1.03 |
| P5.02 | BE | Production relay: `realtime/handlers.js` (join and authorise, editors-only `step2`/`update`, 15 s re-auth, 900 KB and 8 KB caps, 30 msg/s throttle, `peer_left`) plus `oqiva.api.realtime.authorize`. `oqiva/realtime/handlers.py` with the same behaviour for the Python server. | §9, ADR-003 | 3 | P1.03 |
| P5.03 | ENG | `OqivaSocketProvider` (y-protocols sync and awareness); presence avatars in the top bar; coloured cursors with names | DF-D3 | 2 | P5.01, P5.02 |
| P5.04 | BE | Access change push (`oqiva:access_changed`), `oqiva:saved`, `oqiva:resync` | §6.4 | 1 | P5.02 |
| P5.05 | BE+FE | Share with people: dialog, DocShare levels (view, comment, edit; edit never grants share), pending invites, share notification, modify and revoke rules | §10, §5.9 | 2 | P2.06 |
| P5.06 | BE+FE | Share links: create (access, expiry, anonymous), revoke, `/oqiva/s/<token>` redeem page, Link Grants, anonymous read-only viewer, `share.link_file` | §10, ADR-007 | 3 | P5.05 |
| P5.07 | BE+ENG | Comments: **Oqiva Comment** DocType and API, pins on shapes or points, threads with one level of replies, resolve and reopen, edit and delete rules, @mentions, `object_missing` reconciliation on save, realtime `oqiva:comment` | DF-D8, §11 | 3.5 | P3.08 |
| P5.08 | FE | Notifications page plus a realtime bell (Notification Log) | §11 | 1 | P5.05 |
| P5.09 | QA | Realtime harness **T6.1–T6.7**; **T3.2–T3.4, T3.6, T3.7**; **T4.1–T4.7**; **T5.5**; e2e **T5.6** | – | 2.5 | all |

**Acceptance:**
- Two browsers co-edit with presence.
- A viewer can't write, even with a tampered client.
- Revocation takes effect within 15 s.
- Offline work merges on reconnect.
- Links follow T4.

---

## Phase 6: Oqiva canvas features and templates (about 3 weeks)
| ID | Lane | Task | Refs | Days | Depends |
|---|---|---|---|---|---|
| P6.01 | ENG | Shape library panel (Shift+S): 26 presets (Architecture 12, Flowchart 6, Wireframe 8), ranked search with aliases, 4 recently used, click with smart placement (free spot near the centre or beside the selection), drag with a ghost and frame highlight, keyboard grid navigation, type to rename | Oqiva P2 §4 | 3 | P4.03 |
| P6.02 | ENG | Real silhouettes: database cylinder, document wave, cloud, hexagon, trapezoid; wireframe controls (button, text field, checkbox, radio, dropdown, mobile and desktop frames) | DF-S1, Oqiva gap | 2.5 | P3.05 |
| P6.03 | ENG | Sticky notes (palette colours, contrast, resize, lists, Tab for the next note), hyperlinks to a URL or another board, icons and emoji | DF-S8, S9, S11 | 2 | P3.07 |
| P6.04 | ENG | Frames and sections (named regions, jump to a section), minimap | DF-C8, C10 | 2 | P3.04 |
| P6.05 | BE+FE | **Oqiva Template** DocType, idempotent seed, gallery page (categories, tags, search, preview), "New board from template" (server-side copy) | §14, ADR-005 | 2 | P2.01 |
| P6.06 | ENG | A conversion script for Oqiva's 14 templates plus 4–6 starter boards, written to `seed/templates/*.json` | §14 | 1.5 | P6.05 |
| P6.07 | QA | Tests: preset search ranking, placement rules (free spot, beside the selection, fallback), template seeding is idempotent | – | 1 | all |

**Acceptance:** every preset places correctly; the 14 templates open as editable boards; minimap and sections work.

---

## Phase 7: Version history, export and import (about 1.5 weeks) → **M1 MVP**
| ID | Lane | Task | Refs | Days | Depends |
|---|---|---|---|---|---|
| P7.01 | BE | **Oqiva Board Version**: Auto (in the save transaction, every 10 minutes or more), Named and Pre-restore versions; retention job (newest 50 plus Named and pinned) | §7.4 | 1.5 | P3.08 |
| P7.02 | FE+ENG | Version panel: list, read-only preview (same render path), pin, label, **restore forward as a client operation** | §7.4 | 2 | P7.01, P5.01 |
| P7.03 | BE+FE | `.oqiva.json` export; import as a new board with validation (format, schema version, limits) | §7.4, T7.4 | 1.5 | P3.01 |
| P7.04 | QA | **T8.5**, **T7.4**, e2e "restore while a peer is connected keeps both consistent", MVP UAT script (Oqiva success criterion §92) | – | 1 | all |

**MVP UAT:** sign up → create a board → draw an architecture diagram with library shapes and connectors → close the browser → come back → everything is there → share → co-edit and comment → restore a version → export.

---

## Phase 8: Mind map mode (about 3.5 weeks)
| ID | Lane | Task | Refs | Days | Depends |
|---|---|---|---|---|---|
| P8.01 | ENG | Tree model and operations (child, sibling, delete subtree, re-parent with cycle check, reorder, promote), several trees per board with their own origins, root rules | DF-M1, M12 | 2 | P3.02 |
| P8.02 | ENG | Layout engine: right side only first (tested), then balanced two-sided; collapsed subtrees take no space; animated; O(n) | DF-M2, L10 | 2.5 | P8.01 |
| P8.03 | ENG | Keyboard loop (Tab, Enter, Shift+Enter, Esc, Delete, arrow navigation, Shift+Tab, Alt+↑/↓) with key-owner resolution on a mixed canvas | DF-M3, L9 | 2 | P8.02 |
| P8.04 | ENG | Automatic branch colours and inheritance, curved branch connectors, labelled dotted cross-links | DF-M5, M6 | 2 | P8.02 |
| P8.05 | ENG | Collapse and expand with a count badge, collapse all; drag to re-parent or reorder | DF-M4, M7 | 2 | P8.02 |
| P8.06 | ENG | Paste indented or bulleted text as a tree; markers (icon plus dot); notes (hover and side panel) | DF-M8, M9 | 2 | P8.01 |
| P8.07 | ENG | Outline view (two-way sync without loops), focus mode, mind-map palette, empty state, frame focus on the unified canvas | DF-M10–M12, DF-C9 | 2.5 | P8.03 |
| P8.08 | QA | No overlaps in the layout, cycle prevention, paste parsing, undo granularity, Yjs sync of tree operations | – | 1 | all |

---

## Phase 9: Flowchart mode (about 2.5 weeks)
| ID | Lane | Task | Refs | Days | Depends |
|---|---|---|---|---|---|
| P9.01 | ENG | Node types (terminator, process, decision, I/O, junction) with defaults; "Insert flowchart" creates a separate new chart | DF-F1, F12 | 1.5 | P4.02 |
| P9.02 | ENG | "+" handles and a type picker that auto-places and auto-connects; keyboard (Enter, D, T, I) | DF-F2, F4 | 2 | P9.01 |
| P9.03 | ENG | Decision branches with editable labels and more outputs, auto-balanced | DF-F3 | 1.5 | P9.02 |
| P9.04 | ENG | Orthogonal port routing, offset for overlapping routes, drag a connector to empty space to get the type prompt | DF-F5, F6 | 2.5 | P9.02 |
| P9.05 | ENG | Tidy up (dagre, one undo step, clears the manual flags), type swap that keeps edges, insert in the middle with downstream re-flow, TB/LR toggle, optional numbering | DF-F7–F11 | 3 | P9.04 |
| P9.06 | QA | Edges kept through swap and re-flow, labels follow re-routes, Tidy is a single undo step | – | 1 | all |

---

## Phase 10: Whiteboard mode (about 2.5 weeks) → **M2 v1**
| ID | Lane | Task | Refs | Days | Depends |
|---|---|---|---|---|---|
| P10.01 | ENG | Whiteboard tool palette; double-click empty space creates text | DF-W1, T5 | 1 | P3.07 |
| P10.02 | ENG | Pen and highlighter (perfect-freehand), widths in canvas units, thinning while drawing | DF-W2, L7 | 2 | P10.01 |
| P10.03 | ENG | Eraser: ink mode splits strokes, object mode removes objects; three tip sizes; path hit-testing | DF-W3 | 2.5 | P10.02 |
| P10.04 | ENG | Sketch style (roughjs, per object or per board), laser pointer (never saved), empty-state hint | DF-W4–W6 | 2 | P10.01 |
| P10.05 | ENG | Mixed selection across all object types; check export and thumbnails for every type | DF-E8, L11 | 1.5 | P8.07, P9.05 |
| P10.06 | QA | Regression across all four modes; stroke thinning and erase geometry; v1 UAT | – | 1.5 | all |

---

## Phase 11: Feedback and admin (about 1.5 weeks)
| ID | Lane | Task | Refs | Days |
|---|---|---|---|---|
| P11.01 | BE+FE | **Oqiva Bug Report** (`BUG-` from 1001) and **Oqiva Feature Request** (`FR-` from 101); SPA dialogs from the account menu; screenshot ≤ 5 MB, images only and type-checked; sanitised browser context; rate limit 20 per hour | Oqiva P5 §3 | 2 |
| P11.02 | BE | Desk Workspace "Oqiva Admin": Number Cards, Dashboard Charts (7, 30 and 90 days), lists, Assign To for bugs, Audit Log report, System Health Report link; disabling a user | ADR-006 | 2 |
| P11.03 | BE | Admin notifications (new bug, new request, error spike) through Notification rules and Oqiva Settings | – | 1 |
| P11.04 | QA | Admin-only visibility; non-admins get 403 or no workspace | – | 0.5 |

## Phase 12: AI diagram generation (about 1.5 weeks)
| ID | Lane | Task | Refs | Days |
|---|---|---|---|---|
| P12.01 | BE | `ai.status` and `ai.generate_diagram` (background job, Claude API, key in Settings, 45 s timeout), output schema validation (≤ 60 nodes, ≤ 120 edges), audit that records prompt length only, 10/min rate limit | Oqiva P5 §9 | 2.5 |
| P12.02 | ENG | Convert the AI spec into a mind map, flowchart or architecture diagram with the engine's layout engines, inserted as **one undo step** | §7.4 | 2 |
| P12.03 | FE | Editor dialog (prompt, kind), realtime result, an honest "not enabled" state | – | 1.5 |
| P12.04 | QA | Tests with a mocked provider (invalid JSON, oversized output, timeout) | – | 1 |

## Phase 13: Hardening and release (about 2.5 weeks) → **M3 v1.1**
| ID | Lane | Task | Days |
|---|---|---|---|
| P13.01 | QA | Full `SECURITY_TEST_PLAN` run and fixes; Akhilam standards and semgrep review | 2 |
| P13.02 | QA | Performance: object counts from P1.04, mind maps of 500+ nodes, 10 concurrent editors; tune culling | 2 |
| P13.03 | QA | Accessibility (focus, labels, keyboard) and the browser matrix (Chrome, Edge, Firefox, Safari) | 2 |
| P13.04 | QA | Playwright journeys: A (new user), B (sharing), offline, revoke while open | 2 |
| P13.05 | BE | Deployment runbook: supervisor and nginx socket.io, sticky sessions for multi-host; backup and restore; uninstall check | 1 |
| P13.06 | PO | User guide, admin guide, release notes | 1.5 |

---

## Team plan (two developers)
| Weeks | Dev A: backend and full-stack | Dev B: canvas engine |
|---|---|---|
| 1–3 | P1.01, P1.02, P1.05–P1.07, P1.09–P1.11 | P1.03, P1.04 spikes, P1.08 shell |
| 4–6 | Phase 2 (home area) | P3.01–P3.05 |
| 7–9 | P5.02, P5.04–P5.06 (relay, sharing, links), P3.08 server side | P3.06–P3.10 |
| 10–12 | P5.07, P5.08, P4.07 and P4.09 server side, P7.01, P7.03 | P4.01–P4.06 |
| 13–16 | P4.08 tables, P6.05–P6.06 templates, P5.09 and P7.04 QA | P5.01, P5.03, P6.01–P6.04, P7.02 → **M1 MVP about week 16** |
| 17–20 | P11 (feedback and admin), P9.01–P9.03 (help on flowchart) | Phase 8 (mind map) |
| 21–25 | P9.04–P9.06 support, P12.01 and P12.03, P10.05–P10.06 QA | P9.04–P9.05, Phase 10 → **M2 v1 about week 25** |
| 26–28 | P12.02, P12.04, Phase 13 | Phase 13 performance and accessibility → **M3 about week 28** |

## Risks to track every week
| Risk | Early signal | Mitigation |
|---|---|---|
| The realtime relay doesn't hold up | P1.03 fails | Fall back to a server-side Y.Doc in the Node handler (ADR-003, rejected option) |
| SVG performance at Oqiva's object counts | P1.04 below 60 fps at 1,000 | Lower the limit, cull more aggressively, or use a canvas layer for strokes |
| The engine estimate slips | Phase 3 over by more than 20% | Ship MVP without tables (P4.08) and frames (P6.04); move them after M1 |
| Clean-room discipline | A PR resembles Draw's source | ADR-008 review checklist; engine reviewers don't read Draw's source during review |
| Copyleft dependency slips in | Licence check (P1.11) fails | Replace it, or record an ADR before adding it |
