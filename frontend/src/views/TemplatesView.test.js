import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("vue-router", () => ({
	useRoute: () => ({ params: { workspace: "W1" } }),
	useRouter: () => ({ push }),
}))
// frappe-ui does not load under vitest, so the few parts the page uses are stood in for.
vi.mock("frappe-ui", async () => {
	const { defineComponent, h } = await import("vue")
	return {
		toast: { error: vi.fn() },
		FeatherIcon: defineComponent({ render: () => h("i") }),
		Button: defineComponent({
			props: ["label", "loading", "disabled"],
			emits: ["click"],
			render() {
				return h(
					"button",
					{ type: "button", disabled: this.disabled, onClick: () => this.$emit("click") },
					this.label,
				)
			},
		}),
		FormControl: defineComponent({
			props: ["modelValue", "type"],
			emits: ["update:modelValue"],
			render() {
				return h("input", {
					type: this.type,
					value: this.modelValue,
					onInput: (e) => this.$emit("update:modelValue", e.target.value),
				})
			},
		}),
	}
})
vi.mock("@/data/api", () => ({ api: vi.fn() }))
vi.mock("@/data/session", () => ({
	findWorkspace: () => ({ name: "W1", role: "Member" }),
}))

import { api } from "@/data/api"
import TemplatesView from "./TemplatesView.vue"

const card = (slug, name, category, tags = []) => ({
	slug,
	name,
	description: `About ${name}`,
	category,
	tags,
	preview_image: null,
	object_count: 1,
	preview: {
		objects: [
			{
				id: "a",
				kind: "shape",
				shape: "rectangle",
				x: 0,
				y: 0,
				w: 100,
				h: 50,
				style: {},
				label: "Hi",
			},
		],
		connectors: [],
	},
})

const catalogue = {
	templates: [
		card("blank", "Blank board", "Basics"),
		card("kanban", "Kanban", "Planning", ["agile"]),
	],
	categories: ["Basics", "Planning"],
}

async function open() {
	const wrapper = mount(TemplatesView)
	await flushPromises()
	return wrapper
}

describe("TemplatesView", () => {
	beforeEach(() => {
		api.mockReset()
		push.mockReset()
	})

	it("shows a card with a preview for each template", async () => {
		api.mockResolvedValue(catalogue)
		const wrapper = await open()
		expect(api).toHaveBeenCalledWith("template.list_templates")
		expect(wrapper.findAll("article")).toHaveLength(2)
		expect(wrapper.find('svg[role="img"]').attributes("aria-label")).toBe(
			"Preview of Blank board",
		)
		expect(wrapper.text()).toContain("About Kanban")
	})

	it("filters by search and category, and offers Clear filters when nothing matches", async () => {
		api.mockResolvedValue(catalogue)
		const wrapper = await open()
		await wrapper.find('input[type="search"]').setValue("AGILE")
		expect(wrapper.findAll("article")).toHaveLength(1)
		await wrapper.find('input[type="search"]').setValue("zzz")
		expect(wrapper.text()).toContain("No templates match")
		const clear = wrapper.findAll("button").find((b) => b.text() === "Clear filters")
		await clear.trigger("click")
		expect(wrapper.findAll("article")).toHaveLength(2)
		const chip = wrapper.findAll("button[aria-pressed]").find((b) => b.text() === "Planning")
		await chip.trigger("click")
		expect(chip.attributes("aria-pressed")).toBe("true")
		expect(wrapper.findAll("article")).toHaveLength(1)
	})

	it("creates the board from the template and opens it", async () => {
		api.mockResolvedValueOnce(catalogue).mockResolvedValueOnce({ name: "B1" })
		const wrapper = await open()
		await wrapper.find('button[aria-label="Use template Kanban"]').trigger("click")
		await flushPromises()
		expect(api).toHaveBeenLastCalledWith("board.create_board", {
			workspace: "W1",
			project: null,
			title: null,
			template: "kanban",
		})
		expect(push).toHaveBeenCalledWith({ name: "board", params: { board: "B1" } })
	})

	it("shows the error state with a retry", async () => {
		api.mockRejectedValueOnce({ status: 500 }).mockResolvedValueOnce(catalogue)
		const wrapper = await open()
		expect(wrapper.find('[role="alert"]').exists()).toBe(true)
		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Try again")
			.trigger("click")
		await flushPromises()
		expect(wrapper.findAll("article")).toHaveLength(2)
	})

	it("says so when there are no templates at all", async () => {
		api.mockResolvedValue({ templates: [], categories: [] })
		const wrapper = await open()
		expect(wrapper.text()).toContain("No templates yet")
	})
})
