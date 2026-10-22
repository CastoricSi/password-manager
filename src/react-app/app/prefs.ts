import { createContext, useContext } from "react";

import type { Lang, MessageKey } from "./i18n";

// Per-device preferences (not part of the encrypted book).

export type Theme = "paper" | "dark" | "system";
export type FontSize = "normal" | "large";
/** How a book's entries are shown on wide screens. */
export type Layout = "list" | "table";
export const AUTO_LOCK_CHOICES = [5, 10, 30, 0] as const; // 0 = never
export type AutoLock = (typeof AUTO_LOCK_CHOICES)[number];

export interface Prefs {
	theme: Theme;
	fontSize: FontSize;
	lang: Lang;
	autoLock: AutoLock;
	layout: Layout;
}

export interface PrefsContextValue extends Prefs {
	set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
	t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

export const PrefsContext = createContext<PrefsContextValue | null>(null);

export function usePrefs() {
	const ctx = useContext(PrefsContext);
	if (!ctx) throw new Error("usePrefs must be used inside PrefsProvider");
	return ctx;
}

/** Shorthand for components that only need text. */
export function useT() {
	return usePrefs().t;
}
