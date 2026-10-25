// "Use Face ID / fingerprint next time?" — asked once per book and device, right
// after the main password opened it (or made it). Held here so the question
// outlives the unlock screen that asked for it.

import { useSyncExternalStore } from "react";

import { hasPasskey, passkeySupported, skippedPasskey } from "@/lib/passkey";

let offered: string | null = null;
const listeners = new Set<() => void>();
const set = (id: string | null) => {
	offered = id;
	listeners.forEach((l) => l());
};

/** After the main password opened `bookId`: ask, unless this device can't, already does, or was told "not now". */
export async function offerPasskey(bookId: string) {
	if (hasPasskey(bookId) || skippedPasskey(bookId)) return;
	if (await passkeySupported()) set(bookId);
}

export const closePasskeyOffer = () => set(null);

export function usePasskeyOffer(): string | null {
	return useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		() => offered,
		() => null,
	);
}
