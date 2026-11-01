import { reactive } from "vue"
import { api } from "@/data/api"

// The projects of the workspace being viewed, shared by the sidebar and the pages.
export const projectsState = reactive({ workspace: null, items: [], loading: false })

export async function loadProjects(workspace) {
	projectsState.loading = true
	projectsState.workspace = workspace
	try {
		const items = await api("project.list_projects", { workspace })
		if (projectsState.workspace === workspace) projectsState.items = items
	} finally {
		projectsState.loading = false
	}
}

export function reloadProjects() {
	return projectsState.workspace ? loadProjects(projectsState.workspace) : Promise.resolve()
}
