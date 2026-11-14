# Oqiva user guide

Oqiva is a shared whiteboard for diagrams, flows and ideas. You work in **boards**, keep them in
**projects**, and projects live in **workspaces**. Open it at `/oqiva` on your company's site.

## Your first minutes

1. **Sign in** to the site as usual. The first time, a welcome page asks what to call your personal
   workspace, and then takes you to your home page. You see it once, on any device.
2. **Make a board.** Choose *New board* for an empty one, or *Templates* for a head start: there are
   about forty (kanban, sprint planning, user journey, org chart, brainstorm, wireframes, and more). *Use
   template* gives you your own copy to change.
3. **Add things** from the bar at the bottom of the board. Nothing is added by double-clicking empty
   space: pick a shape and click or drag on the board.
4. **Everything saves by itself.** The top bar says *Saved* when it has.

## Home, workspaces and projects

- The sidebar lists your **workspaces** (your personal one, and any you were added to). *Switch workspace*
  changes between them or creates one.
- **Projects** group boards inside a workspace. A board can also sit at the workspace's top level.
- *Recent*, *Favorites*, *Shared with me* and *Trash* are shortcuts across your boards. Press **Ctrl/Cmd + K**
  to search boards (and comments) by name.
- A board's **⋯** menu: rename, favorite, duplicate, move, archive, *Move to Trash*. Trash keeps a board
  for 30 days (your administrator may change that) and you can restore it any time before then.
- On a phone or a narrow window the sidebar is a drawer behind the menu button.

## The board

### Drawing
| To do this | Do this |
|---|---|
| Add a shape | Pick one from the **Shapes** button (or press R for a rectangle, O for an ellipse), then click or drag |
| Type in a shape | Double-click it, or select it and press Enter |
| Add text, a sticky note, a section | **T**, **N**, **F** |
| Draw a line or arrow | **L**, then drag between two shapes; ends stick to shapes and follow them |
| Add a picture | The picture button, or paste one from your clipboard |
| Add a table, an icon, an emoji | The table and icon buttons on the bar |
| Shape library | **Shift + S**: ready-made shapes for flowcharts, software design, wireframes and more |
| Move, resize, rotate | Select, then drag the shape or its handles; arrow keys nudge (hold Shift for 10) |
| Pan and zoom | Scroll to pan, Ctrl/Cmd + scroll (or the zoom buttons) to zoom, **Shift + 1** to fit everything |

Every colour, outline, font size and text style is on the bar that appears when something is selected. The
size boxes take any number you type.

### Mind maps
Press **M**. Type the central idea, then **Tab** adds a child, **Enter** a sibling, **Shift + Tab** moves a
node up a level, arrows walk the tree, **- / +** collapse and expand. Paste an indented list to turn it
into a map. The map lays itself out; the side bar can show it as an outline.

### Flowcharts
Press **Shift + F**. Steps are joined as you add them: **Enter** adds the next step, **D** a decision (its
outputs read Yes, No…), **T** a start or end, **I** an input or output. *Tidy up* re-flows the whole chart in
one step; *Top to bottom / Left to right* turns it.

### Whiteboard
**P** pen, **Shift + H** highlighter, **E** eraser (cut strokes or remove whole objects), **Shift + L**
laser pointer. The laser is shown to everyone on the board and is never saved. A board can be given a
*hand-drawn* look from the Draw menu.

### Undo
**Ctrl/Cmd + Z** undoes your own last step, whatever it was: a whole flowchart, a pasted outline, an AI
diagram. It never undoes someone else's work.

## Working with other people

- **Share** (top right) adds people by name or email as *Can view*, *Can comment* or *Can edit*. Someone
  without an account is invited and gets access when they join.
- **Links** give access to anyone who has the link. Choose what the link allows. A *view* link can be made
  open to people who are not signed in. The link's secret is shown once; revoke it any time.
- **Live editing.** People on the board appear in the top bar; you see their pointers and selections, and
  shapes move as they move them. If your connection drops, keep working: your changes are kept on your
  device and merged when you are back.
- **Comments.** Press **C** and click a shape or a place, write the comment, and mention people with **@**.
  Comments can be answered and resolved; mentioned people get a notification (the bell).
- **History** keeps older versions of a board. Open *History* to look at one and *Restore* it (restoring is
  one undo step, so you can take it back). Automatic versions are deleted after 3 days (the History panel shows
  the number). To keep one, give it a name or pin it.

## Getting your work out

*Export* offers PNG (also double size), JPEG, SVG and PDF, the whole board or only your selection, and
*Print*. *Board file (.oqiva.json)* saves the board as a file; *Import a board file* (in the new-board menu on
the home page) brings one in as a new board. Pictures are not carried in the file.

## Create with AI (when your administrator has turned it on)

Choose the sparkles button, pick *Flowchart*, *Architecture* or *Mind map*, and describe what you want
(up to 2,000 characters). A diagram appears in free space on the board in a few seconds. It is added as one
undo step. Only the text you type is sent to the AI service; nothing else on your board is. If the button
says the feature is not turned on, ask your administrator.

## Keyboard

Press **?** on a board for every shortcut. Menus and dialogs work from the keyboard, **Tab** moves between
controls, and **Esc** closes what is open. Drawing itself needs a pointer; the shape library, mind map and
flowchart commands are fully keyboard-driven.

## When something looks wrong

- *"This board was changed somewhere else"*: someone saved first; reload to see their version.
- *Offline*: the top bar says so. Keep working; it saves when the connection returns.
- A board you were using says *No access*: your access was removed. Ask the person who shared it.
- Very large boards (thousands of shapes) are slower when fully zoomed out: zoom in, or split the work
  across boards.
