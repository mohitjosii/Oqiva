import { createRouter, createWebHistory } from "vue-router"
import { boot, findWorkspace, homeWorkspace, rememberWorkspace, session } from "@/data/session"
import { preferences } from "@/data/preferences"

const AppShell = () => import("@/components/AppShell.vue")

const routes = [
	// "/" has no page of its own: the guard below sends it to the user's workspace once
	// the app has booted. A redirect here would run before the guard, with no workspaces.
	{ path: "/", name: "root", component: { render: () => null } },
	{ path: "/welcome", name: "welcome", component: () => import("@/views/WelcomeView.vue") },
	{ path: "/board/:board", name: "board", component: () => import("@/views/BoardView.vue") },
	{
		path: "/w/:workspace",
		component: AppShell,
		children: [
			{ path: "", name: "dashboard", component: () => import("@/views/DashboardView.vue") },
			{
				path: "p/:project",
				name: "project",
				component: () => import("@/views/ProjectView.vue"),
			},
			...["recent", "favorites", "shared", "archived", "trash"].map((scope) => ({
				path: scope,
				name: scope,
				component: () => import("@/views/BoardListView.vue"),
				props: { scope },
			})),
		],
	},
	{
		path: "/:pathMatch(.*)*",
		name: "not-found",
		component: () => import("@/views/NotFoundView.vue"),
	},
]

const router = createRouter({ history: createWebHistory("/oqiva/"), routes })

router.beforeEach(async (to) => {
	if (!session.ready && !session.error) {
		try {
			await boot()
		} catch {
			return true // App.vue shows the boot error with a retry.
		}
	}
	if (session.error) return true
	if (!preferences.welcomed && to.name !== "welcome") return { name: "welcome" }
	if (to.name === "root") return { name: "dashboard", params: { workspace: homeWorkspace() } }
	if (to.params.workspace) {
		if (!findWorkspace(to.params.workspace)) {
			return { name: "dashboard", params: { workspace: homeWorkspace() } }
		}
		rememberWorkspace(to.params.workspace)
	}
	return true
})

export default router
