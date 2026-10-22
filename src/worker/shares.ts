// Share notices: "A shared password book X with you".
//
// Sharing itself happens in Google Drive (the owner gives the friend edit
// access to the book's file). But with the drive.file scope the friend's app
// can't see that file until the friend picks it once in Google's file picker.
// So the owner's app also leaves a small notice here, and the friend's app
// shows "A shared X with you — Add". Only ids, the book's name and the sender
// are stored — never book contents.

import type { Context } from "hono";

import { accessTokenFor, currentSession, type AuthEnv } from "./googleAuth";

type Ctx = Context<{ Bindings: AuthEnv }>;

export type ShareNotice = { fileId: string; bookId: string; bookName: string; from: string; at: string };

const inboxKey = (email: string) => `inbox:${email.trim().toLowerCase()}`;
const MAX_NOTICES = 100;

async function readInbox(kv: KVNamespace, email: string): Promise<ShareNotice[]> {
	return ((await kv.get(inboxKey(email), "json")) as ShareNotice[] | null) ?? [];
}

async function writeInbox(kv: KVNamespace, email: string, notices: ShareNotice[]) {
	if (notices.length === 0) await kv.delete(inboxKey(email));
	else await kv.put(inboxKey(email), JSON.stringify(notices.slice(-MAX_NOTICES)));
}

/** True when the caller may share this Drive file (asks Google). */
async function canShare(env: AuthEnv, rt: Parameters<typeof accessTokenFor>[1], fileId: string): Promise<boolean> {
	const token = await accessTokenFor(env, rt);
	if (!token) return false;
	const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=capabilities(canShare)`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) return false;
	return ((await res.json()) as { capabilities?: { canShare?: boolean } }).capabilities?.canShare === true;
}

function guard(c: Ctx) {
	if (c.req.header("X-Requested-With") !== "password-manager") return c.text("Forbidden", 403);
	if (!c.env.SHARES) return c.json({ error: "notices_unavailable" }, 503);
	return null;
}

/** GET: notices addressed to the signed-in user. */
export async function list(c: Ctx) {
	const blocked = guard(c);
	if (blocked) return blocked;
	const session = await currentSession(c);
	if (!session?.email) return c.json({ error: "not_connected" }, 401);
	c.header("Cache-Control", "no-store");
	return c.json({ notices: await readInbox(c.env.SHARES!, session.email) });
}

/** POST {fileId, bookId, bookName, to}: the owner tells `to` about a share. */
export async function create(c: Ctx) {
	const blocked = guard(c);
	if (blocked) return blocked;
	const session = await currentSession(c);
	if (!session?.email) return c.json({ error: "not_connected" }, 401);
	const body = (await c.req.json().catch(() => null)) as Partial<ShareNotice & { to: string }> | null;
	const to = body?.to?.trim().toLowerCase();
	if (!body?.fileId || !body.bookId || !to || !/^[^@\s]+@[^@\s]+$/.test(to)) return c.json({ error: "bad_request" }, 400);
	if (!(await canShare(c.env, session, body.fileId))) return c.json({ error: "forbidden" }, 403);

	const notice: ShareNotice = {
		fileId: body.fileId,
		bookId: body.bookId,
		bookName: String(body.bookName ?? "").slice(0, 100),
		from: session.email,
		at: new Date().toISOString(),
	};
	const inbox = (await readInbox(c.env.SHARES!, to)).filter((n) => n.fileId !== notice.fileId);
	await writeInbox(c.env.SHARES!, to, [...inbox, notice]);
	return c.json({ ok: true });
}

/**
 * DELETE /api/shares/:fileId — the recipient dismisses/accepts a notice;
 * with ?to=email, the owner withdraws a notice (after unsharing).
 */
export async function remove(c: Ctx) {
	const blocked = guard(c);
	if (blocked) return blocked;
	const session = await currentSession(c);
	if (!session?.email) return c.json({ error: "not_connected" }, 401);
	const fileId = c.req.param("fileId");
	const to = c.req.query("to");
	if (to && !(await canShare(c.env, session, fileId))) return c.json({ error: "forbidden" }, 403);
	const email = to ?? session.email;
	const inbox = await readInbox(c.env.SHARES!, email);
	await writeInbox(c.env.SHARES!, email, inbox.filter((n) => n.fileId !== fileId));
	return c.json({ ok: true });
}
