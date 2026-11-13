import { Dialogs, FrappeUI, frappeRequest, setConfig } from "frappe-ui"
import { createApp } from "vue"

import App from "./App.vue"
import { applyTheme } from "./data/preferences"
import { labelDialogButtons } from "./utils/dialogLabels"
import router from "./router"
import "./index.css"

// Every frappe-ui resource goes through Frappe's request layer, which adds the CSRF
// token and session cookie. The server remains the only authority on access.
setConfig("resourceFetcher", frappeRequest)

applyTheme()
labelDialogButtons()

const app = createApp(App)
// Realtime arrives with collaboration (Phase 5), so the socket stays off until then.
app.use(FrappeUI, { socketio: false })
app.use(router)
app.component("Dialogs", Dialogs)
app.mount("#app")
