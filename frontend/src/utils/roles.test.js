import { describe, expect, it } from "vitest"
import { atLeast, workspacePowers } from "./roles"

describe("workspacePowers", () => {
	it("gives a Member creation but not management", () => {
		const powers = workspacePowers({ role: "Member" })
		expect(powers.canCreate).toBe(true)
		expect(powers.canManageMembers).toBe(false)
		expect(powers.canLeave).toBe(true)
	})

	it("lets only a non-personal Owner delete, and the Owner never leave", () => {
		const owner = workspacePowers({ role: "Owner", is_owner: true })
		expect(owner.canDelete).toBe(true)
		expect(owner.canLeave).toBe(false)
		expect(
			workspacePowers({ role: "Owner", is_owner: true, is_personal: true }).canDelete,
		).toBe(false)
	})

	it("gives a Guest nothing", () => {
		const guest = workspacePowers({ role: "Guest" })
		expect(guest.canCreate).toBe(false)
		expect(guest.canManageMembers).toBe(false)
	})

	it("orders the roles", () => {
		expect(atLeast("Admin", "Member")).toBe(true)
		expect(atLeast("Guest", "Member")).toBe(false)
		expect(atLeast(undefined, "Guest")).toBe(false)
	})
})
