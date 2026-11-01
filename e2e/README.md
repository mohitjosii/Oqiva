# Oqiva end-to-end checks

Browser checks that drive the real app against a running bench. They are not part of
`bench run-tests`; run them by hand before a release or when the UI changes.

## Setup

```bash
cd apps/oqiva/e2e && yarn install
npx playwright-core install chromium   # once
```

Create two throwaway users on a development site (never on a production site) and put
their credentials in a JSON file:

```json
{ "a": { "user": "e2e_a@example.com", "password": "..." },
  "b": { "user": "e2e_b@example.com", "password": "..." } }
```

## Run

```bash
OQIVA_E2E_CREDS=/path/to/creds.json node home.e2e.mjs
```

| Variable | Default | Meaning |
|---|---|---|
| `OQIVA_E2E_URL` | `http://127.0.0.1` | Where the site is served |
| `OQIVA_E2E_SITE` | `frappe.com` | Sent as `X-Frappe-Site-Name` so the right site answers |
| `OQIVA_E2E_SHOTS` | none | A folder; screenshots are written there when set |

On a machine without the browser's system libraries, point `LD_LIBRARY_PATH` at a folder
of extracted packages, and set `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` if Playwright does not
recognise the operating system.
