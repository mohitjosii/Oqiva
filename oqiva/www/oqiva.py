"""Server context for the SPA page served at /oqiva.

The page itself is static. It asks oqiva.api.boot.get_boot for everything else, so
all that is injected here is the minimum needed to make authenticated calls.
"""

import json

import frappe

from oqiva.api.boot import has_app_permission

no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/oqiva"
		raise frappe.Redirect
	if not has_app_permission():
		frappe.throw(frappe._("You are not permitted to access Oqiva."), frappe.PermissionError)
	context.csrf_token = frappe.sessions.get_csrf_token()
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
