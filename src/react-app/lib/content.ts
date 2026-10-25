// The decrypted contents of one password book, and pure operations on it
// (editing, searching, and the per-item merge used by sync).

export type CustomField = { id: string; label: string; value: string; secret: boolean };
export type AttachmentMeta = { id: string; name: string; type: string; size: number };

export type Entry = {
	id: string;
	name: string;
	username: string;
	password: string;
	url: string;
	notes: string;
	categoryId: string | null;
	fields: CustomField[];
	attachments: AttachmentMeta[];
	/** Shown first in the list. Absent = not pinned (so older books and backups read as they are). */
	pinned?: true;
	createdAt: string;
	updatedAt: string;
};

export type Category = { id: string; name: string; updatedAt: string; deleted?: boolean };

/**
 * Per-book features. Categories are always on now; the flag is kept so files
 * stay compatible with older versions. Custom fields are opt-in.
 */
export type Features = { categories: boolean; customFields: boolean };

/**
 * A deleted entry in the recycle bin, restorable for TRASH_DAYS. Without `entry`
 * it was deleted for good (kept as a marker so other devices let theirs go too).
 */
export type TrashItem = { id: string; deletedAt: string; entry?: Entry };

export const TRASH_DAYS = 30;

export type BookContent = {
	entries: Entry[];
	/** Tombstones so a sync can tell "deleted" from "never seen": id → deletedAt. */
	deletedEntries: Record<string, string>;
	/**
	 * The recycle bin. The tombstones above still mark these entries deleted, so an
	 * app from before the bin (which drops this list) never brings them back.
	 */
	trash: TrashItem[];
	categories: Category[];
	features: Features;
	featuresUpdatedAt: string;
};

const EPOCH = "1970-01-01T00:00:00.000Z";
const now = () => new Date().toISOString();

export function emptyContent(): BookContent {
	return {
		entries: [],
		deletedEntries: {},
		trash: [],
		categories: [],
		features: { categories: true, customFields: false },
		featuresUpdatedAt: EPOCH,
	};
}

export function newEntry(categoryId: string | null = null): Entry {
	const t = now();
	return {
		id: crypto.randomUUID(),
		name: "",
		username: "",
		password: "",
		url: "",
		notes: "",
		categoryId,
		fields: [],
		attachments: [],
		createdAt: t,
		updatedAt: t,
	};
}

export function newField(label = ""): CustomField {
	return { id: crypto.randomUUID(), label, value: "", secret: false };
}

// ── Editing ──────────────────────────────────────────────────────────────────

export function upsertEntry(c: BookContent, entry: Entry): BookContent {
	const next: Entry = {
		...entry,
		name: entry.name.trim(),
		fields: entry.fields.filter((f) => f.label.trim() || f.value).map((f) => ({ ...f, label: f.label.trim() })),
		updatedAt: now(),
	};
	const exists = c.entries.some((e) => e.id === entry.id);
	return { ...c, entries: exists ? c.entries.map((e) => (e.id === entry.id ? next : e)) : [...c.entries, next] };
}

/** Pins or unpins an entry. It counts as an edit (updatedAt), so the change wins when devices merge. */
export function pinEntry(c: BookContent, id: string, pinned: boolean): BookContent {
	return {
		...c,
		entries: c.entries.map((e) => {
			if (e.id !== id) return e;
			const next: Entry = { ...e, updatedAt: now() };
			if (pinned) next.pinned = true;
			else delete next.pinned;
			return next;
		}),
	};
}

/** Deletes an entry into the recycle bin. */
export function removeEntry(c: BookContent, id: string): BookContent {
	const t = now();
	const entry = c.entries.find((e) => e.id === id);
	return {
		...c,
		entries: c.entries.filter((e) => e.id !== id),
		deletedEntries: { ...c.deletedEntries, [id]: t },
		trash: [...c.trash.filter((x) => x.id !== id), ...(entry ? [{ id, deletedAt: t, entry }] : [])],
	};
}

/** Entries in the recycle bin (not yet deleted for good), most recently deleted first. */
export function trashed(c: BookContent): Array<{ entry: Entry; deletedAt: string }> {
	return c.trash
		.filter((x): x is TrashItem & { entry: Entry } => !!x.entry)
		.map(({ entry, deletedAt }) => ({ entry, deletedAt }))
		.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Days left before a deleted entry leaves the bin by itself. */
export const trashDaysLeft = (deletedAt: string, at = Date.now()) => Math.max(0, Math.ceil((Date.parse(deletedAt) + TRASH_DAYS * 864e5 - at) / 864e5));

/** Brings an entry back from the bin. A fresh updatedAt makes it win over the tombstone on every device. */
export function restoreEntry(c: BookContent, id: string): BookContent {
	const item = c.trash.find((x) => x.id === id);
	if (!item?.entry) return c;
	const deletedEntries = { ...c.deletedEntries };
	delete deletedEntries[id];
	return {
		...c,
		entries: [...c.entries.filter((e) => e.id !== id), { ...item.entry, updatedAt: now() }],
		deletedEntries,
		trash: c.trash.filter((x) => x.id !== id),
	};
}

/** Deletes entries in the bin for good (all of them without `ids`). */
export function purgeTrash(c: BookContent, ids?: string[]): BookContent {
	return { ...c, trash: c.trash.map((x) => (!ids || ids.includes(x.id) ? { id: x.id, deletedAt: x.deletedAt } : x)) };
}

/** The bin without what has been there TRASH_DAYS, and without what was restored since. */
function tidyTrash(trash: TrashItem[], entries: Entry[], at = Date.now()): TrashItem[] {
	const live = new Map(entries.map((e) => [e.id, e.updatedAt]));
	return trash.filter((x) => Date.parse(x.deletedAt) + TRASH_DAYS * 864e5 > at && !((live.get(x.id) ?? "") > x.deletedAt));
}

export function setFeatures(c: BookContent, features: Features): BookContent {
	return { ...c, features, featuresUpdatedAt: now() };
}

export function liveCategories(c: BookContent): Category[] {
	return c.categories.filter((cat) => !cat.deleted).sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns the existing category with this name, or adds one. */
export function ensureCategory(c: BookContent, name: string): { content: BookContent; id: string } {
	const trimmed = name.trim();
	const existing = liveCategories(c).find((cat) => cat.name === trimmed);
	if (existing) return { content: c, id: existing.id };
	const cat: Category = { id: crypto.randomUUID(), name: trimmed, updatedAt: now() };
	return { content: { ...c, categories: [...c.categories, cat] }, id: cat.id };
}

export function renameCategory(c: BookContent, id: string, name: string): BookContent {
	return { ...c, categories: c.categories.map((cat) => (cat.id === id ? { ...cat, name: name.trim(), updatedAt: now() } : cat)) };
}

/** Deletes the category; its entries become uncategorised. */
export function deleteCategory(c: BookContent, id: string): BookContent {
	const t = now();
	return {
		...c,
		categories: c.categories.map((cat) => (cat.id === id ? { ...cat, deleted: true, updatedAt: t } : cat)),
		entries: c.entries.map((e) => (e.categoryId === id ? { ...e, categoryId: null, updatedAt: t } : e)),
	};
}

/** Labels already used in this book, for suggestions when adding a field. */
export function fieldLabels(c: BookContent): string[] {
	return [...new Set(c.entries.flatMap((e) => e.fields.map((f) => f.label)).filter(Boolean))].sort();
}

/** Attachment ids still referenced by some entry. */
/** Attachment files still needed: by entries, and by entries in the recycle bin (restorable). */
export function referencedFiles(c: BookContent): Set<string> {
	const inBin = c.trash.flatMap((x) => x.entry?.attachments ?? []);
	return new Set([...c.entries.flatMap((e) => e.attachments), ...inBin].map((a) => a.id));
}

// ── Searching ────────────────────────────────────────────────────────────────

/**
 * The list: the category's entries, or with a query, matches from the whole book —
 * a search always looks everywhere (a book is one book; categories only sort it).
 */
export function findEntries(c: BookContent, query: string, categoryId: string | null, locale: string): Entry[] {
	const q = query.trim().toLocaleLowerCase();
	const collator = new Intl.Collator(locale === "zh" ? "zh-Hans-CN" : "en", { sensitivity: "base", numeric: true });
	return c.entries
		.filter((e) => q || !categoryId || e.categoryId === categoryId)
		.filter((e) => {
			if (!q) return true;
			const text = [e.name, e.username, e.url, e.notes, ...e.fields.filter((f) => !f.secret).flatMap((f) => [f.label, f.value])];
			return text.some((s) => s.toLocaleLowerCase().includes(q));
		})
		// pinned first, then by name
		.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || collator.compare(a.name, b.name));
}

/** Turns "example.com" into an openable link; null for non-web text. */
export function toHref(url: string): string | null {
	const u = url.trim();
	if (!u) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`;
	try {
		const parsed = new URL(withScheme);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
	} catch {
		return null;
	}
}

// ── Merge (sync) ─────────────────────────────────────────────────────────────

const later = (a: string, b: string) => (a >= b ? a : b);

/**
 * Merges two versions of the same book, item by item. Order-independent.
 * Entries / categories: the newer `updatedAt` wins. An entry deleted on one side
 * stays deleted unless it was edited after the deletion.
 */
export function mergeContent(a: BookContent, b: BookContent): BookContent {
	const deletedEntries: Record<string, string> = { ...a.deletedEntries };
	for (const [id, at] of Object.entries(b.deletedEntries)) deletedEntries[id] = later(deletedEntries[id] ?? EPOCH, at);

	const entries = new Map<string, Entry>();
	for (const e of [...a.entries, ...b.entries]) {
		const prev = entries.get(e.id);
		// Same time, different content: an app from before pinning drops the flag when it
		// saves (without touching updatedAt), so the copy that still has it wins.
		const tie = e.updatedAt === prev?.updatedAt && (!!e.pinned !== !!prev.pinned ? !!e.pinned : JSON.stringify(e) > JSON.stringify(prev));
		if (!prev || e.updatedAt > prev.updatedAt || tie) {
			entries.set(e.id, e);
		}
	}
	const keptEntries = [...entries.values()].filter((e) => !(deletedEntries[e.id] && deletedEntries[e.id] >= e.updatedAt));
	for (const e of keptEntries) delete deletedEntries[e.id]; // resurrected by a later edit

	// The bin: the later deletion of each entry; deleted for good on either side stays so.
	const bin = new Map<string, TrashItem>();
	for (const x of [...a.trash, ...b.trash]) {
		const prev = bin.get(x.id);
		if (!prev) {
			bin.set(x.id, x);
			continue;
		}
		const newer = x.deletedAt > prev.deletedAt ? x : prev;
		bin.set(x.id, prev.entry && x.entry ? newer : { id: x.id, deletedAt: newer.deletedAt });
	}
	const trash = tidyTrash([...bin.values()], keptEntries).sort((x, y) => x.id.localeCompare(y.id));

	const categories = new Map<string, Category>();
	for (const cat of [...a.categories, ...b.categories]) {
		const prev = categories.get(cat.id);
		if (!prev || cat.updatedAt > prev.updatedAt || (cat.updatedAt === prev.updatedAt && !!cat.deleted)) categories.set(cat.id, cat);
	}

	const [features, featuresUpdatedAt] =
		a.featuresUpdatedAt > b.featuresUpdatedAt || (a.featuresUpdatedAt === b.featuresUpdatedAt && JSON.stringify(a.features) >= JSON.stringify(b.features))
			? [a.features, a.featuresUpdatedAt]
			: [b.features, b.featuresUpdatedAt];

	return {
		entries: keptEntries.sort((x, y) => x.id.localeCompare(y.id)),
		deletedEntries,
		trash,
		categories: [...categories.values()].sort((x, y) => x.id.localeCompare(y.id)),
		features,
		featuresUpdatedAt,
	};
}

// ── Parsing (defensive: damaged, older or newer data) ────────────────────────

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function parseEntry(value: unknown, t: string): Entry {
	const e = obj(value);
	return {
		id: str(e.id) || crypto.randomUUID(),
		name: str(e.name),
		username: str(e.username),
		password: str(e.password),
		url: str(e.url),
		notes: str(e.notes),
		categoryId: typeof e.categoryId === "string" ? e.categoryId : null,
		fields: arr(e.fields)
			.map(obj)
			.map((f) => ({ id: str(f.id) || crypto.randomUUID(), label: str(f.label), value: str(f.value), secret: f.secret === true })),
		attachments: arr(e.attachments)
			.map(obj)
			.filter((a) => typeof a.id === "string")
			.map((a) => ({ id: str(a.id), name: str(a.name, "file"), type: str(a.type, "application/octet-stream"), size: Number(a.size) || 0 })),
		...(e.pinned === true ? { pinned: true as const } : {}),
		createdAt: str(e.createdAt, t),
		updatedAt: str(e.updatedAt, t),
	};
}

export function parseContent(value: unknown): BookContent {
	const o = obj(value);
	const t = now();
	const base = emptyContent();
	const features = obj(o.features);
	const deleted = obj(o.deletedEntries);
	const entries = arr(o.entries).map((e) => parseEntry(e, t));
	// an older book has no bin: an empty one
	const trash = arr(o.trash)
		.map(obj)
		.filter((x) => typeof x.id === "string" && typeof x.deletedAt === "string")
		.map((x): TrashItem => ({ id: str(x.id), deletedAt: str(x.deletedAt), ...(x.entry ? { entry: parseEntry(x.entry, t) } : {}) }));
	return {
		entries,
		deletedEntries: Object.fromEntries(Object.entries(deleted).filter(([, v]) => typeof v === "string")) as Record<string, string>,
		trash: tidyTrash(trash, entries),
		categories: arr(o.categories)
			.map(obj)
			.filter((c) => typeof c.id === "string")
			.map((c) => ({ id: str(c.id), name: str(c.name), updatedAt: str(c.updatedAt, EPOCH), ...(c.deleted === true ? { deleted: true } : {}) })),
		features: { categories: features.categories === true, customFields: features.customFields === true },
		featuresUpdatedAt: str(o.featuresUpdatedAt, base.featuresUpdatedAt),
	};
}
