// Google Drive client (scope drive.file: only files this app created, or that
// the user picked in Google's file picker). Each password book is one JSON
// file in a visible "Password Manager" folder of the owner's Drive. Books
// shared with the user live in the owner's Drive; once picked they show up in
// the same listing, because we list by the app's own file properties.

import type { BookFile } from "./bookfile";

export type RemoteFile = {
	id: string;
	bookId: string;
	name: string;
	modifiedTime: string;
	deletedAt?: string;
	ownedByMe: boolean;
	ownerEmail: string | null;
	ownerName: string | null;
};

export type Person = { permissionId: string; email: string; name: string; role: string };

export interface Drive {
	list(): Promise<RemoteFile[]>;
	download(id: string): Promise<unknown>;
	create(book: BookFile): Promise<RemoteFile>;
	update(id: string, book: BookFile): Promise<RemoteFile>;
	remove(id: string): Promise<void>;
}

export interface Sharing {
	people(fileId: string): Promise<Person[]>;
	/** Gives `email` edit access (Google also emails them). */
	share(fileId: string, email: string, message?: string): Promise<void>;
	unshare(fileId: string, permissionId: string): Promise<void>;
	/** Removes the current user's own access to someone else's book. */
	leave(fileId: string): Promise<void>;
}

/** A token provider: `force` asks for a fresh token after a 401. */
export type TokenSource = (force?: boolean) => Promise<string>;

export class OfflineError extends Error {}
export class AuthError extends Error {}
export class NotFoundError extends Error {}
/** Google rejected the request (e.g. sharing to an address that can't receive it). */
export class DriveRequestError extends Error {
	constructor(readonly status: number, readonly reason: string) {
		super(`Drive ${status} ${reason}`);
	}
}

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FIELDS = "id,name,modifiedTime,appProperties,ownedByMe,owners(emailAddress,displayName)";
const FOLDER_MIME = "application/vnd.google-apps.folder";

type DriveFile = {
	id: string;
	name: string;
	modifiedTime: string;
	appProperties?: Record<string, string>;
	ownedByMe?: boolean;
	owners?: Array<{ emailAddress?: string; displayName?: string }>;
};

function toRemote(f: DriveFile): RemoteFile | null {
	const p = f.appProperties ?? {};
	if (p.pmBook !== "1" || !p.bookId) return null;
	return {
		id: f.id,
		bookId: p.bookId,
		name: p.bookName ?? f.name,
		modifiedTime: f.modifiedTime,
		...(p.deletedAt ? { deletedAt: p.deletedAt } : {}),
		ownedByMe: f.ownedByMe !== false,
		ownerEmail: f.owners?.[0]?.emailAddress ?? null,
		ownerName: f.owners?.[0]?.displayName ?? null,
	};
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "book";

function multipart(meta: object, book: BookFile): { body: string; type: string } {
	const boundary = `pm-${crypto.randomUUID()}`;
	const body =
		`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
		`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(book)}\r\n--${boundary}--`;
	return { body, type: `multipart/related; boundary=${boundary}` };
}

export function googleDrive(token: TokenSource, labels: { folder: string; deleted: string }): Drive & Sharing {
	async function call(url: string, init: RequestInit = {}): Promise<Response> {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			let res: Response;
			try {
				res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await token(attempt > 0)}` } });
			} catch {
				throw new OfflineError();
			}
			if (res.status === 401 && attempt === 0) continue;
			if (res.status === 401) throw new AuthError("Drive 401");
			if (res.status === 404) throw new NotFoundError();
			if (!res.ok) {
				let reason = "";
				try {
					reason = ((await res.json()) as { error?: { errors?: Array<{ reason?: string }> } }).error?.errors?.[0]?.reason ?? "";
				} catch {
					// no JSON body
				}
				throw new DriveRequestError(res.status, reason);
			}
			return res;
		}
		throw new AuthError("Drive 401");
	}

	const json = async <T>(url: string, init?: RequestInit) => (await (await call(url, init)).json()) as T;

	// The visible folder holding this user's own books (created on first use).
	let folder: Promise<string> | null = null;
	const folderId = () =>
		(folder ??= (async () => {
			const q = new URLSearchParams({
				q: `mimeType='${FOLDER_MIME}' and appProperties has { key='pmFolder' and value='1' } and 'me' in owners and trashed=false`,
				fields: "files(id)",
				pageSize: "1",
			});
			const found = await json<{ files?: Array<{ id: string }> }>(`${API}/files?${q}`);
			if (found.files?.[0]) return found.files[0].id;
			const created = await json<{ id: string }>(`${API}/files?fields=id`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: labels.folder, mimeType: FOLDER_MIME, appProperties: { pmFolder: "1" } }),
			});
			return created.id;
		})().catch((e) => {
			folder = null;
			throw e;
		}));

	const metadata = (book: BookFile) => ({
		name: `${safeName(book.name)}${book.deletedAt ? ` ${labels.deleted}` : ""}.json`,
		mimeType: "application/json",
		appProperties: { pmBook: "1", bookId: book.id, bookName: book.name.slice(0, 100), deletedAt: book.deletedAt ?? null },
	});

	return {
		async list() {
			const out: RemoteFile[] = [];
			let pageToken = "";
			do {
				const q = new URLSearchParams({
					q: "appProperties has { key='pmBook' and value='1' } and trashed=false",
					fields: `nextPageToken,files(${FIELDS})`,
					pageSize: "1000",
				});
				if (pageToken) q.set("pageToken", pageToken);
				const data = await json<{ files?: DriveFile[]; nextPageToken?: string }>(`${API}/files?${q}`);
				for (const f of data.files ?? []) {
					const r = toRemote(f);
					if (r) out.push(r);
				}
				pageToken = data.nextPageToken ?? "";
			} while (pageToken);
			return out;
		},
		async download(id) {
			return json(`${API}/files/${id}?alt=media`);
		},
		async create(book) {
			const { body, type } = multipart({ ...metadata(book), parents: [await folderId()] }, book);
			return toRemote(await json<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, { method: "POST", headers: { "Content-Type": type }, body }))!;
		},
		async update(id, book) {
			const { body, type } = multipart(metadata(book), book);
			return toRemote(await json<DriveFile>(`${UPLOAD}/files/${id}?uploadType=multipart&fields=${FIELDS}`, { method: "PATCH", headers: { "Content-Type": type }, body }))!;
		},
		async remove(id) {
			await call(`${API}/files/${id}`, { method: "DELETE" });
		},

		async people(fileId) {
			const data = await json<{ permissions?: Array<{ id: string; emailAddress?: string; displayName?: string; role: string; type: string }> }>(
				`${API}/files/${fileId}/permissions?fields=permissions(id,emailAddress,displayName,role,type)`,
			);
			return (data.permissions ?? [])
				.filter((p) => p.type === "user" && p.emailAddress)
				.map((p) => ({ permissionId: p.id, email: p.emailAddress!, name: p.displayName ?? "", role: p.role }));
		},
		async share(fileId, email, message) {
			const q = new URLSearchParams({ sendNotificationEmail: "true", ...(message ? { emailMessage: message } : {}) });
			await call(`${API}/files/${fileId}/permissions?${q}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ type: "user", role: "writer", emailAddress: email }),
			});
		},
		async unshare(fileId, permissionId) {
			await call(`${API}/files/${fileId}/permissions/${permissionId}`, { method: "DELETE" });
		},
		async leave(fileId) {
			const me = await json<{ user?: { permissionId?: string } }>(`${API}/about?fields=user(permissionId)`);
			if (me.user?.permissionId) await call(`${API}/files/${fileId}/permissions/${me.user.permissionId}`, { method: "DELETE" });
		},
	};
}
