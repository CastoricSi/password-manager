// The sync engine: reconciles the books on this device with Google Drive.
// Pure orchestration over a `Drive` and a `SyncHost`, so it's unit-testable.
//
// Per book:
//   cloud unchanged since last sync → upload if we have local changes
//   cloud changed, no local changes → take the cloud version
//   both changed                     → merge item by item (needs the book
//                                       open if it has a password; otherwise
//                                       it waits until the user unlocks it)
// The same rules apply to a book shared between several people: everyone syncs
// the one file in the owner's Drive.
// Deleting (owner only) uploads a "deleted" marker so every device and every
// person it was shared with drops it; the owner can restore it for 30 days.
// A shared book that disappears from the listing (access removed, or the user
// left) is removed locally and not downloaded again.

import { mergeBooks, parseBookFile, undelete, type BookFile } from "./bookfile";
import type { Drive, RemoteFile } from "./drive";
import type { SyncRecord } from "./storage";

export const KEEP_DELETED_DAYS = 30;

export interface SyncHost {
	/** All books on this device, including deleted ones not yet uploaded. */
	books(): BookFile[];
	record(id: string): SyncRecord;
	/** The open book's key: null = book without a password, undefined = locked. */
	keyFor(id: string): CryptoKey | null | undefined;
	/**
	 * Store the result of a sync step — but only if the local book is still the
	 * version the step started from (`expectedUpdatedAt`; null = must not exist).
	 * Otherwise the user edited meanwhile: keep their edit, and the next sync
	 * merges it. Returns whether it was applied.
	 */
	commit(id: string, expectedUpdatedAt: string | null, change: { book?: BookFile; key?: CryptoKey | null; remote: RemoteFile }): Promise<boolean>;
	removeLocal(id: string): Promise<void>;
}

export type SyncReport = {
	/** Password books changed on both sides; they merge once unlocked. */
	waitingForUnlock: string[];
	/** The user's own deleted books, still restorable. */
	recentlyDeleted: RemoteFile[];
};

export async function syncAll(drive: Drive, host: SyncHost, now = new Date()): Promise<SyncReport> {
	const remotes = new Map((await drive.list()).map((r) => [r.bookId, r]));
	const report: SyncReport = { waitingForUnlock: [], recentlyDeleted: [] };
	const cutoff = new Date(now.getTime() - KEEP_DELETED_DAYS * 86_400_000).toISOString();
	/** A deleted book: the owner keeps it restorable for 30 days, then purges it. */
	const keepOrPurge = async (remote: RemoteFile) => {
		if (!remote.ownedByMe) return;
		if (remote.deletedAt && remote.deletedAt < cutoff) await drive.remove(remote.id);
		else report.recentlyDeleted.push(remote);
	};

	for (const local of host.books()) {
		const rec = host.record(local.id);
		const remote = remotes.get(local.id);
		remotes.delete(local.id);
		if (rec.excluded) continue;

		// Deleted here (owner): tell the cloud, then forget it locally.
		if (local.deletedAt) {
			if (rec.ownedByMe === false) {
				await host.removeLocal(local.id);
				continue;
			}
			const up = remote ? await drive.update(remote.id, local) : await drive.create(local);
			await host.removeLocal(local.id);
			report.recentlyDeleted.push(up);
			continue;
		}

		if (!remote) {
			// Someone else's book we can no longer see: unshared, or we left.
			if (rec.ownedByMe === false) {
				await host.removeLocal(local.id);
				continue;
			}
			// Ours and not in the cloud yet (or removed by hand): upload.
			const created = await drive.create(local);
			await host.commit(local.id, local.updatedAt, { remote: created });
			continue;
		}

		// Deleted on another device / by the owner.
		if (remote.deletedAt) {
			await host.removeLocal(local.id);
			await keepOrPurge(remote);
			continue;
		}

		// Cloud unchanged since our last sync.
		if (remote.modifiedTime === rec.remoteModified) {
			if (rec.dirty) {
				const up = await drive.update(remote.id, local);
				await host.commit(local.id, local.updatedAt, { remote: up });
			} else if (rec.ownedByMe === undefined || rec.ownerEmail !== remote.ownerEmail) {
				await host.commit(local.id, local.updatedAt, { remote }); // record who owns it
			}
			continue;
		}

		// Cloud changed.
		const cloud = parseBookFile(await drive.download(remote.id));
		if (!cloud) continue;
		if (!rec.dirty) {
			await host.commit(local.id, local.updatedAt, { book: cloud, remote });
			continue;
		}
		const key = host.keyFor(local.id);
		if (key === undefined && local.protection.kind === "password") {
			report.waitingForUnlock.push(local.id);
			continue;
		}
		const merged = await mergeBooks(local, cloud, key ?? null);
		// Unreadable combination (e.g. a new password set elsewhere): newer wins.
		const result = merged?.file ?? (cloud.updatedAt > local.updatedAt ? cloud : local);
		const up = await drive.update(remote.id, result);
		await host.commit(local.id, local.updatedAt, { book: result, key: merged ? merged.key : undefined, remote: up });
	}

	// Books only in the cloud: new from another device, newly shared with us,
	// or deleted ones.
	for (const remote of remotes.values()) {
		if (remote.deletedAt) {
			await keepOrPurge(remote);
			continue;
		}
		if (host.record(remote.bookId).excluded) continue; // a shared book we left
		const cloud = parseBookFile(await drive.download(remote.id));
		if (cloud && !cloud.deletedAt) await host.commit(cloud.id, null, { book: cloud, remote });
	}

	return report;
}

/** Brings one of the user's recently deleted books back (cloud + this device). */
export async function restoreDeleted(drive: Drive, host: SyncHost, remote: RemoteFile): Promise<void> {
	const cloud = parseBookFile(await drive.download(remote.id));
	if (!cloud) return;
	const book = undelete(cloud);
	const up = await drive.update(remote.id, book);
	await host.commit(book.id, null, { book, remote: up });
}
