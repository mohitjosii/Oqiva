# Oqiva deployment runbook (Phase 13, P13.05)

How to install, run, back up, upgrade and remove Oqiva on a production Frappe bench. Commands assume a
bench at `~/frappe-bench` and a site called `example.com`; change them to yours. This was written from the app's
code and from running it on a development bench. The multi-host advice (section 6) was **not** tried: it is
what Frappe's own socket server design implies, and should be checked on your setup.

## 1. What it needs
| | |
|---|---|
| Frappe | version 16 (the app declares Python 3.14 or newer) |
| Services | MariaDB, Redis (cache, queue and socket.io, as `bench setup` arranges) |
| Node | the bench's Node, for Frappe's socket server and for building the app |
| Processes | web (gunicorn), **socket server**, **scheduler**, **at least one worker** on the `default` queue |
| Browser | a current Chromium-based browser was tested. Firefox, Safari and Edge were not tested yet |

The socket server matters: live editing, presence and the "access changed" notices go through it. The
workers matter: AI diagram generation runs as a background job on the `default` queue.

## 2. Install
```bash
cd ~/frappe-bench
bench get-app oqiva <git-url-or-path>
bench --site example.com install-app oqiva
bench build --app oqiva          # builds the single-page app (needs network for yarn the first time)
bench --site example.com migrate # idempotent: roles, indexes, settings defaults, the template catalogue
sudo supervisorctl restart all   # or: bench restart
```
Open `https://example.com/oqiva`. The first visit by each person creates their personal workspace.

`bench build --app oqiva` runs `yarn install --frozen-lockfile && yarn build` in `frontend/`, which writes
`oqiva/public/frontend/` and `oqiva/www/oqiva.html`. Neither is kept in git, so a build is part of every
install and upgrade. The build also copies source maps (about 13 MB in all); delete the `.map` files from
`public/frontend/assets` if you do not want to serve them.

### Production settings to check
- `developer_mode` is off, `allow_tests` is off.
- HTTPS everywhere (live editing and cookies need it). Frappe's `bench setup nginx` and `bench setup lets-encrypt`
  arrange it.
- Redis is not exposed outside the host. The rate limits (exports 20 a minute, AI 10 a minute, share-link
  redemption 20 a minute per address) count in Redis.
- Set the limits and retention you want in *Oqiva Settings* (see ADMIN_GUIDE.md).

## 3. Processes (supervisor and nginx)
`bench setup production <user>` writes supervisor and nginx configuration for the web server, the socket
server, the scheduler and the workers. Check that all of these exist and are running:
```bash
sudo supervisorctl status
# frappe-bench-web, frappe-bench-node-socketio, frappe-bench-schedule, frappe-bench-worker (short/default/long)
```
Nginx must forward `/socket.io` to the socket server (Frappe's generated config does). Frappe's socket server
loads `apps/oqiva/realtime/handlers.js` once, when it starts, so **restart the socket server after every
upgrade** of Oqiva, or live editing keeps using the old relay.

Check it is alive:
```bash
curl -s https://example.com/api/method/ping            # {"message":"pong"}
bench --site example.com doctor                        # scheduler, workers, queues
curl -s -o /dev/null -w "%{http_code}\n" https://example.com/socket.io/?EIO=4\&transport=polling   # 200
```
In the app, open a board in two browsers: shapes drawn in one should appear in the other within a second.

## 4. Backup and restore
Everything Oqiva keeps is in the database (`tabOqiva …` tables) and in **private files** (pictures and thumbnails
attached to boards: `sites/example.com/private/files`). Back up both:
```bash
bench --site example.com backup --with-files
# restore on the same or another bench with Oqiva installed:
bench --site example.com restore <database.sql.gz> --with-public-files <public.tar> --with-private-files <private.tar>
bench --site example.com migrate
```
Frappe also schedules backups; check `bench --site example.com show-config` and your retention policy. A
restored board opens as it was saved; in-progress live edits that were not yet saved are not in a backup (they
are in people's browsers, which merge them when they reconnect).

The saved AI key is stored encrypted with the site's `encryption_key` (in `site_config.json`). A backup of the
database without that key cannot decrypt it; keep the site config backed up as well, or enter the key again.

## 4b. Moving or copying a board
*Board file (.oqiva.json)* in the Export menu saves one board (without pictures or comments) and *Import a
board file* loads it into any workspace, including on another site.

## 5. Upgrade
```bash
cd ~/frappe-bench
bench backup-all-sites --with-files      # or the site backup above
bench update --apps oqiva                # or: cd apps/oqiva && git pull
bench build --app oqiva
bench --site example.com migrate         # also re-runs the roles, indexes and template seeding
sudo supervisorctl restart all           # includes the socket server
```
Every board so far is document schema version 1. A board written by a *newer* version than the one running
is refused with a clear message and never half-opened, so do not downgrade the app after an upgrade without
restoring the backup. Roll back by restoring the backup if an upgrade goes wrong.

## 6. More than one web host
Boards are saved over HTTP and the relay keeps no document state, so more than one host is possible. The
socket server needs two things:
1. **Shared Redis for socket.io** (`redis_socketio` in the common site config), so rooms and events cross
   hosts. Frappe's default setup already points every host at one Redis.
2. **Sticky sessions** at the load balancer for `/socket.io` (by source address or a cookie), because
   socket.io's polling fallback sends several requests that must reach the same process.
Every host needs the same `sites/example.com/site_config.json` (especially `encryption_key`) and shared storage
(or a shared mount) for `private/files`.

## 7. Settings that live outside Oqiva Settings
Both are optional and go in the site config (so only someone with server access can set them):
```json
{ "oqiva_ai_anthropic_url": "https://gateway.example/anthropic/v1/messages",
  "oqiva_ai_gemini_url":    "https://gateway.example/gemini/models/{model}:generateContent" }
```
They replace the provider's own address, for a company AI gateway.

## 8. Uninstall
**Uninstalling deletes every board.** Back up first.
```bash
bench --site example.com backup --with-files
bench --site example.com uninstall-app oqiva
```
Before Frappe drops the app's tables, Oqiva removes what it created outside them: board shares, Oqiva
notifications, pictures and thumbnails (and their files on disk), change history and comments on Oqiva records,
the stored AI key, the welcome flags and the Oqiva roles. This is covered by `test_api.py` (with the file
deletion tested on its own so a test never deletes real pictures).

## 9. Routine
| When | What |
|---|---|
| Hourly (automatic) | prune automatic versions beyond the limit |
| Daily (automatic) | purge Trash older than the retention, prune board views, prune the audit log (365 days) |
| Weekly | check `bench doctor`, the Error Log, free disk (pictures live in `private/files`) |
| Before upgrades | backup with files |
| After upgrades | build, migrate, restart (including the socket server) |
