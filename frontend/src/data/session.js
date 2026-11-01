import { reactive } from "vue"
import { api } from "@/data/api"
import { readStored, writeStored } from "@/utils/storage"

const LAST_WORKSPACE = "oqiva.lastWorkspace"

export const session = reactive({
	ready: false,
	error: null,
	user: null,
	workspaces: [],
	personalWorkspace: null,
	limits: {},
	isAdmin: false,
})

export async function boot() {
	session.error = null
	try {
		const data = await api("boot.get_boot")
		session.user = data.user
		session.workspaces = data.workspaces
		session.personalWorkspace = data.personal_workspace
		session.limits = data.limits
		session.isAdmin = data.is_admin
		session.ready = true
	} catch (error) {
		session.error = error
		throw error
	}
}

export async function refreshWorkspaces() {
	session.workspaces = await api("workspace.list_workspaces")
	return session.workspaces
}

export function findWorkspace(name) {
	return session.workspaces.find((workspace) => workspace.name === name) || null
}

export function rememberWorkspace(name) {
	writeStored(LAST_WORKSPACE, name)
}

export function homeWorkspace() {
	const last = readStored(LAST_WORKSPACE)
	return findWorkspace(last)?.name || session.personalWorkspace || session.workspaces[0]?.name
}
