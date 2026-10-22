// WebCrypto primitives for password books.
//
// A password-protected book has a random 256-bit "book key" (AES-GCM) that
// encrypts its contents and attachments. The book key is stored wrapped once
// per way of opening the book ("slots"):
//   • the main password                    (always present)
//   • the answer to a recovery question    (optional)
// Wrapping keys come from PBKDF2-SHA-256. Changing one slot re-wraps the same
// book key, so the other slot keeps working and other devices that already
// hold the key can still read new data. Nothing leaves the browser in clear.

export const KDF_ITERATIONS = 600_000; // OWASP 2023+ recommendation for PBKDF2-SHA256

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type Sealed = { iv: string; data: string }; // base64

export type PasswordSlot = { kind: "password"; salt: string; iterations: number; wrapped: Sealed };
/** `hint` is an optional plain-text hint for the answer, shown when answering. */
export type RecoverySlot = { kind: "recovery"; question: string; hint?: string; salt: string; iterations: number; wrapped: Sealed };
export type Slot = PasswordSlot | RecoverySlot;

export class WrongSecretError extends Error {
	constructor() {
		super("wrong secret");
	}
}

// ── Encoding helpers ─────────────────────────────────────────────────────────

export function toBase64(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
	const s = atob(value);
	const out = new Uint8Array(new ArrayBuffer(s.length));
	for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
	return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(new ArrayBuffer(n));
	crypto.getRandomValues(out);
	return out;
}

/** Recovery answers are forgiving: case, width and extra spaces don't matter. */
export function normalizeAnswer(answer: string): string {
	return answer.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

// ── Keys ─────────────────────────────────────────────────────────────────────

async function deriveKey(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
	const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
		material,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export function newBookKey(): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function sealBytes(bytes: Uint8Array<ArrayBuffer>, key: CryptoKey): Promise<Sealed> {
	const iv = randomBytes(12);
	const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
	return { iv: toBase64(iv), data: toBase64(data) };
}

async function openBytes(sealed: Sealed, key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
	return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.data)));
}

export async function sealText(text: string, key: CryptoKey): Promise<Sealed> {
	return sealBytes(encoder.encode(text), key);
}

/** Throws WrongSecretError if the key doesn't match. */
export async function openText(sealed: Sealed, key: CryptoKey): Promise<string> {
	try {
		return decoder.decode(await openBytes(sealed, key));
	} catch {
		throw new WrongSecretError();
	}
}

async function wrap(bookKey: CryptoKey, secret: string) {
	const salt = randomBytes(16);
	const wrappingKey = await deriveKey(secret, salt, KDF_ITERATIONS);
	const raw = new Uint8Array(await crypto.subtle.exportKey("raw", bookKey));
	return { salt: toBase64(salt), iterations: KDF_ITERATIONS, wrapped: await sealBytes(raw, wrappingKey) };
}

async function unwrap(slot: Slot, secret: string): Promise<CryptoKey> {
	try {
		const wrappingKey = await deriveKey(secret, fromBase64(slot.salt), slot.iterations);
		const raw = await openBytes(slot.wrapped, wrappingKey);
		return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
	} catch {
		throw new WrongSecretError();
	}
}

/** True when both keys are the same book key. */
export async function sameKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
	if (a === b) return true;
	const [ra, rb] = await Promise.all([crypto.subtle.exportKey("raw", a), crypto.subtle.exportKey("raw", b)]);
	return toBase64(new Uint8Array(ra)) === toBase64(new Uint8Array(rb));
}

// ── Slots ────────────────────────────────────────────────────────────────────

export async function passwordSlot(bookKey: CryptoKey, password: string): Promise<PasswordSlot> {
	return { kind: "password", ...(await wrap(bookKey, password)) };
}

export async function recoverySlot(bookKey: CryptoKey, question: string, answer: string, hint?: string): Promise<RecoverySlot> {
	return { kind: "recovery", question, ...(hint?.trim() ? { hint: hint.trim() } : {}), ...(await wrap(bookKey, normalizeAnswer(answer))) };
}

/** Throws WrongSecretError when wrong (or when there is no such slot). */
export function unlockWithPassword(slots: Slot[], password: string): Promise<CryptoKey> {
	const slot = slots.find((s) => s.kind === "password");
	return slot ? unwrap(slot, password) : Promise.reject(new WrongSecretError());
}

export function unlockWithAnswer(slots: Slot[], answer: string): Promise<CryptoKey> {
	const slot = slots.find((s) => s.kind === "recovery");
	return slot ? unwrap(slot, normalizeAnswer(answer)) : Promise.reject(new WrongSecretError());
}

export function recoveryQuestion(slots: Slot[]): string | null {
	const slot = slots.find((s): s is RecoverySlot => s.kind === "recovery");
	return slot ? slot.question : null;
}

export function recoveryHint(slots: Slot[]): string | null {
	const slot = slots.find((s): s is RecoverySlot => s.kind === "recovery");
	return slot?.hint ?? null;
}

// ── Validation of untrusted data ─────────────────────────────────────────────

export function isSealed(v: unknown): v is Sealed {
	const o = v as Sealed;
	return !!o && typeof o.iv === "string" && typeof o.data === "string";
}

export function isSlot(v: unknown): v is Slot {
	const o = v as Slot;
	if (!o || typeof o.salt !== "string" || typeof o.iterations !== "number" || !isSealed(o.wrapped)) return false;
	if (o.kind === "recovery") return typeof o.question === "string" && (o.hint === undefined || typeof o.hint === "string");
	return o.kind === "password";
}
