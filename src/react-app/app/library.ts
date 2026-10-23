// The library: every password book on this device, which ones are open, and
// their sync bookkeeping. A small external store (subscribe / getSnapshot) so
// async work (saving, syncing) always sees the latest state.

import {
	createBook,
	hasPassword,
	markDeleted,
	openPlain,
	openWithAnswer,
	openWithPassword,
	putAttachment,
	readAttachment,
	readContent,
	removePassword,
	removeRecovery,
	renameBook,
	setPassword,
	setPasswordHint,
	setRecovery,
	writeContent,
	type BookFile,
	type NewSecurity,
	type Opened,
} from "@/lib/bookfile";
import type { BookContent, Entry } from "@/lib/content";
import { ensureCategory, removeEntry, upsertEntry } from "@/lib/content";
import { WrongSecretError } from "@/lib/crypto";
import * as storage from "@/lib/storage";
import type { SyncRecord } from "@/lib/storage";
import type { SyncHost } from "@/lib/sync";

export type Snapshot = {
	loaded: boolean;
	/** Visible books (not deleted), sorted by name. */
	books: BookFile[];
	/** The book shown in the main view. */
	currentId: string | null;
	opened: Readonly<Record<string, Opened>>;
	records: Readonly<Record<string, SyncRecord>>;
	saveFailed: boolean;
};

const CURRENT_KEY = "password-book-current";

export class Library {
	private files = new Map<string, BookFile>();
	private open = new Map<string, Opened>();
	private records = new Map<string, SyncRecord>();
	private loaded = false;
	private saveFailed = false;
	private listeners = new Set<() => void>();
	private snapshot: Snapshot = this.buildSnapshot();
	/** Called after every local change, so sync can schedule an upload. */
	onLocalChange: () => void = () => {};
	/** Whether deletions must be kept as markers until the cloud is told. */
	syncEnabled = false;
	/** Localised name for a first book / books upgraded from the old format. */
	defaultName = "My passwords";

	// ── Store plumbing ───────────────────────────────────────────────────────

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	getSnapshot = () => this.snapshot;

	private buildSnapshot(): Snapshot {
		const books = [...this.files.values()].filter((b) => !b.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
		const saved = localStorage.getItem(CURRENT_KEY);
		return {
			loaded: this.loaded,
			books,
			currentId: books.some((b) => b.id === saved) ? saved : (books[0]?.id ?? null),
			opened: Object.fromEntries(this.open),
			records: Object.fromEntries(this.records),
			saveFailed: this.saveFailed,
		};
	}

	private emit() {
		this.snapshot = this.buildSnapshot();
		for (const l of this.listeners) l();
	}

	// ── Loading ──────────────────────────────────────────────────────────────

	async load(legacyName: string) {
		this.defaultName = legacyName;
		storage.setLegacyBookName(legacyName);
		try {
			const { books, sync } = await storage.loadAll();
			for (const b of books) this.files.set(b.id, b);
			for (const [id, r] of Object.entries(sync)) this.records.set(id, r);
			// Books without a password are always open.
			for (const b of books) if (!hasPassword(b) && !b.deletedAt) this.open.set(b.id, await openPlain(b));
		} catch {
			// Unreadable storage: start empty rather than crash.
		}
		this.loaded = true;
		this.emit();
	}

	select(id: string | null) {
		if (id) localStorage.setItem(CURRENT_KEY, id);
		else localStorage.removeItem(CURRENT_KEY);
		this.emit();
	}

	file(id: string) {
		return this.files.get(id);
	}

	// ── Saving ───────────────────────────────────────────────────────────────

	private async save(file: BookFile, opened?: Opened | null) {
		this.files.set(file.id, file);
		if (opened) this.open.set(file.id, opened);
		if (opened === null) this.open.delete(file.id);
		const rec = this.records.get(file.id) ?? { dirty: false };
		const nextRec: SyncRecord = { ...rec, dirty: true };
		this.records.set(file.id, nextRec);
		this.emit();
		try {
			await storage.putBook(file);
			await storage.putSync(file.id, nextRec);
			this.saveFailed = false;
		} catch {
			this.saveFailed = true;
		}
		this.emit();
		this.onLocalChange();
	}

	private requireOpen(id: string): { file: BookFile; opened: Opened } {
		const file = this.files.get(id);
		const opened = this.open.get(id);
		if (!file || !opened) throw new Error("book is not open");
		return { file, opened };
	}

	// ── Books ────────────────────────────────────────────────────────────────

	async createBook(name: string, security: NewSecurity | null) {
		const { file, opened } = await createBook(name, security);
		await this.save(file, opened);
		this.select(file.id);
		return file.id;
	}

	/** Resolves false on a wrong password. */
	async unlock(id: string, password: string): Promise<boolean> {
		return this.tryOpen(id, (f) => openWithPassword(f, password));
	}

	async unlockWithAnswer(id: string, answer: string): Promise<boolean> {
		return this.tryOpen(id, (f) => openWithAnswer(f, answer));
	}

	private async tryOpen(id: string, open: (f: BookFile) => Promise<Opened>) {
		const file = this.files.get(id);
		if (!file) return false;
		try {
			this.open.set(id, await open(file));
		} catch (e) {
			if (e instanceof WrongSecretError) return false;
			throw e;
		}
		this.emit();
		this.onLocalChange(); // a book that was waiting for unlock can merge now
		return true;
	}

	/** Locks every book that has a password. */
	lockAll() {
		for (const [id] of this.open) if (hasPassword(this.files.get(id)!)) this.open.delete(id);
		this.emit();
	}

	get hasPasswordBooks() {
		return this.snapshot.books.some(hasPassword);
	}

	get anyUnlocked() {
		return this.snapshot.books.some((b) => hasPassword(b) && this.open.has(b.id));
	}

	async rename(id: string, name: string) {
		await this.save(renameBook(this.files.get(id)!, name));
	}

	async setPassword(id: string, password: string, hint?: string) {
		const { file, opened } = this.requireOpen(id);
		const next = await setPassword(file, opened, password, hint);
		await this.save(next.file, { key: next.key, content: opened.content });
	}

	async setPasswordHint(id: string, hint: string) {
		await this.save(setPasswordHint(this.files.get(id)!, hint));
	}

	async setRecovery(id: string, question: string, answer: string, hint?: string) {
		const { file, opened } = this.requireOpen(id);
		await this.save(await setRecovery(file, opened.key!, question, answer, hint));
	}

	async removeRecovery(id: string) {
		await this.save(removeRecovery(this.files.get(id)!));
	}

	async removePassword(id: string) {
		const { file, opened } = this.requireOpen(id);
		await this.save(await removePassword(file, opened), { key: null, content: opened.content });
	}

	/** Deleted books are kept as a marker until the cloud has been told. */
	async deleteBook(id: string) {
		const file = this.files.get(id)!;
		const rec = this.records.get(id);
		if (this.syncEnabled && rec?.ownedByMe !== false) {
			await this.save(markDeleted(file), null);
		} else {
			this.files.delete(id);
			this.open.delete(id);
			this.records.delete(id);
			await storage.deleteBook(id);
			this.emit();
		}
		// no other book becomes "last used" behind the user's back
		if (localStorage.getItem(CURRENT_KEY) === id) this.select(null);
	}

	/** Adds a backup as a book (replacing the book with the same id, if any). */
	async importBook(file: BookFile) {
		this.open.delete(file.id);
		await this.save(file);
		if (!hasPassword(file)) this.open.set(file.id, await openPlain(file));
		this.select(file.id);
	}

	async exportBook(id: string) {
		storage.downloadBackup(this.files.get(id)!);
	}

	/** Leaves a book someone shared: removed here and never downloaded again. */
	async leave(id: string) {
		const rec: SyncRecord = { ...(this.records.get(id) ?? { dirty: false }), excluded: true, dirty: false };
		this.files.delete(id);
		this.open.delete(id);
		this.records.set(id, rec);
		await storage.deleteBook(id);
		await storage.putSync(id, rec);
		if (localStorage.getItem(CURRENT_KEY) === id) localStorage.removeItem(CURRENT_KEY);
		this.emit();
	}

	async eraseEverything() {
		await storage.clearAll();
		this.files.clear();
		this.open.clear();
		this.records.clear();
		localStorage.removeItem(CURRENT_KEY);
		this.emit();
	}

	// ── Contents ─────────────────────────────────────────────────────────────

	async updateContent(id: string, change: (c: BookContent) => BookContent) {
		const { file, opened } = this.requireOpen(id);
		const next = { key: opened.key, content: change(opened.content) };
		await this.save(await writeContent(file, next), next);
	}

	/**
	 * Saves an entry. `newFiles` are attachments added in the editor;
	 * `newCategory` is a category typed in the editor (created if needed).
	 */
	async saveEntry(id: string, entry: Entry, newFiles: Record<string, string>, newCategory?: string) {
		const { file, opened } = this.requireOpen(id);
		let next = file;
		for (const [fileId, dataUrl] of Object.entries(newFiles)) next = await putAttachment(next, opened.key, fileId, dataUrl);
		let base = opened.content;
		let toSave = entry;
		if (newCategory?.trim()) {
			const made = ensureCategory(base, newCategory);
			base = made.content;
			toSave = { ...entry, categoryId: made.id };
		}
		const content = upsertEntry(base, toSave);
		await this.save(await writeContent(next, { key: opened.key, content }), { key: opened.key, content });
	}

	async deleteEntry(id: string, entryId: string) {
		await this.updateContent(id, (c) => removeEntry(c, entryId));
	}

	async attachment(id: string, fileId: string): Promise<string | null> {
		const file = this.files.get(id);
		const opened = this.open.get(id);
		if (!file || !opened) return null;
		return readAttachment(file, opened.key, fileId);
	}

	// ── Sync host ────────────────────────────────────────────────────────────

	readonly syncHost: SyncHost = {
		books: () => [...this.files.values()],
		record: (id) => this.records.get(id) ?? { dirty: true },
		keyFor: (id) => {
			const opened = this.open.get(id);
			return opened ? opened.key : undefined;
		},
		commit: async (id, expected, change) => {
			const current = this.files.get(id);
			if ((current?.updatedAt ?? null) !== expected) {
				// The user changed it meanwhile: keep that; the next sync merges.
				const rec = { ...(this.records.get(id) ?? { dirty: true }), remoteId: change.remote.id, dirty: true };
				this.records.set(id, rec);
				await storage.putSync(id, rec);
				return false;
			}
			const r = change.remote;
			const rec: SyncRecord = {
				...this.records.get(id),
				remoteId: r.id,
				remoteModified: r.modifiedTime,
				dirty: false,
				ownedByMe: r.ownedByMe,
				ownerEmail: r.ownerEmail,
				ownerName: r.ownerName,
			};
			this.records.set(id, rec);
			if (change.book) {
				const book = change.book;
				this.files.set(id, book);
				await storage.putBook(book);
				await this.refreshOpened(book, change.key);
			}
			await storage.putSync(id, rec);
			this.emit();
			return true;
		},
		removeLocal: async (id) => {
			const left = this.records.get(id)?.excluded ? this.records.get(id) : undefined;
			this.files.delete(id);
			this.open.delete(id);
			this.records.delete(id);
			await storage.deleteBook(id);
			if (left) {
				this.records.set(id, left); // remember that the user left this shared book
				await storage.putSync(id, left);
			}
			if (localStorage.getItem(CURRENT_KEY) === id) localStorage.removeItem(CURRENT_KEY);
			this.emit();
		},
	};

	/** After the cloud replaced a book: re-read it if it's open (or lock it). */
	private async refreshOpened(book: BookFile, newKey?: CryptoKey | null) {
		if (!hasPassword(book)) {
			this.open.set(book.id, await openPlain(book));
			return;
		}
		const opened = this.open.get(book.id);
		if (!opened) return;
		const key = newKey !== undefined ? newKey : opened.key;
		try {
			this.open.set(book.id, { key, content: await readContent(book, key) });
		} catch {
			this.open.delete(book.id); // e.g. password set elsewhere with a new key
		}
	}
}
