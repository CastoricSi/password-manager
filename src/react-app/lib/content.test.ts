import { describe, expect, it, vi } from "vitest";

import {
	deleteCategory,
	emptyContent,
	ensureCategory,
	findEntries,
	mergeContent,
	newEntry,
	parseContent,
	pinEntry,
	removeEntry,
	toHref,
	upsertEntry,
	type Entry,
} from "./content";
import { generatePassword, passwordStrength } from "./password";

const entry = (name: string, extra: Partial<Entry> = {}): Entry => ({ ...newEntry(), name, ...extra });
const at = (iso: string) => `2026-01-0${iso}T00:00:00.000Z`;

describe("editing", () => {
	it("adds, updates, removes with a tombstone", () => {
		const a = entry("微信");
		let c = upsertEntry(emptyContent(), a);
		c = upsertEntry(c, { ...a, username: "138" });
		expect(c.entries).toHaveLength(1);
		expect(c.entries[0].username).toBe("138");
		c = removeEntry(c, a.id);
		expect(c.entries).toHaveLength(0);
		expect(c.deletedEntries[a.id]).toBeTruthy();
	});

	it("drops empty custom fields and trims labels on save", () => {
		const c = upsertEntry(emptyContent(), entry("x", { fields: [{ id: "1", label: " PIN ", value: "1234", secret: true }, { id: "2", label: "", value: "", secret: false }] }));
		expect(c.entries[0].fields).toEqual([{ id: "1", label: "PIN", value: "1234", secret: true }]);
	});

	it("deleting a category uncategorises its entries", () => {
		const { content, id } = ensureCategory(emptyContent(), "Bank");
		expect(ensureCategory(content, "Bank").id).toBe(id);
		const withEntry = upsertEntry(content, entry("ICBC", { categoryId: id }));
		const after = deleteCategory(withEntry, id);
		expect(after.entries[0].categoryId).toBeNull();
		expect(after.categories[0].deleted).toBe(true);
	});
});

describe("search", () => {
	it("filters by text and category, sorted by name; secret fields aren't searched", () => {
		const c = {
			...emptyContent(),
			entries: [
				entry("Zoom", { username: "wang@x.com", categoryId: "work" }),
				entry("Apple"),
				entry("bank", { fields: [{ id: "f", label: "PIN", value: "9999", secret: true }] }),
			],
		};
		expect(findEntries(c, "", null, "en").map((e) => e.name)).toEqual(["Apple", "bank", "Zoom"]);
		expect(findEntries(c, "WANG", null, "en").map((e) => e.name)).toEqual(["Zoom"]);
		expect(findEntries(c, "", "work", "en").map((e) => e.name)).toEqual(["Zoom"]);
		expect(findEntries(c, "9999", null, "en")).toHaveLength(0);
	});

	it("makes safe links", () => {
		expect(toHref("example.com")).toBe("https://example.com/");
		expect(toHref("javascript:alert(1)")).toBeNull();
	});
});

describe("mergeContent", () => {
	it("keeps the newer edit of each entry and is order-independent", () => {
		const base = entry("A", { updatedAt: at("1") });
		const a = { ...emptyContent(), entries: [{ ...base, username: "old", updatedAt: at("2") }, entry("onlyA", { updatedAt: at("2") })] };
		const b = { ...emptyContent(), entries: [{ ...base, username: "new", updatedAt: at("3") }, entry("onlyB", { updatedAt: at("2") })] };
		const m1 = mergeContent(a, b);
		const m2 = mergeContent(b, a);
		expect(m1).toEqual(m2);
		expect(m1.entries.find((e) => e.id === base.id)?.username).toBe("new");
		expect(m1.entries.map((e) => e.name).sort()).toEqual(["A", "onlyA", "onlyB"]);
	});

	it("a delete beats an older edit; a later edit resurrects", () => {
		const e = entry("A", { updatedAt: at("2") });
		const deleted = { ...emptyContent(), deletedEntries: { [e.id]: at("3") } };
		expect(mergeContent({ ...emptyContent(), entries: [e] }, deleted).entries).toHaveLength(0);
		const edited = { ...emptyContent(), entries: [{ ...e, updatedAt: at("4") }] };
		const m = mergeContent(edited, deleted);
		expect(m.entries).toHaveLength(1);
		expect(m.deletedEntries[e.id]).toBeUndefined();
	});

	it("features: newer setting wins", () => {
		const a = { ...emptyContent(), features: { categories: true, customFields: false }, featuresUpdatedAt: at("2") };
		const b = { ...emptyContent(), features: { categories: false, customFields: true }, featuresUpdatedAt: at("3") };
		expect(mergeContent(a, b).features).toEqual({ categories: false, customFields: true });
	});
});

describe("parseContent", () => {
	it("reads the previous version's entries (five fields only)", () => {
		const c = parseContent({ entries: [{ id: "1", name: "X", username: "u", password: "p", url: "", notes: "" }] });
		expect(c.entries[0]).toMatchObject({ name: "X", categoryId: null, fields: [], attachments: [] });
		expect(c.features).toEqual({ categories: false, customFields: false });
	});

	it("survives junk", () => {
		expect(parseContent(null).entries).toEqual([]);
		expect(parseContent({ entries: ["junk", { name: 5 }] }).entries).toHaveLength(2);
	});
});

describe("passwords", () => {
	it("generates readable passwords with every character class", () => {
		for (let i = 0; i < 30; i += 1) {
			const pw = generatePassword();
			expect(pw).toMatch(/[a-z]/);
			expect(pw).toMatch(/[A-Z]/);
			expect(pw).toMatch(/\d/);
			expect(pw).not.toMatch(/[0O1lI]/);
		}
		expect(passwordStrength("1234567")).toBe("weak");
		expect(passwordStrength("Garden-2024-x")).toBe("strong");
	});
});

describe("pinning", () => {
	it("an older book (no flag) reads as it is: nothing pinned, nothing added", () => {
		const old = { ...emptyContent(), entries: [entry("银行")] };
		const read = parseContent(JSON.parse(JSON.stringify(old)));
		expect(read.entries[0]).not.toHaveProperty("pinned");
		expect(read).toEqual(old);
	});

	it("keeps the flag only when it is true", () => {
		const read = parseContent({ entries: [{ ...entry("a"), pinned: true }, { ...entry("b"), pinned: "yes" }] });
		expect(read.entries.map((e) => e.pinned)).toEqual([true, undefined]);
	});

	it("pinned entries come first, each part by name", () => {
		const c = { ...emptyContent(), entries: [entry("丙"), entry("乙", { pinned: true }), entry("甲"), entry("丁", { pinned: true })] };
		expect(findEntries(c, "", null, "zh").map((e) => e.name)).toEqual(["丁", "乙", "丙", "甲"]);
	});

	it("pinning is an edit: it wins over the other device's older copy", () => {
		const e = entry("邮箱", { updatedAt: "2020-01-01T00:00:00.000Z" });
		const base = { ...emptyContent(), entries: [e] };
		const pinned = pinEntry(base, e.id, true);
		expect(pinned.entries[0]!.pinned).toBe(true);
		expect(pinned.entries[0]!.updatedAt > e.updatedAt).toBe(true);
		expect(mergeContent(base, pinned).entries[0]!.pinned).toBe(true);
		expect(mergeContent(pinned, base).entries[0]!.pinned).toBe(true);
		vi.useFakeTimers({ now: Date.parse(pinned.entries[0]!.updatedAt) + 1000 });
		const unpinned = pinEntry(pinned, e.id, false);
		vi.useRealTimers();
		expect(unpinned.entries[0]).not.toHaveProperty("pinned");
		expect(mergeContent(pinned, unpinned).entries[0]).not.toHaveProperty("pinned");
	});

	it("an app from before pinning that saved without the flag (same time) doesn't unpin", () => {
		const e = entry("网盘", { pinned: true });
		const stripped = { ...e };
		delete stripped.pinned;
		const a = { ...emptyContent(), entries: [e] };
		const b = { ...emptyContent(), entries: [stripped] };
		expect(mergeContent(a, b).entries[0]!.pinned).toBe(true);
		expect(mergeContent(b, a).entries[0]!.pinned).toBe(true);
	});
});
