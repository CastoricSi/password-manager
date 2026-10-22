import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Tests cover the pure modules (crypto, vault logic) and run in Node, which
// provides WebCrypto out of the box. No browser/Cloudflare plugins needed.
export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src/react-app", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
