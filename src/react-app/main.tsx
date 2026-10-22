import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "sityle/style.css";
import "sityle/base.css";
import "./layout.css";
import App from "./App";
import { AppProvider } from "@/app/AppProvider";
import { PrefsProvider } from "@/app/PrefsProvider";
import { Theme } from "@/app/Theme";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<PrefsProvider>
			<Theme>
				<AppProvider>
					<App />
				</AppProvider>
			</Theme>
		</PrefsProvider>
	</StrictMode>,
);

// Offline support / installability (production only). The service worker only
// caches the app shell — books live in IndexedDB, and /api is never cached.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(() => {});
	});
}
