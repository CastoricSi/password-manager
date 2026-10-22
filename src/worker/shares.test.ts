import { afterEach, describe, expect, it, vi } from "vitest";

import app from "./index";

/** Minimal in-memory KV. */
function fakeKV() {
	const data = new Map<string, string>();
	return {
		data,
		kv: {
			get: async (k: string, type?: string) => (data.has(k) ? (type === "json" ? JSON.parse(data.get(k)!) : data.get(k)) : null),
			put: async (k: string, v: string) => void data.set(k, v),
			delete: async (k: string) => void data.delete(k),
		} as unknown as KVNamespace,
	};
}

const BASE = "https://pm.example.com";
const H = { "X-Requested-With": "password-manager", "Content-Type": "application/json" };
const idToken = (email: string) => `x.${btoa(JSON.stringify({ email })).replace(/=+$/, "")}.y`;

afterEach(() => vi.unstubAllGlobals());

/** Signs `email` in through the real callback (with Google mocked); returns the cookie header. */
async function signIn(env: object, email: string) {
	const start = await app.request(`${BASE}/api/auth/google/start`, {}, env);
	const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
	const stateCookie = start.headers.getSetCookie()[0].split(";")[0];
	vi.stubGlobal("fetch", async () => Response.json({ refresh_token: `rt-${email}`, id_token: idToken(email), scope: "openid email https://www.googleapis.com/auth/drive.file" }));
	const cb = await app.request(`${BASE}/api/auth/google/callback?code=c&state=${state}`, { headers: { Cookie: stateCookie } }, env);
	return cb.headers.getSetCookie().find((c) => c.startsWith("pm_google="))!.split(";")[0];
}

/** Google mock: tokens always issue; `canShare` decides the Drive capability check. */
function mockGoogle(canShare: boolean) {
	vi.stubGlobal("fetch", async (url: string) => {
		if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "at", expires_in: 3600 });
		if (url.includes("/drive/v3/files/")) return Response.json({ capabilities: { canShare } });
		return new Response("", { status: 404 });
	});
}

describe("share notices", () => {
	it("owner leaves a notice; the friend sees it and can clear it", async () => {
		const { kv, data } = fakeKV();
		const env = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", SESSION_SECRET: "secret", SHARES: kv };
		const owner = await signIn(env, "a@x.com");
		const friend = await signIn(env, "b@x.com");

		mockGoogle(true);
		const post = await app.request(`${BASE}/api/shares`, { method: "POST", headers: { ...H, Cookie: owner }, body: JSON.stringify({ fileId: "F1", bookId: "B1", bookName: "家庭", to: "B@x.com" }) }, env);
		expect(post.status).toBe(200);
		expect([...data.keys()]).toEqual(["inbox:b@x.com"]);
		expect(data.get("inbox:b@x.com")).not.toContain("rt-"); // only metadata

		const list = await app.request(`${BASE}/api/shares`, { headers: { ...H, Cookie: friend } }, env);
		const { notices } = (await list.json()) as { notices: Array<{ fileId: string; from: string; bookName: string }> };
		expect(notices).toMatchObject([{ fileId: "F1", from: "a@x.com", bookName: "家庭" }]);

		// The owner's own inbox is empty.
		const mine = (await (await app.request(`${BASE}/api/shares`, { headers: { ...H, Cookie: owner } }, env)).json()) as { notices: unknown[] };
		expect(mine.notices).toEqual([]);

		await app.request(`${BASE}/api/shares/F1`, { method: "DELETE", headers: { ...H, Cookie: friend } }, env);
		expect(data.size).toBe(0);
	});

	it("refuses notices for files the caller can't share", async () => {
		const { kv, data } = fakeKV();
		const env = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", SESSION_SECRET: "secret", SHARES: kv };
		const someone = await signIn(env, "c@x.com");
		mockGoogle(false);
		const post = await app.request(`${BASE}/api/shares`, { method: "POST", headers: { ...H, Cookie: someone }, body: JSON.stringify({ fileId: "F1", bookId: "B1", bookName: "x", to: "b@x.com" }) }, env);
		expect(post.status).toBe(403);
		expect(data.size).toBe(0);
	});

	it("needs a session, the app header and the KV binding", async () => {
		const { kv } = fakeKV();
		const env = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", SESSION_SECRET: "secret", SHARES: kv };
		expect((await app.request(`${BASE}/api/shares`, {}, env)).status).toBe(403);
		expect((await app.request(`${BASE}/api/shares`, { headers: H }, env)).status).toBe(401);
		const noKv = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", SESSION_SECRET: "secret" };
		expect((await app.request(`${BASE}/api/shares`, { headers: H }, noKv)).status).toBe(503);
	});
});
