"""Server context for the SPA page served at /oqiva.

The page itself is static. It asks oqiva.api.boot.get_boot for everything else, so
all that is injected here is the minimum needed to make authenticated calls.
"""

import json
import re
from urllib.parse import quote

import frappe

from oqiva.api.boot import has_app_permission

no_cache = 1


# The one address a visitor who is not signed in may open: a share link.
SHARE_LINK_PATH = re.compile(r"^/oqiva/s/[A-Za-z0-9_-]{8,200}/?$")


def get_context(context):
	path = frappe.local.request.path if frappe.local.request else "/oqiva"
	guest_on_link = frappe.session.user == "Guest" and SHARE_LINK_PATH.match(path)
	if frappe.session.user == "Guest" and not guest_on_link:
		# Sign in, then come back to exactly this page (a link someone sent keeps its secret).
		target = path if path.startswith("/oqiva") else "/oqiva"
		frappe.local.flags.redirect_location = f"/login?redirect-to={quote(target)}"
		raise frappe.Redirect
	if not guest_on_link and not has_app_permission():
		frappe.throw(frappe._("You are not permitted to access Oqiva."), frappe.PermissionError)
	context.csrf_token = "" if guest_on_link else frappe.sessions.get_csrf_token()
	context.site_name = frappe.local.site
	context.boot = json.dumps(
		{
			"site_name": frappe.local.site,
			"lang": frappe.local.lang,
			"socketio_port": frappe.conf.get("socketio_port") or 9000,
			"user": frappe.session.user,
		}
	)
	frappe.db.commit()  # nosemgrep -- persist the freshly minted csrf token
	return context
