import path from "path"
import vue from "@vitejs/plugin-vue"
import frappeui from "frappe-ui/vite"
import { defineConfig } from "vite"

export default defineConfig({
	plugins: [
		frappeui({
			// Dev proxy to the Frappe webserver, production base URL, build output in
			// the app's public folder, and the built index.html copied to www/oqiva.html.
			frappeProxy: true,
			lucideIcons: true,
			// The csrf token and boot data are injected by www/oqiva.py and index.html.
			jinjaBootData: false,
			frontendRoute: "/oqiva",
			buildConfig: {
				outDir: "../oqiva/public/frontend",
				baseUrl: "/assets/oqiva/frontend/",
				indexHtmlPath: "../oqiva/www/oqiva.html",
			},
		}),
		vue(),
	],
	resolve: {
		alias: { "@": path.resolve(__dirname, "src") },
	},
	server: { port: 8081, allowedHosts: true },
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.js"],
	},
})
