import { describe, expect, it } from "vitest";

import { createBook, markDeleted, openWithPassword, readContent, renameBook, writeContent, type BookFile, type Opened } from "./bookfile";
import { newEntry, upsertEntry } from "./content";
import type { Drive, RemoteFile } from "./drive";
import type { SyncRecord } from "./storage";
import { restoreDeleted, syncAll, type SyncHost } from "./sync";

/** An in-memory Google Drive shared by several users. */
function fakeCloud() {
	const files = new Map<string, { book: BookFile; modifiedTime: string; owner: string; access: Set<string> }>();
	let clock = 0;
	const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString();

	const driveFor = (user: string): Drive => {
		const meta = (id: string): RemoteFile => {
			const f = files.get(id)!;
			return {
				id,
				bookId: f.book.id,
				name: f.book.name,
				modifiedTime: f.modifiedTime,
				...(f.book.deletedAt ? { deletedAt: f.book.deletedAt } : {}),
				ownedByMe: f.owner === user,
				ownerEmail: f.owner,
				ownerName: f.owner,
			};
		};
		const visible = (id: string) => files.has(id) && files.get(id)!.access.has(user);
		return {
			list: async () => [...files.keys()].filter(visible).map(meta),
			download: async (id) => {
				if (!visible(id)) throw new Error("404");
				return JSON.parse(JSON.stringify(files.get(id)!.book));
			},
			create: async (book) => {
				const id = `drive-${book.id}`;
				files.set(id, { book: JSON.parse(JSON.stringify(book)), modifiedTime: stamp(), owner: user, access: new Set([user]) });
				return meta(id);
			},
			update: async (id, book) => {
				if (!visible(id)) throw new Error("404");
				files.set(id, { ...files.get(id)!, book: JSON.parse(JSON.stringify(book)), modifiedTime: stamp() });
				return meta(id);
			},
			remove: async (id) => {
				files.delete(id);
			},
		};
	};
	const share = (bookId: string, user: string) => files.get(`drive-${bookId}`)!.access.add(user);
	const unshare = (bookId: string, user: string) => files.get(`drive-${bookId}`)!.access.delete(user);
	return { files, driveFor, share, unshare };
}

/** One device: its books, sync records and open sessions. */
function device() {
	const books = new Map<string, BookFile>();
	const records = new Map<string, SyncRecord>();
	const keys = new Map<string, CryptoKey | null>();
	const host: SyncHost = {
		books: () => [...books.values()],
		record: (id) => records.get(id) ?? { dirty: true },
		keyFor: (id) => keys.get(id),
		commit: async (id, expected, change) => {
			const current = books.get(id);
			if ((current?.updatedAt ?? null) !== expected) {
				records.set(id, { ...(records.get(id) ?? { dirty: true }), remoteId: change.remote.id, dirty: true });
				return false;
			}
			if (change.book) books.set(id, change.book);
			if (change.key !== undefined) keys.set(id, change.key);
			const r = change.remote;
			records.set(id, { remoteId: r.id, remoteModified: r.modifiedTime, dirty: false, ownedByMe: r.ownedByMe, ownerEmail: r.ownerEmail, ownerName: r.ownerName });
			return true;
		},
		removeLocal: async (id) => {
			books.delete(id);
			const rec = records.get(id);
			if (rec?.excluded) records.set(id, rec); // keep the "left" marker
			else records.delete(id);
		},
	};
	const edit = async (id: string, opened: Opened, name: string) => {
		const content = upsertEntry(await readContent(books.get(id)!, opened.key), { ...newEntry(), name });
		books.set(id, await writeContent(books.get(id)!, { key: opened.key, content }));
		records.set(id, { ...(records.get(id) ?? {}), dirty: true });
	};
	const names = async (id: string, key: CryptoKey | null) => (await readContent(books.get(id)!, key)).entries.map((e) => e.name).sort();
	return { books, records, keys, host, edit, names };
}

describe("sync between one person's devices", () => {
	it("a new book appears on a second device; later edits on both merge", async () => {
		const cloud = fakeCloud();
		const drive = cloud.driveFor("a@x.com");
		const a = device();
		const b = device();
		const { file, opened } = await createBook("机密", { password: "pw" });
		a.books.set(file.id, file);
		a.keys.set(file.id, opened.key);

		await syncAll(drive, a.host);
		await syncAll(drive, b.host);
		expect(b.books.get(file.id)?.name).toBe("机密");
		expect(b.records.get(file.id)?.ownedByMe).toBe(true);

		const bOpened = await openWithPassword(b.books.get(file.id)!, "pw");
		b.keys.set(file.id, bOpened.key);
		await a.edit(file.id, opened, "fromA");
		await b.edit(file.id, bOpened, "fromB");

		await syncAll(drive, a.host);
		await syncAll(drive, b.host);
		await syncAll(drive, a.host);
		expect(await a.names(file.id, opened.key)).toEqual(["fromA", "fromB"]);
		expect(await b.names(file.id, opened.key)).toEqual(["fromA", "fromB"]);
	});

	it("a locked book that changed on both sides waits for unlock", async () => {
		const drive = fakeCloud().driveFor("a@x.com");
		const a = device();
		const b = device();
		const { file, opened } = await createBook("x", { password: "pw" });
		a.books.set(file.id, file);
		a.keys.set(file.id, opened.key);
		await syncAll(drive, a.host);
		await syncAll(drive, b.host);

		await a.edit(file.id, opened, "fromA");
		await syncAll(drive, a.host);
		b.books.set(file.id, renameBook(b.books.get(file.id)!, "renamed on B"));
		b.records.set(file.id, { ...b.records.get(file.id)!, dirty: true });

		expect((await syncAll(drive, b.host)).waitingForUnlock).toEqual([file.id]);
	});

	it("deleting deletes everywhere; restorable for 30 days, then purged", async () => {
		const cloud = fakeCloud();
		const drive = cloud.driveFor("a@x.com");
		const a = device();
		const b = device();
		const { file } = await createBook("日常", null);
		a.books.set(file.id, file);
		await syncAll(drive, a.host);
		await syncAll(drive, b.host);

		a.books.set(file.id, markDeleted(a.books.get(file.id)!));
		await syncAll(drive, a.host);
		expect(a.books.has(file.id)).toBe(false);

		const report = await syncAll(drive, b.host);
		expect(b.books.has(file.id)).toBe(false);
		expect(report.recentlyDeleted.map((r) => r.bookId)).toEqual([file.id]);

		await restoreDeleted(drive, b.host, report.recentlyDeleted[0]);
		await syncAll(drive, a.host);
		expect(a.books.has(file.id)).toBe(true);

		b.books.set(file.id, markDeleted(b.books.get(file.id)!));
		await syncAll(drive, b.host);
		await syncAll(drive, a.host, new Date(Date.now() + 31 * 86_400_000));
		expect(cloud.files.size).toBe(0);
	});

	it("an edit made while a sync was running is not overwritten", async () => {
		const drive = fakeCloud().driveFor("a@x.com");
		const a = device();
		const { file } = await createBook("x", null);
		a.books.set(file.id, file);
		const realCommit = a.host.commit;
		a.host.commit = async (id, expected, change) => {
			a.books.set(id, { ...a.books.get(id)!, updatedAt: "2099-01-01T00:00:00.000Z" });
			return realCommit(id, expected, change);
		};
		await syncAll(drive, a.host);
		expect(a.records.get(file.id)?.dirty).not.toBe(false);
	});
});

describe("sharing a book with another person", () => {
	async function setup() {
		const cloud = fakeCloud();
		const owner = device();
		const friend = device();
		const { file, opened } = await createBook("家庭", { password: "family-pw" });
		owner.books.set(file.id, file);
		owner.keys.set(file.id, opened.key);
		await syncAll(cloud.driveFor("a@x.com"), owner.host);
		cloud.share(file.id, "b@x.com");
		await syncAll(cloud.driveFor("b@x.com"), friend.host);
		return { cloud, owner, friend, file, opened, syncA: () => syncAll(cloud.driveFor("a@x.com"), owner.host), syncB: () => syncAll(cloud.driveFor("b@x.com"), friend.host) };
	}

	it("the friend gets the book (still locked: the password isn't shared), and both people's edits merge", async () => {
		const { owner, friend, file, opened, syncA, syncB } = await setup();
		expect(friend.books.has(file.id)).toBe(true);
		expect(friend.records.get(file.id)).toMatchObject({ ownedByMe: false, ownerEmail: "a@x.com" });
		await expect(openWithPassword(friend.books.get(file.id)!, "wrong")).rejects.toThrow();

		const fOpened = await openWithPassword(friend.books.get(file.id)!, "family-pw");
		friend.keys.set(file.id, fOpened.key);
		await owner.edit(file.id, opened, "electricity");
		await friend.edit(file.id, fOpened, "water");
		await syncA();
		await syncB();
		await syncA();
		expect(await owner.names(file.id, opened.key)).toEqual(["electricity", "water"]);
		expect(await friend.names(file.id, opened.key)).toEqual(["electricity", "water"]);
	});

	it("when the owner stops sharing, the book disappears for the friend", async () => {
		const { cloud, friend, file, syncB } = await setup();
		cloud.unshare(file.id, "b@x.com");
		await syncB();
		expect(friend.books.has(file.id)).toBe(false);
	});

	it("a friend who leaves doesn't get it back while still having access", async () => {
		const { friend, file, syncB } = await setup();
		friend.records.set(file.id, { ...friend.records.get(file.id)!, excluded: true });
		await friend.host.removeLocal(file.id);
		await syncB();
		expect(friend.books.has(file.id)).toBe(false);
	});

	it("when the owner deletes it, it goes away for the friend, who can't restore or purge it", async () => {
		const { cloud, owner, friend, file, syncA, syncB } = await setup();
		owner.books.set(file.id, markDeleted(owner.books.get(file.id)!));
		await syncA();
		const report = await syncB();
		expect(friend.books.has(file.id)).toBe(false);
		expect(report.recentlyDeleted).toEqual([]);
		await syncAll(cloud.driveFor("b@x.com"), friend.host, new Date(Date.now() + 31 * 86_400_000));
		expect(cloud.files.size).toBe(1);
	});
});
