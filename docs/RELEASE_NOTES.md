# Oqiva 1.1 release notes

Oqiva is a shared visual workspace for diagrams, flows and ideas on Frappe 16: boards, projects and
workspaces; a canvas editor written for this app; live editing with presence; sharing and links; comments;
version history; export; mind maps, flowcharts and a whiteboard; templates; and AI diagram generation.

## What is in this release
**Workspace and boards.** Workspaces with owners, admins, members and guests; projects; boards with
favorites, recent, search, archive, trash (30 days), duplicate, import and export of `.oqiva.json`.
**Editor.** Infinite or page-sized canvas, shapes and a shape library, text, sticky notes, tables, icons,
pictures, frames (sections), connectors that follow shapes, grouping and arranging, snapping guides, undo and
redo, touch and pen support (pinch to zoom, pressure).
**Mind maps** (keyboard-driven, outline, collapse, drag to re-parent, colours and markers), **flowcharts**
(typed steps, Yes/No branches, tidy layout, routed arrows that avoid steps, numbering, left-right or top-bottom).
**Whiteboard.** Pen, highlighter, eraser (ink or object mode), laser pointer shared live, hand-drawn style.
**Collaboration.** Live editing through a CRDT with presence, pointers and selections; offline work kept on
the device and merged on return; comments with mentions, notifications; version history with restore.
**Sharing.** By person (view, comment, edit), by link (signed-in or anonymous view), invitations by email.
**Export.** PNG, JPEG, SVG, PDF, print, board file.
**Templates.** About forty real-world templates (planning, retros, journeys, org charts, wireframes, flows).
**AI diagram generation** (off by default): describe a flowchart, architecture diagram or mind map and it is
drawn as one undo step. Providers: Anthropic and Google Gemini.

## New and changed in the final phases
- AI diagram generation (provider setting, encrypted key, background job, 10 requests a minute, audit that
  records only the prompt's length).
- Double-clicking empty canvas no longer adds a shape; every shape is added on purpose. Double-clicking still
  edits what is under the pointer.
- Automatic history is deleted after 3 days by an hourly job (setting: History Retention Days). Named and pinned
  versions are kept. The History panel says how long automatic versions last.
- The @ mention list in a comment is no longer cut off by the comments panel; it opens below or above the box,
  wherever there is room.
- Boards made from a template, a file or a copy get their home-screen picture when first opened, not only after
  the first edit. The Whiteboard template no longer mentions double-clicking to add text.
- The welcome page is shown once per person, not once per device.
- Accessibility: named dialog close buttons, a named canvas, darker secondary text (contrast), focus returned to
  the Help button, no sideways scroll at 320 px.
- Hardening: a whole-surface security sweep (every endpoint refused for signed-out callers; a stranger gets
  "not found" from everything; a viewer can only look), a fix so a damaged item in the shared document is
  ignored instead of breaking the editor, a complete uninstall.
- Performance measured at the limits (PERFORMANCE.md).

## Known limits and issues
- **Browsers:** tested in Chromium only. Firefox, Safari and Edge have not been tried.
- **Touch and pen:** tested with emulated events only, not on a real touch screen or stylus.
- **Screen readers:** the interface is labelled and keyboard-operable, but the board itself is a drawing
  surface; creating shapes needs a pointer. A full screen-reader pass has not been done.
- **AI:** both providers were tested against local stand-ins, not the real services. Dashed edges come out
  solid in flowcharts and mind maps. A request still costs a provider call if the dialog is closed.
- **Boards at the 3,000-shape limit** are slow when fully zoomed out and for whole-board edits.
- **Replacing a board's content through the API without a collaboration state** while people have it open
  (or have a copy on their device) can merge old and new content. The app's own clients never do this.
- Not included: bug reports and feature requests inside the app, and an administrator console (both were built
  and set aside).

## Upgrading
Back up, `bench update`, `bench build --app oqiva`, `bench migrate`, restart everything including the socket
server (see DEPLOYMENT.md).
