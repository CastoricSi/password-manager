// Offline support for the app shell. Navigations are network-first (falling
// back to the cached page); hashed static assets are cache-first. The password
// book is stored encrypted in IndexedDB and never passes through here.
const CACHE = "password-book-shell-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
			await self.clients.claim();
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	const url = new URL(request.url);
	// Only the app shell: never Google sign-in / token endpoints or other origins.
	if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

	if (request.mode === "navigate") {
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE);
				try {
					const fresh = await fetch(request);
					cache.put("/", fresh.clone());
					return fresh;
				} catch {
					return (await cache.match("/")) || Response.error();
				}
			})(),
		);
		return;
	}

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			const cached = await cache.match(request);
			if (cached) return cached;
			const fresh = await fetch(request);
			if (fresh.ok) cache.put(request, fresh.clone());
			return fresh;
		})(),
	);
});
