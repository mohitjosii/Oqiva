# Oqiva performance (Phase 13, P13.02)

What was measured, how, and what it means. Numbers are from one small development machine (2 CPU cores,
4 GB, Chromium without a graphics card, so drawing is done in software). A real desktop with a GPU is faster
for anything involving drawing; treat the frame times as a floor.

## How to run it
```bash
# engine: layout, store, sharing the document (prints timings; fails only when far slower than recorded)
cd frontend && yarn vitest run src/engine/performance.test.js
# server: saving and opening a board at the size limit
bench --site <site> run-tests --app oqiva --module oqiva.tests.test_performance
# browser: 3,000 shapes, a 600-node mind map, ten people editing one board
OQIVA_E2E_CREDS=<ten users: {"1":{...},..."10":{...}}> node e2e/perf.e2e.mjs
```

## Results

### The engine (Node, no browser)
| Case | Time |
|---|---|
| Mind map layout, 500 / 1,000 / 2,000 nodes | 26 / 27 / 34 ms |
| Flowchart tidy-up, 500 steps and 800 arrows (the limits) | about 140 ms |
| Flowchart routing of every arrow, 300 steps | about 150 ms |
| Read and check a 3,000-shape document (0.93 MB) | 17 ms |
| Open it, select all, move all as one step, undo | 4, 4, 24, 6 ms |
| Move 3,000 shapes through the shared document to a second person | 120 ms to write, 155 ms to arrive |

### The server
Save of a 3,000-shape board (1.0 MB): about 340 to 640 ms with all checks, the version record and the
audit entry. Open it: 100 to 140 ms. A second save with one change: about 160 ms. Listing a workspace's
boards: under 20 ms.

### The browser, 3,000 shapes (the default limit)
| | |
|---|---|
| Open the board, to first shapes drawn | 4.3 to 5.4 s |
| Memory | 54 to 61 MB of JavaScript heap |
| At 100% zoom | about 100 shapes in the page (culling works); pan: mean 20 ms per frame, 99% under 50 ms |
| Zoomed out to see all 3,000 | all drawn, about 9,200 elements; pan: mean 50 to 65 ms per frame |
| Zoom gesture, zoomed out | mean 21 to 25 ms per frame |
| Select all, then nudge all 3,000 | about 230 ms per step |
| Move all 3,000 and save | saved about 2 s later; the change is too big for the live link, so it goes over HTTP and other people refresh. A reload twice afterwards shows the same 3,000 shapes. Stored collaboration state: about 2 MB |

So a board at the limit is comfortable at normal zoom, workable when zoomed out, and slow only for
whole-board operations. Text is not drawn when zoomed far out.

### A mind map of 600 nodes
Open: 1.7 to 5 s. All 600 nodes are in the page after "fit". Pan: mean 22 to 45 ms per frame. Adding a child
node: about 200 ms.

### Ten people on one board
Ten signed-in browsers opened a board in about 7.5 s (all at once, on a 2-core machine that also runs the
server). A single new shape reached all ten screens in about 520 ms. Ten people each making 15 quick edits
(150 edits in 9 s) converged on all ten screens about 12 s after the last edit on this machine, which is
limited by ten browsers sharing two cores, not by the relay. The saved board caught up within a second of
everyone stopping and held every shape.

## What was changed because of it
Nothing in the engine needed tuning: culling already limits drawing at normal zoom. One real fault was found
on the way and fixed: a damaged or foreign item in the shared document made the editor throw instead of being
ignored (`yMapToObject`). See ARCHITECTURE section 25.

## What to watch
- Zoomed-out drawing of thousands of shapes is the heaviest thing the editor does. If it matters, the next
  step would be to draw simplified shapes below a zoom level.
- Moving or restyling every shape of a very large board at once is the slowest edit.
- Many people editing at once is bound by their own machines first, then by the socket server's CPU.
