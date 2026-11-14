# Oqiva administrator guide

For the person who looks after the Frappe site Oqiva is installed on. Deployment steps are in
`DEPLOYMENT.md`; this guide is about running it day to day.

## Roles
| Role | What it is |
|---|---|
| **Oqiva User** | Everyone who uses Oqiva. Given automatically on a person's first visit (turn this off with *Grant the Oqiva User role on first visit*). Has no Desk access. |
| **Oqiva Admin** | Can open Oqiva Settings and read the audit log and the other Oqiva records in Desk. Does **not** gain access to anyone's boards: board access always comes from workspace membership or a share, for administrators too. |
| **System Manager** | Same Desk rights as Oqiva Admin, plus the usual Frappe ones. |

A person's access to a workspace or board is never managed from Desk: workspace owners and admins use
*Members* in the app, and board owners use *Share*.

## Oqiva Settings (Desk → Oqiva Settings)
**Fair-use limits.** Objects per board (3,000), largest saved board (5 MB), boards per workspace (2,000),
picture storage per workspace (2 GB), largest picture (10 MB).
**Retention.** Trash (30 days), minutes between automatic versions (10), automatic versions kept per board (50),
days automatic history is kept (3: older automatic versions are deleted every hour; named and pinned versions stay).
**Access.** Grant the Oqiva User role on first visit; how often a live session's access is re-checked (15 s,
which is how long a removed person can still send changes to a board they had open).
**AI diagram generation.** Off by default. See below.

Limits apply to what people add next; they never delete existing content.

## AI diagram generation
1. Choose the **provider**: *Anthropic* (Claude) or *Gemini* (Google). *none* switches it off.
2. Paste the provider's **API key**. It is stored encrypted and is never shown again or sent to browsers.
3. Leave **model** blank for the default (`claude-sonnet-5-5`, `gemini-2.5-flash`), or enter one; a Claude
   model only works with Anthropic and a Gemini one with Gemini. Check the default is still offered by your
   provider.
4. Make sure background jobs run (`bench worker`, started by `bench start` or supervisor). The request is
   queued, so with no worker people wait 90 seconds and are told it took too long.

What is sent: the typed description and the kind of diagram, nothing from the board. What is recorded: the
audit log keeps the kind and the *length* of the description, never its words, and rejected answers with the
reason. People are limited to 10 requests a minute; nothing else limits spend, so set a budget with your
provider. To send requests through a company gateway, set `oqiva_ai_anthropic_url` or `oqiva_ai_gemini_url`
in the site config (the Gemini address keeps `{model}` in it).

## Watching the system
- **Audit log** (Oqiva Audit Log): exports, share-link redemptions and refusals, picture uploads that were
  refused, AI requests and rejections. Kept 365 days.
- **Scheduled jobs** (hourly: prune versions beyond the count and delete automatic history older than the history retention; daily: purge expired Trash, prune board views and the audit
  log). `bench --site <site> doctor` shows whether the scheduler and workers are alive.
- **Error Log** (Desk) holds server errors; a failed audit write or an unexpected AI failure is logged there.
- Usage: Oqiva Workspace, Oqiva Board and Oqiva Comment lists show counts; a board's *object count* and size are
  on the record.

## People
- To add someone: they only need a Frappe account. To remove their access: take them out of the workspace and
  their shares; they stay a Frappe user.
- A disabled user is cut off from live boards within the re-check time (15 s by default).
- Deleting a workspace (its Owner can; a personal one cannot be deleted) hides it from everyone at once. It is a soft delete: the workspace and its boards stay in the database.

## Templates
*Oqiva Template* holds the template catalogue. The shipped ones come back after `bench migrate`; add your own
by creating a template record (its document is a board file's `document`).

## Backups, upgrades, removal
See `DEPLOYMENT.md`. In short: back up with files (`bench backup --with-files`) because pictures are files; run
`bench migrate` after every upgrade; restart the socket server after upgrading so live editing uses the new
relay; and take a backup before uninstalling, because uninstalling deletes every board.

## Troubleshooting
| Symptom | Check |
|---|---|
| Nobody sees live changes | The socket server runs and is reachable (`/socket.io` proxied); `socketio_port` in the common config |
| "Create with AI" says not turned on | Settings → provider and key; saved |
| AI requests take too long | Workers running; provider reachable from the server; look in Error Log |
| Boards save slowly or fail with "too large" | The limits above; a 3,000-shape board is about 1 MB |
| A person cannot open a board | Their access (workspace membership or a share); the board may be in Trash |
