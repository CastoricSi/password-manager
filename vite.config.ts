import { defineConfig, type Plugin } from "vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

const versionOf = (file: string) => (JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")) as { version: string }).version;

/** The commit being built: Cloudflare's build env, else git ("+" = uncommitted changes); "" without either. */
function commit(): string {
	const ci = process.env.WORKERS_CI_COMMIT_SHA;
	if (ci) return ci.slice(0, 7);
	try {
		const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
		const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() !== "";
		return sha + (dirty ? "+" : "");
	} catch {
		return "";
	}
}

export default defineConfig({
	plugins: [freshSityle(), react(), cloudflare()],
	// Which build this is: shown at the foot of the start screen.
	define: {
		__PM_BUILD__: JSON.stringify({
			version: versionOf("./package.json"),
			commit: commit(),
			sityle: versionOf("./node_modules/sityle/package.json"),
			time: new Date().toISOString(),
		}),
	},
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
