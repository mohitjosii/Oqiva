app_name = "oqiva"
app_title = "Oqiva"
app_publisher = "Mohit Joshi"
app_description = "Create and manage your all workflow at one place"
app_email = "mohitjoshi494@gmail.com"
app_license = "mit"

add_to_apps_screen = [
	{
		"name": "oqiva",
		"logo": "/assets/oqiva/images/oqiva-logo.svg",
		"title": "Oqiva",
		"route": "/oqiva",
		"has_permission": "oqiva.api.boot.has_app_permission",
	}
]

website_route_rules = [
	{"from_route": "/oqiva/<path:app_path>", "to_route": "oqiva"},
]

after_install = "oqiva.setup.ensure_setup"
after_migrate = "oqiva.setup.ensure_setup"
before_uninstall = "oqiva.setup.before_uninstall"

permission_query_conditions = {
	"Oqiva Board": "oqiva.access.hooks.board_query_conditions",
	"Oqiva Project": "oqiva.access.hooks.project_query_conditions",
	"Oqiva Workspace": "oqiva.access.hooks.workspace_query_conditions",
	"Oqiva Workspace Member": "oqiva.access.hooks.workspace_member_query_conditions",
	"Oqiva Favorite": "oqiva.access.hooks.favorite_query_conditions",
	"Oqiva Board View": "oqiva.access.hooks.board_view_query_conditions",
	"Oqiva Pending Invite": "oqiva.access.hooks.invite_query_conditions",
	"Oqiva Comment": "oqiva.access.hooks.comment_query_conditions",
}

has_permission = {
	"Oqiva Board": "oqiva.access.hooks.board_has_permission",
	"Oqiva Project": "oqiva.access.hooks.project_has_permission",
	"Oqiva Workspace": "oqiva.access.hooks.workspace_has_permission",
	"Oqiva Workspace Member": "oqiva.access.hooks.workspace_member_has_permission",
	"Oqiva Favorite": "oqiva.access.hooks.own_row_has_permission",
	"Oqiva Board View": "oqiva.access.hooks.own_row_has_permission",
	"Oqiva Pending Invite": "oqiva.access.hooks.invite_has_permission",
	"Oqiva Comment": "oqiva.access.hooks.comment_has_permission",
}

doc_events = {
	"User": {"after_insert": "oqiva.services.invite_service.convert_for_new_user"},
}

scheduler_events = {
	"daily": [
		"oqiva.services.trash_service.purge_expired_trash",
		"oqiva.services.trash_service.prune_board_views",
		"oqiva.services.audit_service.prune_audit_log",
	],
}

export_python_type_annotations = True
require_type_annotated_api_methods = True
