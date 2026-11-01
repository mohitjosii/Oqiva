// Walks the Phase 1 and 2 home area as a real user would.
import { expect } from "./expect.mjs"
import { BASE, credentials, finish, launch, shot, signedIn, step } from "./lib.mjs"

const creds = credentials()
const browser = await launch()
const { page, problems } = await signedIn(browser, creds.a)
const stamp = Date.now().toString(36)
const boardName = `Roadmap ${stamp}`
const projectName = `Platform ${stamp}`

await step("opens the app and lands on the welcome page", async () => {
	await page.goto(`${BASE}/oqiva`)
	await expect(page.getByRole("heading", { name: /Welcome to Oqiva/ })).toBeVisible()
	await shot(page, "01-welcome")
})

await step("continues to the dashboard", async () => {
	await page.getByRole("button", { name: "Continue" }).click()
	await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible()
})

await step("creates a fresh workspace, which starts empty with a first-run prompt", async () => {
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Create workspace" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel("Workspace name").fill(`E2E ${stamp}`)
	await dialog.getByRole("button", { name: "Create" }).click()
	await expect(page.getByRole("heading", { name: "Create your first board" })).toBeVisible()
	await shot(page, "02-dashboard-empty")
})

await step("creates a board and opens it", async () => {
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	await expect(page.getByRole("heading", { name: "The canvas editor is coming next" })).toBeVisible()
	await shot(page, "03-board")
	await page.getByRole("button", { name: "Back to workspace" }).first().click()
	await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible()
})

await step("renames the board from its menu", async () => {
	await page.getByRole("button", { name: /Actions for Untitled board/ }).click()
	await page.getByRole("menuitem", { name: "Rename or describe" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel("Name").fill(boardName)
	await dialog.getByRole("button", { name: "Save" }).click()
	await expect(page.getByRole("heading", { name: boardName })).toBeVisible()
})

await step("creates a project from the sidebar", async () => {
	await page.getByRole("button", { name: "New project" }).first().click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel("Name").fill(projectName)
	await dialog.getByRole("button", { name: "violet" }).click()
	await dialog.getByRole("button", { name: "Create" }).click()
	await expect(page.getByRole("heading", { name: projectName })).toBeVisible()
	await expect(page.getByRole("heading", { name: "No boards in this project" })).toBeVisible()
	await shot(page, "04-project-empty")
})

await step("creates a board inside the project", async () => {
	await page.getByRole("button", { name: "New board" }).first().click()
	await page.waitForURL(/\/oqiva\/board\//)
	await page.getByRole("button", { name: "Back to workspace" }).first().click()
	await expect(page.getByRole("heading", { name: projectName })).toBeVisible()
	await expect(page.getByRole("heading", { name: "Untitled board" })).toBeVisible()
})

await step("stars a board and finds it under Favorites", async () => {
	await page.getByRole("button", { name: "Add to favorites" }).first().click({ force: true })
	await page.getByRole("link", { name: "Favorites" }).click()
	await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible()
	await expect(page.getByRole("heading", { name: "Untitled board" })).toBeVisible()
})

await step("lists opened boards under Recent", async () => {
	await page.getByRole("link", { name: "Recent" }).click()
	await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible()
	await expect(page.getByRole("heading", { name: "Untitled board" })).toBeVisible()
})

await step("searches with Ctrl+K", async () => {
	await page.keyboard.press("Control+k")
	const search = page.getByRole("dialog").getByLabel("Search")
	await search.fill(boardName.slice(0, 12))
	await expect(page.getByRole("option", { name: new RegExp(boardName) })).toBeVisible()
	await shot(page, "05-search")
	await page.keyboard.press("Escape")
	await expect(page.getByRole("dialog")).toHaveCount(0)
})

await step("trashes, restores, trashes and permanently deletes a board", async () => {
	await page.getByRole("link", { name: "Home" }).click()
	await page.getByRole("button", { name: `Actions for ${boardName}` }).click()
	await page.getByRole("menuitem", { name: "Move to Trash" }).click()
	await page.getByRole("button", { name: "Confirm" }).click()
	await page.getByRole("link", { name: "Trash" }).click()
	await expect(page.getByRole("heading", { name: boardName })).toBeVisible()
	await shot(page, "06-trash")
	await page.getByRole("button", { name: `Actions for ${boardName}` }).click()
	await page.getByRole("menuitem", { name: "Restore" }).click()
	await expect(page.getByRole("heading", { name: "Trash is empty" })).toBeVisible()
	await page.getByRole("link", { name: "Home" }).click()
	await page.getByRole("button", { name: `Actions for ${boardName}` }).click()
	await page.getByRole("menuitem", { name: "Move to Trash" }).click()
	await page.getByRole("button", { name: "Confirm" }).click()
	await page.getByRole("link", { name: "Trash" }).click()
	await page.getByRole("button", { name: `Actions for ${boardName}` }).click()
	await page.getByRole("menuitem", { name: "Delete permanently" }).click()
	const dialog = page.getByRole("dialog")
	const forever = dialog.getByRole("button", { name: "Delete forever" })
	await expect(forever).toBeDisabled()
	await dialog.getByPlaceholder("Board name").fill(boardName)
	await forever.click()
	await expect(page.getByRole("heading", { name: "Trash is empty" })).toBeVisible()
})

await step("invites a registered user from the members dialog", async () => {
	await page.getByRole("button", { name: /Switch workspace/ }).click()
	await page.getByRole("menuitem", { name: "Members" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel("Invite by email").fill(creds.b.user)
	await dialog.getByRole("button", { name: "Invite" }).click()
	await expect(dialog.getByText("E2E B")).toBeVisible()
	await shot(page, "07-members")
	await page.keyboard.press("Escape")
})

await step("switches to dark mode for the chrome", async () => {
	await page.getByRole("button", { name: /Account menu/ }).click()
	await page.getByRole("menuitem", { name: "Dark mode" }).click()
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
	await shot(page, "08-dark")
})

await step("shows a friendly not-found page for a bad link", async () => {
	const before = problems.length
	await page.goto(`${BASE}/oqiva/board/not-a-real-board`)
	await expect(page.getByText(/could not be found/)).toBeVisible()
	await page.goto(`${BASE}/oqiva/nowhere/at/all`)
	await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible()
	problems.splice(before) // the 404 for the missing board is the point of this step
})

await browser.close()
finish(problems)
