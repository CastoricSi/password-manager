import { describe, expect, it } from "vitest";

import {
	createBook,
	mergeBooks,
	openPlain,
	openWithAnswer,
	openWithPassword,
	parseBookFile,
	passwordHint,
	putAttachment,
	readAttachment,
	readContent,
	removePassword,
	removeRecovery,
	setPassword,
	setPasswordHint,
	setRecovery,
	slotsOf,
	writeContent,
} from "./bookfile";
import { newEntry, upsertEntry } from "./content";
import { newBookKey, passwordSlot, recoveryHint, sealText, WrongSecretError } from "./crypto";

const secret = { password: "Garden-2024", recovery: { question: "Mother?", answer: "Wang Xiu Ying" } };

describe("password books", () => {
	it("never store contents or attachments in clear", async () => {
		const { file, opened } = await createBook("机密", secret);
		const content = upsertEntry(opened.content, { ...newEntry(), name: "微信", password: "s3cret", attachments: [{ id: "a1", name: "id.png", type: "image/png", size: 3 }] });
		let next = await writeContent(file, { ...opened, content });
		next = await putAttachment(next, opened.key, "a1", "data:image/png;base64,QUJD");
		const text = JSON.stringify(next);
		expect(text).not.toContain("s3cret");
		expect(text).not.toContain("微信");
		expect(text).not.toContain("QUJD");
		expect(text).toContain("机密"); // the name is visible so locked books can be listed

		const reopened = await openWithPassword(next, "Garden-2024");
		expect(reopened.content.entries[0].name).toBe("微信");
		expect(await readAttachment(next, reopened.key, "a1")).toBe("data:image/png;base64,QUJD");
	});

	it("rejects wrong secrets; recovery answers are forgiving", async () => {
		const { file } = await createBook("x", secret);
		await expect(openWithPassword(file, "nope")).rejects.toBeInstanceOf(WrongSecretError);
		expect((await openWithAnswer(file, "  wang xiu ying ")).key).toBeTruthy();
		await expect(openWithAnswer(file, "someone")).rejects.toBeInstanceOf(WrongSecretError);
	});

	it("changing the password keeps the key and the recovery question", async () => {
		const { file, opened } = await createBook("x", secret);
		const changed = await setPassword(file, opened, "New-Pass");
		expect(changed.key).toBe(opened.key);
		await expect(openWithPassword(changed.file, "Garden-2024")).rejects.toBeInstanceOf(WrongSecretError);
		await openWithPassword(changed.file, "New-Pass");
		await openWithAnswer(changed.file, "wang xiu ying");
	});

	it("sets and removes the recovery question", async () => {
		const { file, opened } = await createBook("x", { password: "pw" });
		const withQ = await setRecovery(file, opened.key!, "Q", "A");
		await openWithAnswer(withQ, "a");
		await expect(openWithAnswer(removeRecovery(withQ), "a")).rejects.toBeInstanceOf(WrongSecretError);
	});
});

describe("books without a password", () => {
	it("store plainly and can be protected later (and back)", async () => {
		const { file, opened } = await createBook("日常", null);
		expect(opened.key).toBeNull();
		const content = upsertEntry(opened.content, { ...newEntry(), name: "WiFi", password: "home123", attachments: [{ id: "f", name: "x", type: "text/plain", size: 1 }] });
		let book = await putAttachment(await writeContent(file, { key: null, content }), null, "f", "data:text/plain;base64,eA==");
		expect(JSON.stringify(book)).toContain("home123");

		const locked = await setPassword(book, { key: null, content }, "pw");
		expect(JSON.stringify(locked.file)).not.toContain("home123");
		expect(JSON.stringify(locked.file)).not.toContain("eA==");
		const opened2 = await openWithPassword(locked.file, "pw");
		expect(await readAttachment(locked.file, opened2.key, "f")).toBe("data:text/plain;base64,eA==");

		book = await removePassword(locked.file, opened2);
		expect((await openPlain(book)).content.entries[0].password).toBe("home123");
		expect(await readAttachment(book, null, "f")).toBe("data:text/plain;base64,eA==");
	});
});

describe("mergeBooks", () => {
	it("merges two edited copies of a password book", async () => {
		const { file, opened } = await createBook("x", { password: "pw" });
		const a = await writeContent(file, { ...opened, content: upsertEntry(opened.content, { ...newEntry(), name: "fromA" }) });
		const b = await writeContent(file, { ...opened, content: upsertEntry(opened.content, { ...newEntry(), name: "fromB" }) });
		const merged = await mergeBooks(a, b, opened.key);
		const names = (await readContent(merged!.file, opened.key)).entries.map((e) => e.name).sort();
		expect(names).toEqual(["fromA", "fromB"]);
	});

	it("returns null when the other copy can't be read with this key", async () => {
		const { file, opened } = await createBook("x", null);
		const elsewhere = await setPassword(file, opened, "pw"); // new key on another device
		expect(await mergeBooks(file, elsewhere.file, null)).toBeNull();
	});
});

describe("parseBookFile", () => {
	it("upgrades the previous single-book format", async () => {
		const key = await newBookKey();
		const v1 = {
			format: "password-book",
			version: 1,
			slots: [await passwordSlot(key, "pw")],
			content: await sealText(JSON.stringify({ entries: [{ id: "1", name: "Old", password: "p" }] }), key),
			savedAt: "2026-01-01T00:00:00.000Z",
		};
		const book = parseBookFile(JSON.parse(JSON.stringify(v1)), "我的密码本")!;
		expect(book.version).toBe(2);
		expect(book.name).toBe("我的密码本");
		expect((await openWithPassword(book, "pw")).content.entries[0].name).toBe("Old");
	});

	it("rejects anything else", async () => {
		const { file } = await createBook("x", null);
		expect(parseBookFile(JSON.parse(JSON.stringify(file)))).not.toBeNull();
		expect(parseBookFile({})).toBeNull();
		expect(parseBookFile({ ...file, protection: { kind: "password", slots: [] } })).toBeNull();
		expect(parseBookFile({ ...file, version: 3 })).toBeNull();
	});
});

describe("hints", () => {
	it("stores a readable password hint and answer hint; the secrets stay sealed", async () => {
		const { file, opened } = await createBook("x", { password: "Garden-2024", hint: "my garden + year", recovery: { question: "Pet?", answer: "Rex", hint: "the dog" } });
		expect(passwordHint(file)).toBe("my garden + year");
		expect(recoveryHint(slotsOf(file))).toBe("the dog");
		expect(JSON.stringify(file)).not.toContain("Garden-2024");

		// Changing the password keeps the recovery hint; a new password hint replaces the old one.
		const changed = await setPassword(file, opened, "New-Pass", "new hint");
		expect(passwordHint(changed.file)).toBe("new hint");
		expect(recoveryHint(slotsOf(changed.file))).toBe("the dog");
		expect(passwordHint(setPasswordHint(changed.file, ""))).toBeNull();
		expect(parseBookFile(JSON.parse(JSON.stringify(changed.file)))).not.toBeNull();
	});
});
