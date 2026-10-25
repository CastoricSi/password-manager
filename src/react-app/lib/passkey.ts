// Face ID / Touch ID / fingerprint / Windows Hello unlock, one device at a time.
//
// Each device makes one passkey for this site (WebAuthn, user verification
// required). Its PRF extension turns a per-book salt into 32 secret bytes that
// only that passkey, on a verified user, can produce; they wrap the book key.
// The wrapped key stays on this device (localStorage) and never syncs: another
// device has to turn it on itself. The main password always still works.

import { fromBase64, toBase64, type Sealed } from "./crypto";

const DEVICE_KEY = "pm-passkey-device";
const recordKey = (bookId: string) => `pm-passkey:${bookId}`;
const skipKey = (bookId: string) => `pm-passkey-skip:${bookId}`;

/** This device's passkey for the app. */
type Device = { credentialId: string };
/** A book that opens with it: its salt for the PRF, and the book key wrapped with the result. */
type BookRecord = { credentialId: string; salt: string; wrapped: Sealed };

export class PasskeyUnsupportedError extends Error {
	constructor() {
		super("this device's passkeys can't unlock books (no PRF)");
	}
}

function read<T>(key: string): T | null {
	try {
		const v = localStorage.getItem(key);
		return v ? (JSON.parse(v) as T) : null;
	} catch {
		return null;
	}
}
function write(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// private mode: not remembered
	}
}
function remove(key: string) {
	try {
		localStorage.removeItem(key);
	} catch {
		// nothing to remove
	}
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));

/** A device that may unlock with a passkey: a built-in authenticator that verifies the user, and PRF (when the browser says). */
export async function passkeySupported(): Promise<boolean> {
	if (typeof PublicKeyCredential === "undefined" || !window.isSecureContext) return false;
	try {
		if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return false;
		const caps = await (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities?.();
		return caps?.["extension:prf"] !== false;
	} catch {
		return false;
	}
}

export const hasPasskey = (bookId: string) => read<BookRecord>(recordKey(bookId)) !== null;

/** "Not now" for this book on this device: it isn't offered again (settings still can). */
export const skippedPasskey = (bookId: string) => read<boolean>(skipKey(bookId)) === true;
export const skipPasskey = (bookId: string) => write(skipKey(bookId), true);

type PrfResults = { enabled?: boolean; results?: { first?: BufferSource } };
const prfOf = (cred: PublicKeyCredential) => (cred.getClientExtensionResults() as { prf?: PrfResults }).prf;

/** The device's passkey, made on first use (some browsers return the PRF result right away). */
async function ensureDevice(salt: Uint8Array<ArrayBuffer>, label: string): Promise<{ credentialId: string; first?: BufferSource }> {
	const known = read<Device>(DEVICE_KEY);
	if (known) return { credentialId: known.credentialId };
	const cred = (await navigator.credentials.create({
		publicKey: {
			rp: { name: label },
			user: { id: random(16), name: label, displayName: label },
			challenge: random(32),
			pubKeyCredParams: [
				{ type: "public-key", alg: -7 },
				{ type: "public-key", alg: -257 },
			],
			authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
			extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
		},
	})) as PublicKeyCredential | null;
	if (!cred) throw new PasskeyUnsupportedError();
	const prf = prfOf(cred);
	if (prf?.enabled === false) throw new PasskeyUnsupportedError();
	const credentialId = toBase64(new Uint8Array(cred.rawId));
	write(DEVICE_KEY, { credentialId } satisfies Device);
	return { credentialId, first: prf?.results?.first };
}

/** Asks for Face ID / fingerprint and returns the PRF bytes for this salt. */
async function evaluate(credentialId: string, salt: Uint8Array<ArrayBuffer>): Promise<BufferSource> {
	const cred = (await navigator.credentials.get({
		publicKey: {
			challenge: random(32),
			allowCredentials: [{ type: "public-key", id: fromBase64(credentialId) }],
			userVerification: "required",
			extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
		},
	})) as PublicKeyCredential | null;
	const first = cred && prfOf(cred)?.results?.first;
	if (!first) throw new PasskeyUnsupportedError();
	return first;
}

async function wrappingKey(prf: BufferSource) {
	const material = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode("password-manager book key") },
		material,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

/**
 * Lets this device open the book with its passkey (asks for Face ID / fingerprint;
 * the first time on a device it also makes the passkey). Throws
 * PasskeyUnsupportedError when the device can't, NotAllowedError when cancelled.
 */
export async function enablePasskey(bookId: string, bookKey: CryptoKey, label: string): Promise<void> {
	const salt = random(32);
	const device = await ensureDevice(salt, label);
	const prf = device.first ?? (await evaluate(device.credentialId, salt));
	const iv = random(12);
	const raw = new Uint8Array(await crypto.subtle.exportKey("raw", bookKey));
	const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await wrappingKey(prf), raw));
	write(recordKey(bookId), { credentialId: device.credentialId, salt: toBase64(salt), wrapped: { iv: toBase64(iv), data: toBase64(data) } } satisfies BookRecord);
	remove(skipKey(bookId));
}

/**
 * The book key, after Face ID / fingerprint. Null when cancelled. A record that no
 * longer opens the book (the passkey was deleted, the book got a new key) is
 * dropped, and the error rethrown: the main password is the way in then.
 */
export async function unlockWithPasskey(bookId: string): Promise<CryptoKey | null> {
	const record = read<BookRecord>(recordKey(bookId));
	if (!record) return null;
	let prf: BufferSource;
	try {
		prf = await evaluate(record.credentialId, fromBase64(record.salt));
	} catch (e) {
		if (e instanceof DOMException && e.name === "NotAllowedError") return null;
		throw e;
	}
	try {
		const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(record.wrapped.iv) }, await wrappingKey(prf), fromBase64(record.wrapped.data));
		return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
	} catch (e) {
		disablePasskey(bookId);
		throw e;
	}
}

/** This device no longer opens the book with its passkey. */
export function disablePasskey(bookId: string) {
	remove(recordKey(bookId));
}

/** Forgets everything passkey-related on this device (the passkey itself stays in the system's keychain). */
export function forgetPasskeys() {
	try {
		for (const k of Object.keys(localStorage)) if (k.startsWith("pm-passkey")) localStorage.removeItem(k);
	} catch {
		// nothing stored
	}
}
