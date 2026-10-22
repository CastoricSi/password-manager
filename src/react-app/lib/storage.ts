// Device storage (IndexedDB): every password book (as an encrypted/plain
// BookFile) plus per-book sync bookkeeping. Also backup export/import.

import { parseBookFile, type BookFile } from "./bookfile";

const DB_NAME = "password-book";
const DB_VERSION = 2;
const BOOKS = "books";
const SYNC = "sync";
const LEGACY_STORE = "book"; // version 1: a single book under key "main"

/** Per-book, per-device sync bookkeeping. */
export type SyncRecord = {
	/** Drive file id of this book, once uploaded. */
	remoteId?: string;
	/** Drive `modifiedTime` we last saw/wrote — tells us if the cloud changed. */
	remoteModified?: string;
	/** Local changes not uploaded yet. */
	dirty: boolean;
	/** Never sync this book again (a shared book the user left). */
	excluded?: boolean;
	/** False for a book someone else shared with this user. */
	ownedByMe?: boolean;
	ownerEmail?: string | null;
	ownerName?: string | null;
};

function openDb(legacyName: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = (event) => {
			const db = req.result;
			if (!db.objectStoreNames.contains(BOOKS)) db.createObjectStore(BOOKS);
			if (!db.objectStoreNames.contains(SYNC)) db.createObjectStore(SYNC);
			// Upgrade the single book of the previous version into the books store.
			if (event.oldVersion === 1 && db.objectStoreNames.contains(LEGACY_STORE)) {
				const tx = req.transaction!;
				const get = tx.objectStore(LEGACY_STORE).get("main");
				get.onsuccess = () => {
					const book = get.result ? parseBookFile(get.result, legacyName) : null;
					if (book) tx.objectStore(BOOKS).put(book, book.id);
					db.deleteObjectStore(LEGACY_STORE);
				};
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

let legacyBookName = "My passwords";
/** Name given to a book upgraded from the previous single-book version. */
export function setLegacyBookName(name: string) {
	legacyBookName = name;
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
	const db = await openDb(legacyBookName);
	try {
		return await new Promise<T | undefined>((resolve, reject) => {
			const t = db.transaction(stores, mode);
			const req = run(t);
			t.oncomplete = () => resolve(req ? req.result : undefined);
			t.onerror = () => reject(t.error);
			t.onabort = () => reject(t.error);
		});
	} finally {
		db.close();
	}
}

export async function loadAll(): Promise<{ books: BookFile[]; sync: Record<string, SyncRecord> }> {
	const books = ((await tx([BOOKS], "readonly", (t) => t.objectStore(BOOKS).getAll())) ?? [])
		.map((v) => parseBookFile(v))
		.filter((b): b is BookFile => !!b); // includes deleted books still waiting to tell the cloud
	const keys = ((await tx([SYNC], "readonly", (t) => t.objectStore(SYNC).getAllKeys())) ?? []) as string[];
	const values = ((await tx([SYNC], "readonly", (t) => t.objectStore(SYNC).getAll())) ?? []) as SyncRecord[];
	return { books, sync: Object.fromEntries(keys.map((k, i) => [k, values[i]])) };
}

export async function putBook(book: BookFile): Promise<void> {
	await tx([BOOKS], "readwrite", (t) => t.objectStore(BOOKS).put(book, book.id));
}

export async function deleteBook(id: string): Promise<void> {
	await tx([BOOKS, SYNC], "readwrite", (t) => {
		t.objectStore(BOOKS).delete(id);
		t.objectStore(SYNC).delete(id);
	});
}

export async function putSync(id: string, record: SyncRecord): Promise<void> {
	await tx([SYNC], "readwrite", (t) => t.objectStore(SYNC).put(record, id));
}

export async function clearAll(): Promise<void> {
	await tx([BOOKS, SYNC], "readwrite", (t) => {
		t.objectStore(BOOKS).clear();
		t.objectStore(SYNC).clear();
	});
}

// ── Backup files ─────────────────────────────────────────────────────────────

export function downloadBackup(book: BookFile) {
	const date = new Date().toISOString().slice(0, 10);
	const safeName = book.name.replace(/[\\/:*?"<>|]/g, "_") || "backup";
	const blob = new Blob([JSON.stringify(book)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${safeName}-${date}.json`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Reads a chosen file; null when it isn't a password book backup. */
export async function readBackup(file: File, legacyName: string): Promise<BookFile | null> {
	try {
		return parseBookFile(JSON.parse(await file.text()), legacyName);
	} catch {
		return null;
	}
}
