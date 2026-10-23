// Google account + sync + sharing.
//
// The user picks "use local data" or "use Google account" on first start.
// With Google, every book syncs by itself in the background — after each
// change, when the app opens or regains focus, when the network comes back,
// and every minute. Books can be shared with other Google users by email.

import { AuthError, DriveRequestError, googleDrive, OfflineError, type Drive, type Person, type RemoteFile, type Sharing } from "@/lib/drive";
import { pickSharedBooks } from "@/lib/picker";
import { restoreDeleted, syncAll } from "@/lib/sync";
import type { Library } from "./library";
import { rememberReturn } from "./nav";

export type Mode = "local" | "google";

export type SyncStatus =
	| "unavailable" // the server isn't configured for Google sign-in
	| "off" // local mode / not signed in
	| "syncing"
	| "synced"
	| "offline"
	| "error";

export type ShareNotice = { fileId: string; bookId: string; bookName: string; from: string; at: string };

export type SyncSnapshot = {
	/** null until the user chose on first start. */
	mode: Mode | null;
	status: SyncStatus;
	email: string | null;
	lastSyncedAt: Date | null;
	/** True once the first sync after start/sign-in has finished. */
	firstSyncDone: boolean;
	waitingForUnlock: string[];
	recentlyDeleted: RemoteFile[];
	/** "A shared book X with you" — not added yet. */
	notices: ShareNotice[];
	/** Google's file picker is configured (needed to accept shares). */
	canPick: boolean;
};

export type ShareResult = "ok" | "invalid" | "notUploaded" | "failed";

const HEADERS = { "X-Requested-With": "password-manager" };
const MODE_KEY = "password-book-mode";
const CHANGE_DELAY = 1500;
const INTERVAL = 60_000;

export class SyncController {
	private snapshot: SyncSnapshot = {
		mode: readMode(),
		status: "off",
		email: null,
		lastSyncedAt: null,
		firstSyncDone: false,
		waitingForUnlock: [],
		recentlyDeleted: [],
		notices: [],
		canPick: false,
	};
	private listeners = new Set<() => void>();
	private drive: Drive & Sharing;
	private token: { value: string; expires: number } | null = null;
	private picker: { apiKey: string; appId: string } | null = null;
	private noticesEnabled = false;
	private running: Promise<void> | null = null;
	private again = false;
	private changeTimer = 0;
	private started = false;
	private library: Library;
	private labels: { pickTitle: string; locale: string };

	constructor(library: Library, labels: { folder: string; deleted: string; pickTitle: string; locale: string }) {
		this.library = library;
		this.labels = labels;
		this.drive = googleDrive((force) => this.accessToken(force), labels);
		library.onLocalChange = () => this.scheduleSoon();
	}

	subscribe = (l: () => void) => {
		this.listeners.add(l);
		return () => this.listeners.delete(l);
	};
	getSnapshot = () => this.snapshot;

	private set(patch: Partial<SyncSnapshot>) {
		this.snapshot = { ...this.snapshot, ...patch };
		this.library.syncEnabled = this.connected;
		for (const l of this.listeners) l();
	}

	/** Signed in with Google (sync is on). */
	get connected() {
		return this.snapshot.mode === "google" && !["off", "unavailable"].includes(this.snapshot.status);
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	async start() {
		if (this.started) return;
		this.started = true;
		window.addEventListener("online", () => void this.syncNow());
		window.addEventListener("focus", () => void this.syncNow());
		document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void this.syncNow());
		window.setInterval(() => document.visibilityState === "visible" && void this.syncNow(), INTERVAL);

		try {
			// under /api/auth: a sign-in stored by an earlier build (cookie path /api/auth) is seen there too
			const res = await fetch("/api/auth/config", { cache: "no-store" });
			const cfg = (await res.json()) as {
				available: boolean;
				connected?: boolean;
				email?: string | null;
				picker?: { apiKey: string; appId: string } | null;
				notices?: boolean;
			};
			if (!cfg.available) return this.set({ status: "unavailable", firstSyncDone: true, mode: this.snapshot.mode ?? "local" });
			this.picker = cfg.picker ?? null;
			this.noticesEnabled = !!cfg.notices;
			this.set({ canPick: !!this.picker });
			if (this.snapshot.mode !== "google") return this.set({ status: "off", firstSyncDone: true });
			if (!cfg.connected) return this.set({ status: "off", firstSyncDone: true, email: null });
			this.set({ status: "synced", email: cfg.email ?? null });
		} catch {
			// Offline at startup: work locally, try again when online.
			return this.set({ status: this.snapshot.mode === "google" ? "offline" : "off", firstSyncDone: true });
		}
		await this.syncNow();
	}

	useLocal() {
		writeMode("local");
		this.set({ mode: "local", status: this.snapshot.status === "unavailable" ? "unavailable" : "off", firstSyncDone: true });
	}

	/** Google sign-in popup; on success switches to Google mode and syncs. */
	connect(): Promise<boolean> {
		return new Promise((resolve) => {
			const popup = window.open("/api/auth/google/start", "pm-google", "width=480,height=640");
			if (!popup) {
				writeMode("google");
				rememberReturn();
				window.location.href = "/api/auth/google/start";
				return;
			}
			const onMessage = async (e: MessageEvent) => {
				if (e.origin !== window.location.origin || e.data?.type !== "pm-google-auth") return;
				window.removeEventListener("message", onMessage);
				if (!e.data.ok) return resolve(false);
				writeMode("google");
				this.token = null;
				this.set({ mode: "google", status: "syncing", firstSyncDone: false });
				await this.syncNow();
				resolve(true);
			};
			window.addEventListener("message", onMessage);
		});
	}

	/** Signs out; books stay on this device and the app continues locally. */
	async disconnect() {
		await fetch("/api/auth/google/disconnect", { method: "POST", headers: HEADERS }).catch(() => {});
		this.token = null;
		writeMode("local");
		this.set({ mode: "local", status: "off", email: null, lastSyncedAt: null, waitingForUnlock: [], recentlyDeleted: [], notices: [] });
	}

	// ── Running ──────────────────────────────────────────────────────────────

	private scheduleSoon() {
		if (!this.connected) return;
		window.clearTimeout(this.changeTimer);
		this.changeTimer = window.setTimeout(() => void this.syncNow(), CHANGE_DELAY);
	}

	/** Runs a sync now (or right after the one in progress). */
	syncNow(): Promise<void> {
		if (this.snapshot.mode !== "google" || ["off", "unavailable"].includes(this.snapshot.status)) return Promise.resolve();
		if (this.running) {
			this.again = true;
			return this.running;
		}
		this.running = (async () => {
			do {
				this.again = false;
				await this.runOnce();
			} while (this.again);
			this.running = null;
		})();
		return this.running;
	}

	private async runOnce() {
		if (!navigator.onLine) return this.set({ status: "offline", firstSyncDone: true });
		this.set({ status: "syncing" });
		try {
			const report = await syncAll(this.drive, this.library.syncHost);
			const notices = await this.fetchNotices();
			this.set({ status: "synced", lastSyncedAt: new Date(), firstSyncDone: true, notices, ...report });
		} catch (e) {
			if (e instanceof AuthError) {
				this.token = null;
				this.set({ status: "off", email: null, firstSyncDone: true });
			} else if (e instanceof OfflineError) {
				this.set({ status: "offline", firstSyncDone: true });
			} else {
				this.set({ status: "error", firstSyncDone: true });
			}
		}
	}

	async restore(remote: RemoteFile) {
		await restoreDeleted(this.drive, this.library.syncHost, remote);
		await this.syncNow();
	}

	// ── Sharing ──────────────────────────────────────────────────────────────

	private remoteIdOf(bookId: string) {
		return this.library.getSnapshot().records[bookId]?.remoteId;
	}

	async people(bookId: string): Promise<Person[] | null> {
		const id = this.remoteIdOf(bookId);
		if (!id) return null;
		return this.drive.people(id);
	}

	async share(bookId: string, email: string): Promise<ShareResult> {
		const to = email.trim().toLowerCase();
		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return "invalid";
		if (!this.remoteIdOf(bookId)) await this.syncNow();
		const fileId = this.remoteIdOf(bookId);
		if (!fileId) return "notUploaded";
		try {
			await this.drive.share(fileId, to);
		} catch (e) {
			return e instanceof DriveRequestError && e.status === 400 ? "invalid" : "failed";
		}
		if (this.noticesEnabled) {
			const book = this.library.file(bookId);
			await fetch("/api/shares", {
				method: "POST",
				headers: { ...HEADERS, "Content-Type": "application/json" },
				body: JSON.stringify({ fileId, bookId, bookName: book?.name ?? "", to }),
			}).catch(() => {});
		}
		return "ok";
	}

	async unshare(bookId: string, person: Person) {
		const fileId = this.remoteIdOf(bookId);
		if (!fileId) return;
		await this.drive.unshare(fileId, person.permissionId);
		if (this.noticesEnabled) {
			await fetch(`/api/shares/${encodeURIComponent(fileId)}?to=${encodeURIComponent(person.email)}`, { method: "DELETE", headers: HEADERS }).catch(() => {});
		}
	}

	/** Leave a book someone shared with you (removes your access everywhere). */
	async leave(bookId: string) {
		const fileId = this.remoteIdOf(bookId);
		if (fileId) {
			try {
				await this.drive.leave(fileId);
			} catch {
				// Already gone, or couldn't remove access remotely: either way we
				// stop syncing it here (marked as left below).
			}
		}
		await this.library.leave(bookId);
	}

	private async fetchNotices(): Promise<ShareNotice[]> {
		if (!this.noticesEnabled) return [];
		try {
			const res = await fetch("/api/shares", { headers: HEADERS });
			if (!res.ok) return this.snapshot.notices;
			const { notices } = (await res.json()) as { notices: ShareNotice[] };
			const have = new Set(this.library.getSnapshot().books.map((b) => b.id));
			return notices.filter((n) => !have.has(n.bookId));
		} catch {
			return this.snapshot.notices;
		}
	}

	/** Opens Google's picker; resolves true when at least one book was added. */
	private async pick(fileIds?: string[]): Promise<boolean> {
		if (!this.picker) return false;
		const ids = await pickSharedBooks({
			token: await this.accessToken(),
			apiKey: this.picker.apiKey,
			appId: this.picker.appId,
			title: this.labels.pickTitle,
			locale: this.labels.locale,
			fileIds,
		});
		if (ids.length === 0) return false;
		await this.syncNow();
		return true;
	}

	/** "A shared X with you" → Add: confirm once in Google's window. */
	async accept(notice: ShareNotice): Promise<boolean> {
		const added = await this.pick([notice.fileId]);
		if (added) await this.dismiss(notice);
		return added;
	}

	async dismiss(notice: ShareNotice) {
		this.set({ notices: this.snapshot.notices.filter((n) => n.fileId !== notice.fileId) });
		await fetch(`/api/shares/${encodeURIComponent(notice.fileId)}`, { method: "DELETE", headers: HEADERS }).catch(() => {});
	}

	/** Without a notice: pick any book shared with you from Google's window. */
	addShared(): Promise<boolean> {
		return this.pick();
	}

	// ── Tokens (short-lived, from our Worker) ────────────────────────────────

	private async accessToken(force = false): Promise<string> {
		if (!force && this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
		let res: Response;
		try {
			res = await fetch("/api/auth/google/token", { method: "POST", headers: HEADERS });
		} catch {
			throw new OfflineError();
		}
		if (res.status === 401) throw new AuthError("not connected");
		if (!res.ok) throw new Error(`token ${res.status}`);
		const data = (await res.json()) as { accessToken: string; expiresIn: number; email: string };
		this.token = { value: data.accessToken, expires: Date.now() + data.expiresIn * 1000 };
		if (data.email && data.email !== this.snapshot.email) this.set({ email: data.email });
		return data.accessToken;
	}
}

function readMode(): Mode | null {
	try {
		const m = localStorage.getItem(MODE_KEY);
		return m === "local" || m === "google" ? m : null;
	} catch {
		return null;
	}
}

function writeMode(mode: Mode) {
	try {
		localStorage.setItem(MODE_KEY, mode);
	} catch {
		// Private mode: the choice just won't be remembered.
	}
}
