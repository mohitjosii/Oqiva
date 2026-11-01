# Draw Feature Reference (for a clean-room build)

| | |
|---|---|
| Studied | Frappe Draw installed on this bench (`apps/draw`, commit `c9ff6b6`), its README and its design specs. Behaviour only. |
| Rule | ADR-008: **no Draw code, tests, CSS or spec text is copied.** This document describes behaviour in our own words, so engine developers can work from it without opening Draw's source. |
| How to use | Each feature has an ID (`DF-…`). `DEVELOPMENT_PLAN.md` tasks list the DF IDs they deliver. A feature is done when its task's acceptance criteria pass. **Oqiva adds** marks where Oqiva goes beyond Draw. |

---

## 1. Canvas and navigation
| ID | Feature | Behaviour to build |
|---|---|---|
| DF-C1 | Canvas modes | Two modes: **infinite** (Oqiva's default) and **page presets** (16:9 1280×720, 4:3, A4 portrait and landscape, Letter portrait and landscape, square 1080). Presets map to physical mm or inches when printing. |
| DF-C2 | Pan area | Preset mode: a small margin around the page, which grows on a side when an object leaves the page and shrinks back when it returns. Scrollbars appear when content exceeds the viewport. |
| DF-C3 | Background | "None" by default: white on screen, transparent in PNG/SVG/PDF, white in JPEG. Any palette colour can be set. |
| DF-C4 | Grid | Dotted overlay in two densities (dense and sparse), drawn under shapes. It is never exported or included in thumbnails. Snap-to-grid is optional. |
| DF-C5 | Zoom | 10%–400% in 10% steps, centred on the cursor. Ctrl/Cmd+scroll, Shift+scroll, Ctrl/Cmd +/−. Fit and 100% buttons. The browser's own page zoom is intercepted. |
| DF-C6 | Pan | Plain scroll pans vertically and Shift+scroll horizontally. A hand tool drags the view. **Oqiva adds:** Space+drag pans too. |
| DF-C7 | Floating bottom palette | Pointer modes (select, hand, draw), grid toggle, zoom indicator, Fit and 100%. |
| DF-C8 | Minimap | A small overview with a draggable viewport rectangle (used most on large or whiteboard canvases). |
| DF-C9 | Unified canvas | One board can hold block shapes, any number of independent mind maps and flowcharts, and whiteboard content together. Double-clicking a mind map or flowchart **frame** focuses it for type-specific editing, and Esc steps back to the canvas. |
| DF-C10 | Sections | Named regions on the canvas, used for navigation (jump to a section). |

## 2. Shapes and objects
| ID | Feature | Behaviour to build |
|---|---|---|
| DF-S1 | Basic shapes | Rectangle, square, ellipse, circle, triangle, diamond, and polygon (side count chosen with a picker), plus block arrows. Holding Shift while drawing keeps a 1:1 ratio. |
| DF-S2 | Designed defaults | New shapes take the theme's border, a transparent fill and Inter text, never raw black on white. A dashed live preview shows while drawing. |
| DF-S3 | Text box | Behaves like a shape but has no border or fill. |
| DF-S4 | Handles vs anchors | A selected shape shows 8 **square** resize handles. While a connector is being drawn, nearby shapes show 8 **round** anchors. The two never appear together, and anchors rotate with the shape. |
| DF-S5 | Resize and rotate | 8 handles, with Shift keeping the aspect ratio. A rotation handle above the shape; Shift snaps rotation to 15° steps (0/30/45/60/90 and so on). Rotate ±90° and flip horizontally or vertically from the palette. |
| DF-S6 | Images | Insert from a file or the clipboard. Images are uploaded as attachments, never stored inline in the document. |
| DF-S7 | Tables | Insert with a row × column picker. Cell editing and selection, add or remove rows and columns, cell formatting. |
| DF-S8 | Sticky notes | Palette colours with automatic text contrast. Resizable. Multi-line plain text with simple "- " lists. The note grows downward to fit. Tab drops another note next to it. |
| DF-S9 | Hyperlinks | Any object can link to a URL or another board. |
| DF-S10 | Corner rounding | Adjustable corner radius on rectangles. |
| DF-S11 | Icons and emoji | Insert icons (Espresso and lucide sets) and emoji as objects. |
| **Oqiva adds** | Shape library | The Architecture (12), Flowchart (6) and Wireframe (8) presets, with ranked search, recently used shapes, click to add, drag to place, smart placement, type-to-rename, and **real silhouettes** (database cylinder, document wave, wireframe controls). See OQIVA_SPECIFICATION Part 2 §4. |

## 3. Connectors
| ID | Feature | Behaviour to build |
|---|---|---|
| DF-K1 | Geometries | Straight, curved and elbow, each as a plain line or an arrow: six tools. A document stores the geometry and arrowheads, not which tool was used. |
| DF-K2 | Snapping | Connector ends snap to the 8 perimeter anchors, never to the shape's centre. Unattached ends on empty canvas are allowed. |
| DF-K3 | Follow | An attached end follows its shape through move, resize and rotate. |
| DF-K4 | Editing | Drag an endpoint to re-attach or detach it. A curved connector has a midpoint control handle. Elbow connectors use a simple orthogonal route. |
| DF-K5 | Hover arrows (quick add) | Hovering a shape shows 4 direction arrows. Clicking one creates a connected copy of the shape in that direction, ready for typing. |
| DF-K6 | Labels | A label sits at the connector's midpoint, horizontal, in a pill filled with the background colour, and moves with the line. |
| DF-K7 | Style | Stroke colour, width, dash, and arrowheads at the start and end. |
| **Oqiva adds** | Anchor fan-out | Several connectors on the same side spread evenly along it. Deleting a shape deletes its connectors in one undo step. |

## 4. Text
| ID | Feature | Behaviour to build |
|---|---|---|
| DF-T1 | Edit | Double-click any shape or connector to edit its text. Text is centred by default with fixed 12 px horizontal padding. |
| DF-T2 | Format | Size, bold, italic, underline, colour, and left/centre/right alignment. Inter only. |
| DF-T3 | Overflow | Text wraps, and the shape grows vertically when it overflows. Diamonds and triangles use their inscribed rectangle. |
| DF-T4 | Auto-fit | Text can shrink to fit an object (used for sticky notes and table cells). |
| DF-T5 | Double-click empty canvas | Creates the last-used shape (or a rectangle) at that point, already in text editing. On a whiteboard it creates a text box instead. |

## 5. Selection and editing
| ID | Feature | Behaviour to build |
|---|---|---|
| DF-E1 | Select | Click, Shift+click to toggle, marquee on empty canvas, Ctrl/Cmd+A, and Esc or a click on empty canvas to deselect. Esc also exits draw and text modes. |
| DF-E2 | Duplicate and delete | Ctrl/Cmd+D duplicates with a +10/+10 offset. Delete or Backspace deletes, and undo brings it back. |
| DF-E3 | Clipboard | Copy, cut and paste with a +10 offset. A copied connector keeps its attachments only if both ends are in the selection. **Oqiva adds:** pasting an image from the system clipboard. |
| DF-E4 | Undo and redo | Semantic operations, at least 50 steps. One step per user action (Tidy, paste-to-tree, insert-reflow and delete-subtree are each one step). Cleared on reload. |
| DF-E5 | Nudge | Arrow keys move a small amount, Shift+arrows a large amount (in block mode). |
| DF-E6 | Smart guides | While dragging, guide lines appear when edges or centres line up with other objects or with the canvas, with a light snap that can be escaped. Computed against axis-aligned bounds once per animation frame. |
| DF-E7 | Edge auto-pan | The view scrolls when you drag near the edge of the viewport. |
| DF-E8 | Mixed selection | Moving a selection that mixes block shapes, mind map frames, flowchart nodes and strokes moves them together. |

## 6. Right palette (one-click tiles; shows only what applies to **every** selected object)
| ID | Section | Actions |
|---|---|---|
| DF-P1 | Arrange | front, forward, backward, back; group and ungroup |
| DF-P2 | Align | left, centre, right, top, middle, bottom, relative to a reference object (first or last selected) or to the canvas |
| DF-P3 | Distribute and size | equal horizontal and vertical spacing (3+ objects), remove gaps; same width, height or both; swap two objects |
| DF-P4 | Transform | rotate ±90°, flip horizontal and vertical |
| DF-P5 | Fill and border | fill colour; border colour, weight and dash; line stroke and dash |
| DF-P6 | Text | font size, bold, italic, underline, colour, alignment |
| DF-P7 | Transparency | object opacity |
| DF-P8 | Format painter | copy one object's style onto others |
| DF-P9 | Colour picker | curated Espresso palette plus recently used colours (no free hex in v1) |
| DF-P10 | Link | add or remove a hyperlink |
| DF-P11 | Theme presets | 3–4 coordinated colour sets (Draw: ocean, slate, violet, sunset), chosen when the board is created |

## 7. Mind map mode
| ID | Feature | Behaviour to build |
|---|---|---|
| DF-M1 | Tree model | One root per tree, and any number of trees per board, each with its own origin. A node has a parent, an order, text, collapsed, colour, a marker and a note. |
| DF-M2 | Balanced layout | Root in the centre. First-level branches alternate left and right, subtrees grow outward, children are evenly spaced, and collapsed subtrees take no space. O(n), animated. Positions are derived, never stored. |
| DF-M3 | Keyboard | Tab adds a child, Enter a sibling, Shift+Enter a new line, Esc ends editing. Delete removes a node (asking before deleting a subtree). Arrows navigate (not nudge). Shift+Tab promotes. Alt+↑/↓ reorders. |
| DF-M4 | Drag | Drop a node onto another to re-parent it, or among its siblings to reorder. Moving a node into its own subtree is blocked. |
| DF-M5 | Branch colours | Each first-level branch gets a colour automatically, and its descendants inherit it (optionally lighter with depth). It can be overridden. |
| DF-M6 | Connectors | Curved parent→child lines in the branch colour, with no arrowheads. Cross-links are dotted, optional labelled lines between any two nodes. |
| DF-M7 | Collapse | A toggle on any node with children. A collapsed node shows a count badge. Collapse-all and expand-all are available. |
| DF-M8 | Markers and notes | A one-click icon and colour dot per node. Notes are longer text shown on hover and in a side panel. |
| DF-M9 | Paste to tree | Pasting indented or bulleted multi-line text builds a matching subtree. |
| DF-M10 | Outline view | A side panel with an editable, indented outline that stays in sync with the map both ways without looping. |
| DF-M11 | Focus mode | Dims everything except the selected branch. |
| DF-M12 | Empty state and root rules | A new map starts with "Central idea" in editing, plus a hint. The root can't be deleted ("clear map" asks first), except when the board holds several maps. |

## 8. Flowchart mode
| ID | Feature | Behaviour to build |
|---|---|---|
| DF-F1 | Node types | Terminator (pill), Process (rectangle), Decision (diamond), Input/Output (parallelogram), Junction (small circle), each with designed defaults. |
| DF-F2 | Extend from node | "+" handles on a node's outgoing side open a type picker. The new node is placed one level down, connected with an elbow arrow and snapped to the column. |
| DF-F3 | Decision branches | Several labelled outputs (Yes and No by default, editable, more can be added), auto-balanced. |
| DF-F4 | Keyboard | With a node selected: Enter adds a Process, D a Decision, T a Terminator, I an Input/Output. |
| DF-F5 | Routing | Orthogonal arrows between logical ports (bottom to top for top-to-bottom, right to left for left-to-right) that re-route as nodes move. Overlapping routes are offset slightly. No obstacle avoidance. |
| DF-F6 | Drag to empty | Dropping a connector on empty canvas opens the type picker and creates the connected node there. |
| DF-F7 | Tidy up | Re-flows the whole chart in one undo step. Manually moved nodes keep their place until Tidy clears the flag. |
| DF-F8 | Type swap | Change a node's type and keep its edges. |
| DF-F9 | Insert in the middle | Dropping a node onto an edge splices it in, and everything downstream re-flows. |
| DF-F10 | Direction | Toggle between top-to-bottom and left-to-right. |
| DF-F11 | Auto-numbering | Optional step numbers. |
| DF-F12 | New chart | Each insert creates a new, separate chart (Start plus first step) below the existing content. |

## 9. Whiteboard mode
| ID | Feature | Behaviour to build |
|---|---|---|
| DF-W1 | Tools | Select, hand, pen, highlighter, eraser, text, sticky, shapes, connector, laser. |
| DF-W2 | Pen and highlighter | Smoothed vector strokes with colour and thickness in canvas units. Points are thinned **while drawing**; the finished stroke is never reshaped on pointer-up. |
| DF-W3 | Eraser | Ink mode removes only the swept part, splitting the stroke into the surviving pieces. Object mode removes the whole object under the tip. Three tip sizes. Hit-testing uses the path, not the bounding box. |
| DF-W4 | Sketch style | A hand-drawn rendering toggle, per object or for the whole board. |
| DF-W5 | Laser | A fading trail that is never saved and never exported. |
| DF-W6 | Empty state | A faint hint in the centre. |

## 10. Documents, persistence, sharing
| ID | Feature | Draw behaviour | Oqiva target |
|---|---|---|---|
| DF-D1 | Autosave | Debounced (about 1.5 s), revision-checked, with a Saved/Saving indicator | Same, plus merge-before-retry (ARCHITECTURE §8.2) |
| DF-D2 | Offline | The latest state is kept locally and flushed on reconnect. A notice appears after about 5 s offline. | Same, using y-indexeddb |
| DF-D3 | Realtime | Yjs over WebRTC, presence and cursors (editors only) | Yjs relay over Frappe socket.io, presence for all levels (ADR-003) |
| DF-D4 | Thumbnails | Generated on the client from the same SVG, at most once per 30 s, with a placeholder if that fails | Same |
| DF-D5 | Export | PNG 1× and 2×, JPEG, SVG and PDF on the client; selection-only export; print shows the canvas only | Same, plus `.oqiva.json` |
| DF-D6 | Sharing | View, comment or edit per person (DocShare plus a custom comment permission); general access restricted, site users or public | People plus links with expiry and an anonymous option (ARCHITECTURE §10) |
| DF-D7 | Viewer | Canvas only, zoom and pan, no export | Same |
| DF-D8 | Comments | Pinned to a shape or a point, threads, resolve, mentions, notifications | Same, plus the orphan flag and realtime (§11) |
| DF-D9 | Library | Folders, collections, pinned, search, trash with a 30-day purge | Replaced by Oqiva workspaces, projects, favourites, search and trash |
| DF-D10 | Settings | Default theme preset, defaults for new boards | User preferences in Oqiva Settings and user prefs |

## 11. Draw's lessons, adopted as requirements (not code)
| # | Requirement | Where |
|---|---|---|
| L1 | A stale-revision retry must merge the server's CRDT state, never assume a peer has it | ARCHITECTURE §8.2 |
| L2 | Every state-changing endpoint is POST only | ARCHITECTURE §6.3 |
| L3 | No implicit System Manager access in query conditions | ARCHITECTURE §4 |
| L4 | Composite uniques are added in `after_migrate` setup, not in `on_doctype_update` or patches | ARCHITECTURE §5 |
| L5 | App setup runs from `after_install` and `after_migrate`, because patches are skipped on a fresh install | ARCHITECTURE §17 |
| L6 | Save errors are classified as blocking, retryable or offline; only no server reply counts as offline | ARCHITECTURE §8.3 |
| L7 | Strokes are thinned while drawing, never reshaped after the pointer lifts | DF-W2 |
| L8 | One screen↔canvas transform is used by every interaction and tested at 10%, 100% and 400% | ARCHITECTURE §15.1 |
| L9 | Keys are mode-aware and ignored while editing text. Number keys stay unbound. | ARCHITECTURE §15.1 |
| L10 | Layout is derived. Undo stores model operations, never positions. | DF-E4, DF-M2 |
| L11 | One render-to-SVG path is shared by the editor, viewer, export, thumbnails and print | ARCHITECTURE §15.1 |
