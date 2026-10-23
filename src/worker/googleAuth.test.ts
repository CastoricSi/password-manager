import { afterEach, describe, expect, it, vi } from "vitest";

import app from "./index";

const env = { GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret", SESSION_SECRET: "a-long-random-test-secret" };
const BASE = "https://pm.example.com";

/** Collects Set-Cookie headers into a Cookie header value. Like a browser, a cookie is
 *  name + path: deleting pm_google on one path leaves the one on another. */
const paths = new WeakMap<Record<string, string>, Record<string, string>>();
function cookiesFrom(res: Response, jar: Record<string, string> = {}) {
	const at = paths.get(jar) ?? {};
	paths.set(jar, at);
	for (const line of res.headers.getSetCookie()) {
		const [pair, ...attrs] = line.split(";");
		const [name, ...rest] = pair.split("=");
		const value = rest.join("=");
		const path = attrs.map((a) => a.trim()).find((a) => /^path=/i.test(a))?.slice(5) ?? "/";
		if (value) {
			jar[name] = value;
			at[name] = path;
		} else if (at[name] === path) delete jar[name];
	}
	return jar;
}
const cookieHeader = (jar: Record<string, string>) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
const idToken = (email: string) => `x.${btoa(JSON.stringify({ email })).replace(/=+$/, "")}.y`;

afterEach(() => vi.unstubAllGlobals());

describe("Google sign-in for sync (Worker)", () => {
	it("reports unavailable when not configured", async () => {
		const res = await app.request(`${BASE}/api/sync/config`, {}, {});
		expect(await res.json()).toEqual({ available: false });
	});

	it("connects once, then hands out short-lived tokens from the session cookie", async () => {
		// 1. Start: redirects to Google with offline access + drive.file, sets a state cookie.
		const start = await app.request(`${BASE}/api/auth/google/start`, {}, env);
		expect(start.status).toBe(302);
		const location = new URL(start.headers.get("Location")!);
		expect(location.host).toBe("accounts.google.com");
		expect(location.searchParams.get("access_type")).toBe("offline");
		expect(location.searchParams.get("scope")).toContain("drive.file");
		expect(location.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/google/callback`);
		const jar = cookiesFrom(start);
		const state = location.searchParams.get("state")!;

		// 2. Callback: exchanges the code (mocked Google) and stores an encrypted session.
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			void init;
			if (url.includes("/token")) {
				return Response.json({ refresh_token: "refresh-123", id_token: idToken("wang@example.com"), scope: "openid email https://www.googleapis.com/auth/drive.file" });
			}
			return new Response("", { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);
		const cb = await app.request(`${BASE}/api/auth/google/callback?code=abc&state=${state}`, { headers: { Cookie: cookieHeader(jar) } }, env);
		expect(await cb.text()).toContain('"ok":true');
		cookiesFrom(cb, jar);
		expect(jar.pm_google).toBeTruthy();
		expect(jar.pm_google).not.toContain("refresh-123"); // encrypted, not readable
		const setCookie = cb.headers.getSetCookie().find((c) => c.startsWith("pm_google="))!;
		expect(setCookie).toMatch(/HttpOnly/i);
		expect(setCookie).toMatch(/Secure/i);
		// every API route that needs the session gets it (a cookie on /api/auth never reached the config)
		expect(setCookie).toMatch(/Path=\/api(;|$)/);

		// 3. Config shows the connected account.
		const cfg = await app.request(`${BASE}/api/sync/config`, { headers: { Cookie: cookieHeader(jar) } }, env);
		expect(await cfg.json()).toMatchObject({ available: true, connected: true, email: "wang@example.com" });

		// 4. Token: refreshes with the stored refresh token.
		fetchMock.mockImplementation(async () => Response.json({ access_token: "access-xyz", expires_in: 3599 }));
		const tok = await app.request(`${BASE}/api/auth/google/token`, { method: "POST", headers: { Cookie: cookieHeader(jar), "X-Requested-With": "password-manager" } }, env);
		expect(await tok.json()).toEqual({ accessToken: "access-xyz", expiresIn: 3599, email: "wang@example.com" });
		const body = String(fetchMock.mock.calls.at(-1)?.[1]?.body);
		expect(body).toContain("refresh_token=refresh-123");

		// 5. Disconnect revokes and clears the cookie.
		const out = await app.request(`${BASE}/api/auth/google/disconnect`, { method: "POST", headers: { Cookie: cookieHeader(jar), "X-Requested-With": "password-manager" } }, env);
		expect(out.status).toBe(200);
		expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("/revoke");
		cookiesFrom(out, jar);
		expect(jar.pm_google).toBeUndefined();
	});

	it("a session left at the old cookie path (/api/auth) is still seen, and moved to /api", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ refresh_token: "refresh-old", id_token: idToken("li@example.com"), scope: "openid email https://www.googleapis.com/auth/drive.file" })),
		);
		const start = await app.request(`${BASE}/api/auth/google/start`, {}, env);
		const jar = cookiesFrom(start);
		const cb = await app.request(`${BASE}/api/auth/google/callback?code=abc&state=${jar.pm_google_state}`, { headers: { Cookie: cookieHeader(jar) } }, env);
		const sealed = cookiesFrom(cb, {}).pm_google!;
		// the browser sends an /api/auth cookie only to /api/auth/*: the app's config check is there
		const cfg = await app.request(`${BASE}/api/auth/config`, { headers: { Cookie: `pm_google=${sealed}` } }, env);
		expect(await cfg.json()).toMatchObject({ connected: true, email: "li@example.com" });
		const set = cfg.headers.getSetCookie().filter((c) => c.startsWith("pm_google="));
		expect(set.some((c) => /Path=\/api(;|$)/.test(c) && !c.startsWith("pm_google=;"))).toBe(true);
		expect(set.some((c) => /Path=\/api\/auth/.test(c) && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c))).toBe(true);
	});

	it("rejects a callback whose state doesn't match", async () => {
		const res = await app.request(`${BASE}/api/auth/google/callback?code=abc&state=forged`, { headers: { Cookie: "pm_google_state=real" } }, env);
		expect(await res.text()).toContain('"ok":false');
		expect(res.headers.getSetCookie().some((c) => c.startsWith("pm_google=") && !c.startsWith("pm_google=;"))).toBe(false);
	});

	it("token endpoint needs the app header and a session", async () => {
		expect((await app.request(`${BASE}/api/auth/google/token`, { method: "POST" }, env)).status).toBe(403);
		const res = await app.request(`${BASE}/api/auth/google/token`, { method: "POST", headers: { "X-Requested-With": "password-manager" } }, env);
		expect(res.status).toBe(401);
	});

	it("a forged or tampered session cookie is ignored", async () => {
		const res = await app.request(`${BASE}/api/auth/google/token`, { method: "POST", headers: { Cookie: "pm_google=AAAA.BBBB", "X-Requested-With": "password-manager" } }, env);
		expect(res.status).toBe(401);
	});
});
