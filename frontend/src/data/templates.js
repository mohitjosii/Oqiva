import { api } from "@/data/api"

// The published template catalogue: cards with a small preview, never the documents.
export function listTemplates() {
	return api("template.list_templates")
}

// Creates a board in a workspace as a server-side copy of a template.
export function createBoardFromTemplate({ workspace, template, project = null, title = null }) {
	return api("board.create_board", { workspace, project, title, template })
}
