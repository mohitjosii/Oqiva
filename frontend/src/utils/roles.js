// Which workspace controls to draw. The server enforces every one of these again.

const RANK = { Guest: 0, Member: 1, Admin: 2, Owner: 3 }

export function atLeast(role, minimum) {
	return (RANK[role] ?? -1) >= RANK[minimum]
}

export function workspacePowers(workspace) {
	const role = workspace?.role
	return {
		canCreate: atLeast(role, "Member"),
		canManageMembers: atLeast(role, "Admin"),
		canRename: atLeast(role, "Admin"),
		canDelete: Boolean(workspace?.is_owner && !workspace?.is_personal),
		canLeave: Boolean(role && !workspace?.is_owner),
		canArchiveProjects: atLeast(role, "Admin"),
	}
}

export const ROLE_DESCRIPTIONS = {
	Owner: "Owns the workspace and everything in it.",
	Admin: "Manages members and projects.",
	Member: "Creates and edits boards.",
	Guest: "Sees only boards shared with them.",
}
