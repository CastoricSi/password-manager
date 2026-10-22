// One password book as stored on the device, in a backup and in the cloud.
//
// The header (id, name, timestamps, protection) is readable so the app can list
// books and sync them while locked. The contents and every attachment are
// stored separately — sealed with the book key for password books, plain for
// open books — so adding a photo doesn't re-encrypt everything else.

import {
	isSealed,
	isSlot,
	newBookKey,
	openText,
	passwordSlot,
	recoverySlot,
	sealText,
	unlockWithAnswer,
	unlockWithPassword,
	WrongSecretError,
	type Sealed,
	type Slot,
} from "./crypto";
import { emptyContent, mergeContent, parseContent, referencedFiles, type BookContent } from "./content";

export type Stored = Sealed | { plain: string };
/** `hint` is an optional plain-text password hint, shown on the unlock screen. */
export type Protection = { kind: "none" } | { kind: "password"; slots: Slot[]; hint?: string };

export type BookFile = {
	format: "password-book";
	version: 2;
	id: string;
	name: string;
	nameUpdatedAt: string;
	createdAt: string;
	updatedAt: string;
	/** Set when the book was deleted (kept for 30 days so other devices follow). */
	deletedAt?: string;
	protection: Protection;
	protectionUpdatedAt: string;
	content: Stored;
	/** Attachment data (data: URLs), by attachment id. */
	files: Record<string, Stored>;
};

/** An opened book: its key (null for books without a password) and contents. */
export type Opened = { key: CryptoKey | null; content: BookContent };

const now = () => new Date().toISOString();
const isPlain = (s: Stored): s is { plain: string } => typeof (s as { plain?: unknown }).plain === "string";

export const hasPassword = (f: BookFile) => f.protection.kind === "password";
export const slotsOf = (f: BookFile): Slot[] => (f.protection.kind === "password" ? f.protection.slots : []);
export const passwordHint = (f: BookFile): string | null => (f.protection.kind === "password" ? (f.protection.hint ?? null) : null);

/** What a new password book is protected with. Hints are optional and stored readable. */
export type NewSecurity = { password: string; hint?: string; recovery?: { question: string; answer: string; hint?: string } };

const withHint = (hint?: string) => (hint?.trim() ? { hint: hint.trim() } : {});

async function encode(text: string, key: CryptoKey | null): Promise<Stored> {
	return key ? sealText(text, key) : { plain: text };
}

/** Throws WrongSecretError when the key doesn't fit. */
async function decode(stored: Stored, key: CryptoKey | null): Promise<string> {
	if (isPlain(stored)) return stored.plain;
	if (!key) throw new WrongSecretError();
	return openText(stored, key);
}

// ── Create / open ────────────────────────────────────────────────────────────

export async function createBook(name: string, security: NewSecurity | null): Promise<{ file: BookFile; opened: Opened }> {
	const t = now();
	const content = emptyContent();
	let key: CryptoKey | null = null;
	let protection: Protection = { kind: "none" };
	if (security) {
		key = await newBookKey();
		const slots: Slot[] = [await passwordSlot(key, security.password)];
		if (security.recovery) slots.push(await recoverySlot(key, security.recovery.question, security.recovery.answer, security.recovery.hint));
		protection = { kind: "password", slots, ...withHint(security.hint) };
	}
	const file: BookFile = {
		format: "password-book",
		version: 2,
		id: crypto.randomUUID(),
		name: name.trim(),
		nameUpdatedAt: t,
		createdAt: t,
		updatedAt: t,
		protection,
		protectionUpdatedAt: t,
		content: await encode(JSON.stringify(content), key),
		files: {},
	};
	return { file, opened: { key, content } };
}

export async function readContent(file: BookFile, key: CryptoKey | null): Promise<BookContent> {
	return parseContent(JSON.parse(await decode(file.content, key)));
}

/** Opens a book without a password. */
export async function openPlain(file: BookFile): Promise<Opened> {
	return { key: null, content: await readContent(file, null) };
}

/** Throws WrongSecretError on a wrong password. */
export async function openWithPassword(file: BookFile, password: string): Promise<Opened> {
	const key = await unlockWithPassword(slotsOf(file), password);
	return { key, content: await readContent(file, key) };
}

/** Throws WrongSecretError on a wrong answer (or no recovery question). */
export async function openWithAnswer(file: BookFile, answer: string): Promise<Opened> {
	const key = await unlockWithAnswer(slotsOf(file), answer);
	return { key, content: await readContent(file, key) };
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** New file with these contents; unreferenced attachments are dropped. */
export async function writeContent(file: BookFile, opened: Opened): Promise<BookFile> {
	const keep = referencedFiles(opened.content);
	return {
		...file,
		updatedAt: now(),
		content: await encode(JSON.stringify(opened.content), opened.key),
		files: Object.fromEntries(Object.entries(file.files).filter(([id]) => keep.has(id))),
	};
}

export async function putAttachment(file: BookFile, key: CryptoKey | null, id: string, dataUrl: string): Promise<BookFile> {
	return { ...file, files: { ...file.files, [id]: await encode(dataUrl, key) } };
}

export async function readAttachment(file: BookFile, key: CryptoKey | null, id: string): Promise<string | null> {
	const stored = file.files[id];
	return stored ? decode(stored, key) : null;
}

export function renameBook(file: BookFile, name: string): BookFile {
	const t = now();
	return { ...file, name: name.trim(), nameUpdatedAt: t, updatedAt: t };
}

export function markDeleted(file: BookFile): BookFile {
	const t = now();
	return { ...file, deletedAt: t, updatedAt: t };
}

export function undelete(file: BookFile): BookFile {
	const rest = { ...file };
	delete rest.deletedAt;
	return { ...rest, updatedAt: now() };
}

/** Re-encodes contents and every attachment under a different key (or none). */
async function reencode(file: BookFile, from: CryptoKey | null, to: CryptoKey | null, content: BookContent): Promise<BookFile> {
	const files: Record<string, Stored> = {};
	for (const [id, stored] of Object.entries(file.files)) files[id] = await encode(await decode(stored, from), to);
	return { ...file, files, content: await encode(JSON.stringify(content), to), updatedAt: now() };
}

// ── Protection changes (need the book open) ──────────────────────────────────

/** Sets or changes the main password (and its hint). A book without one gets a new key. */
export async function setPassword(file: BookFile, opened: Opened, password: string, hint?: string): Promise<{ file: BookFile; key: CryptoKey }> {
	const t = now();
	if (file.protection.kind === "password" && opened.key) {
		const slots = [await passwordSlot(opened.key, password), ...file.protection.slots.filter((s) => s.kind !== "password")];
		return { file: { ...file, protection: { kind: "password", slots, ...withHint(hint) }, protectionUpdatedAt: t, updatedAt: t }, key: opened.key };
	}
	const key = await newBookKey();
	const reencoded = await reencode(file, opened.key, key, opened.content);
	return {
		file: { ...reencoded, protection: { kind: "password", slots: [await passwordSlot(key, password)], ...withHint(hint) }, protectionUpdatedAt: t },
		key,
	};
}

/** Changes only the password hint (no key work needed). */
export function setPasswordHint(file: BookFile, hint: string): BookFile {
	if (file.protection.kind !== "password") return file;
	const t = now();
	const rest = { ...file.protection };
	delete rest.hint;
	return { ...file, protection: { ...rest, ...withHint(hint) }, protectionUpdatedAt: t, updatedAt: t };
}

export async function setRecovery(file: BookFile, key: CryptoKey, question: string, answer: string, hint?: string): Promise<BookFile> {
	const t = now();
	const slots = [...slotsOf(file).filter((s) => s.kind !== "recovery"), await recoverySlot(key, question, answer, hint)];
	return { ...file, protection: { kind: "password", slots, ...withHint(passwordHint(file) ?? undefined) }, protectionUpdatedAt: t, updatedAt: t };
}

export function removeRecovery(file: BookFile): BookFile {
	const t = now();
	const slots = slotsOf(file).filter((s) => s.kind !== "recovery");
	return { ...file, protection: { kind: "password", slots, ...withHint(passwordHint(file) ?? undefined) }, protectionUpdatedAt: t, updatedAt: t };
}

/** Removes the password: contents and attachments are stored plain. */
export async function removePassword(file: BookFile, opened: Opened): Promise<BookFile> {
	const reencoded = await reencode(file, opened.key, null, opened.content);
	return { ...reencoded, protection: { kind: "none" }, protectionUpdatedAt: now() };
}

// ── Merge (sync) ─────────────────────────────────────────────────────────────

/**
 * Merges two versions of the same book (needs to be able to read both).
 * Returns null when one side can't be read with `key` — the caller then keeps
 * the newer version as a whole.
 */
export async function mergeBooks(local: BookFile, remote: BookFile, key: CryptoKey | null): Promise<{ file: BookFile; key: CryptoKey | null } | null> {
	let localContent: BookContent;
	let remoteContent: BookContent;
	try {
		localContent = await readContent(local, key);
		remoteContent = await readContent(remote, key);
	} catch {
		return null;
	}
	const content = mergeContent(localContent, remoteContent);
	const winner = remote.protectionUpdatedAt > local.protectionUpdatedAt ? remote : local;
	const outKey = winner.protection.kind === "password" ? key : null;
	if (winner.protection.kind === "password" && !outKey) return null;

	const files: Record<string, Stored> = {};
	const keep = referencedFiles(content);
	try {
		for (const source of [remote, local]) {
			for (const [id, stored] of Object.entries(source.files)) {
				if (keep.has(id)) files[id] = await encode(await decode(stored, key), outKey);
			}
		}
	} catch {
		return null;
	}

	const named = remote.nameUpdatedAt > local.nameUpdatedAt ? remote : local;
	const merged: BookFile = {
		format: "password-book",
		version: 2,
		id: local.id,
		name: named.name,
		nameUpdatedAt: named.nameUpdatedAt,
		createdAt: local.createdAt < remote.createdAt ? local.createdAt : remote.createdAt,
		updatedAt: now(),
		protection: winner.protection,
		protectionUpdatedAt: winner.protectionUpdatedAt,
		content: await encode(JSON.stringify(content), outKey),
		files,
	};
	return { file: merged, key: outKey };
}

// ── Parsing untrusted data (device storage, backups, cloud) ──────────────────

function isStored(v: unknown): v is Stored {
	return isSealed(v) || typeof (v as { plain?: unknown })?.plain === "string";
}

/**
 * Validates a stored/backup/cloud file. Also accepts the previous single-book
 * format (version 1, always password-protected) and upgrades it.
 */
export function parseBookFile(value: unknown, fallbackName = "My passwords"): BookFile | null {
	const o = value as Record<string, unknown>;
	if (!o || o.format !== "password-book") return null;

	if (o.version === 1) {
		const slots = o.slots;
		if (!Array.isArray(slots) || !slots.every(isSlot) || !isSealed(o.content)) return null;
		const t = typeof o.savedAt === "string" ? o.savedAt : now();
		return {
			format: "password-book",
			version: 2,
			id: crypto.randomUUID(),
			name: fallbackName,
			nameUpdatedAt: t,
			createdAt: t,
			updatedAt: t,
			protection: { kind: "password", slots },
			protectionUpdatedAt: t,
			content: o.content,
			files: {},
		};
	}

	if (o.version !== 2 || typeof o.id !== "string" || typeof o.name !== "string") return null;
	const p = o.protection as Protection;
	const protectionOk =
		p?.kind === "none" ||
		(p?.kind === "password" &&
			Array.isArray(p.slots) &&
			p.slots.every(isSlot) &&
			p.slots.some((s) => s.kind === "password") &&
			(p.hint === undefined || typeof p.hint === "string"));
	if (!protectionOk || !isStored(o.content)) return null;
	const files = o.files && typeof o.files === "object" ? (o.files as Record<string, unknown>) : {};
	if (!Object.values(files).every(isStored)) return null;
	for (const k of ["nameUpdatedAt", "createdAt", "updatedAt", "protectionUpdatedAt"]) if (typeof o[k] !== "string") return null;
	if (o.deletedAt !== undefined && typeof o.deletedAt !== "string") return null;
	return value as BookFile;
}
