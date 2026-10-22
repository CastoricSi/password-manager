import { defineConfig, type Plugin } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * Dev only: Vite marks files under node_modules "immutable" for a year, but a
 * new sityle release keeps the same URL — the browser would go on running the
 * old one. Make the browser re-check sityle on every load.
 */
const freshSityle = (): Plugin => ({
	name: "fresh-sityle",
	apply: "serve",
	configureServer(server) {
		server.middlewares.use((req, res, next) => {
			if (req.url?.startsWith("/node_modules/sityle/")) {
				const setHeader = res.setHeader.bind(res);
				res.setHeader = (name, value) => setHeader(name, name.toLowerCase() === "cache-control" ? "no-cache" : value);
			}
			next();
		});
	},
});

export default defineConfig({
	plugins: [freshSityle(), react(), cloudflare()],
	// Serve sityle straight from node_modules: a prebundled copy goes stale
	// when a new release is installed (the dev page then breaks).
	optimizeDeps: { exclude: ["sityle"] },
	resolve: {
		// One React / Motion even when sityle is linked locally (npm i ../sityle).
		dedupe: ["react", "react-dom", "motion", "lucide-react"],
		alias: {
			"@": fileURLToPath(new URL("./src/react-app", import.meta.url)),
		},
	},
});
