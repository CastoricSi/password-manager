// "Sign in with Google once, stay connected" for cloud sync.
//
// Authorization-code flow with offline access, done by the Worker because it
// needs the client secret. The long-lived refresh token never reaches page
// JavaScript: it lives AES-GCM-encrypted (with SESSION_SECRET) in an HttpOnly,
// Secure, SameSite=Lax cookie scoped to /api/auth. The page only ever gets
// short-lived access tokens limited to files this app created or the user
// picked (scope drive.file).

import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

export type AuthEnv = {
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	/** Any long random string; encrypts the session cookie. */
	SESSION_SECRET?: string;
	/** Browser API key + project number, for Google's file picker (accepting shared books). */
	GOOGLE_API_KEY?: string;
	GOOGLE_APP_ID?: string;
	/** Share notices ("A shared book X with you"). Optional. */
	SHARES?: KVNamespace;
};

type Ctx = Context<{ Bindings: AuthEnv }>;

const SCOPE = "openid email https://www.googleapis.com/auth/drive.file";
const SESSION_COOKIE = "pm_google";
const STATE_COOKIE = "pm_google_state";
const COOKIE_PATH = "/api/auth";
const SESSION_MAX_AGE = 400 * 24 * 3600; // browsers cap cookies at ~400 days

export const isConfigured = (env: AuthEnv) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);

const redirectUri = (c: Ctx) => `${new URL(c.req.url).origin}/api/auth/google/callback`;
const secure = (c: Ctx) => new URL(c.req.url).protocol === "https:";

// ── Cookie encryption ────────────────────────────────────────────────────────

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

async function cookieKey(secret: string) {
	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pm-session:${secret}`));
	return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export type Session = { rt: string; email: string };

async function sealSession(secret: string, session: Session): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cookieKey(secret), new TextEncoder().encode(JSON.stringify(session)));
	return `${b64url(iv)}.${b64url(new Uint8Array(data))}`;
}

export async function openSession(secret: string, value: string | undefined): Promise<Session | null> {
	if (!value) return null;
	try {
		const [iv, data] = value.split(".");
		const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await cookieKey(secret), fromB64url(data));
		const s = JSON.parse(new TextDecoder().decode(plain)) as Session;
		return typeof s.rt === "string" ? s : null;
	} catch {
		return null;
	}
}

// ── Pages returned to the sign-in popup ──────────────────────────────────────

function popupResult(c: Ctx, ok: boolean) {
	const origin = new URL(c.req.url).origin;
	const message = JSON.stringify({ type: "pm-google-auth", ok });
	// Tell the app window, then close. Without a popup (e.g. blocked), go home.
	const html = `<!doctype html><meta charset="utf-8"><title>…</title><script>
try { if (window.opener) { window.opener.postMessage(${message}, ${JSON.stringify(origin)}); window.close(); } } catch (e) {}
setTimeout(function () { location.replace("/"); }, 300);
</script>`;
	return c.html(html);
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function config(c: Ctx) {
	if (!isConfigured(c.env)) return c.json({ available: false });
	const session = await openSession(c.env.SESSION_SECRET!, getCookie(c, SESSION_COOKIE));
	const picker = c.env.GOOGLE_API_KEY && c.env.GOOGLE_APP_ID ? { apiKey: c.env.GOOGLE_API_KEY, appId: c.env.GOOGLE_APP_ID } : null;
	return c.json({ available: true, connected: !!session, email: session?.email ?? null, picker, notices: !!c.env.SHARES });
}

/** The signed-in user's session (from the cookie), or null. */
export async function currentSession(c: Ctx): Promise<Session | null> {
	if (!isConfigured(c.env)) return null;
	return openSession(c.env.SESSION_SECRET!, getCookie(c, SESSION_COOKIE));
}

/** A fresh Google access token for this session (null if revoked). */
export async function accessTokenFor(env: AuthEnv, session: Session): Promise<string | null> {
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.GOOGLE_CLIENT_ID!,
			client_secret: env.GOOGLE_CLIENT_SECRET!,
			refresh_token: session.rt,
			grant_type: "refresh_token",
		}),
	});
	if (!res.ok) return null;
	return ((await res.json()) as { access_token: string }).access_token;
}

export function start(c: Ctx) {
	if (!isConfigured(c.env)) return c.text("Cloud sync is not configured", 503);
	const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
	setCookie(c, STATE_COOKIE, state, { path: COOKIE_PATH, httpOnly: true, secure: secure(c), sameSite: "Lax", maxAge: 600 });
	const params = new URLSearchParams({
		client_id: c.env.GOOGLE_CLIENT_ID!,
		redirect_uri: redirectUri(c),
		response_type: "code",
		scope: SCOPE,
		access_type: "offline",
		prompt: "consent", // guarantees a refresh token
		include_granted_scopes: "true",
		state,
	});
	return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export async function callback(c: Ctx) {
	if (!isConfigured(c.env)) return popupResult(c, false);
	const { code, state } = c.req.query();
	const expected = getCookie(c, STATE_COOKIE);
	deleteCookie(c, STATE_COOKIE, { path: COOKIE_PATH });
	if (!code || !state || state !== expected) return popupResult(c, false);

	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: c.env.GOOGLE_CLIENT_ID!,
			client_secret: c.env.GOOGLE_CLIENT_SECRET!,
			redirect_uri: redirectUri(c),
			grant_type: "authorization_code",
		}),
	});
	if (!res.ok) return popupResult(c, false);
	const tokens = (await res.json()) as { refresh_token?: string; id_token?: string; scope?: string };
	if (!tokens.refresh_token || !tokens.scope?.includes("drive.file")) return popupResult(c, false);

	// The id_token came straight from Google over TLS; we only read the email.
	let email = "";
	try {
		email = JSON.parse(new TextDecoder().decode(fromB64url(tokens.id_token!.split(".")[1]))).email ?? "";
	} catch {
		// Email is only for display.
	}

	setCookie(c, SESSION_COOKIE, await sealSession(c.env.SESSION_SECRET!, { rt: tokens.refresh_token, email }), {
		path: COOKIE_PATH,
		httpOnly: true,
		secure: secure(c),
		sameSite: "Lax",
		maxAge: SESSION_MAX_AGE,
	});
	return popupResult(c, true);
}

/** Exchanges the session cookie for a short-lived Drive access token. */
export async function token(c: Ctx) {
	if (c.req.header("X-Requested-With") !== "password-manager") return c.text("Forbidden", 403);
	if (!isConfigured(c.env)) return c.json({ error: "not_configured" }, 503);
	const session = await openSession(c.env.SESSION_SECRET!, getCookie(c, SESSION_COOKIE));
	if (!session) return c.json({ error: "not_connected" }, 401);

	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: c.env.GOOGLE_CLIENT_ID!,
			client_secret: c.env.GOOGLE_CLIENT_SECRET!,
			refresh_token: session.rt,
			grant_type: "refresh_token",
		}),
	});
	if (res.status === 400 || res.status === 401) {
		// Revoked or expired: the user has to connect again.
		deleteCookie(c, SESSION_COOKIE, { path: COOKIE_PATH });
		return c.json({ error: "not_connected" }, 401);
	}
	if (!res.ok) return c.json({ error: "google_unavailable" }, 502);
	const data = (await res.json()) as { access_token: string; expires_in: number };
	c.header("Cache-Control", "no-store");
	return c.json({ accessToken: data.access_token, expiresIn: data.expires_in, email: session.email });
}

export async function disconnect(c: Ctx) {
	if (c.req.header("X-Requested-With") !== "password-manager") return c.text("Forbidden", 403);
	if (isConfigured(c.env)) {
		const session = await openSession(c.env.SESSION_SECRET!, getCookie(c, SESSION_COOKIE));
		if (session) {
			await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(session.rt)}`, { method: "POST" }).catch(() => {});
		}
	}
	deleteCookie(c, SESSION_COOKIE, { path: COOKIE_PATH });
	return c.json({ ok: true });
}
