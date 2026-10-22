// Where the user is, kept in the URL so the browser's Back / Forward and a
// refresh work like in any site. Only opaque ids go in — never names, entry
// contents or search text.
//
//   /                      book picker (or "local / Google" on first run)
//   /mode                  "local / Google" chosen again
//   /new                   new-book wizard (before a book is open)
//   /b/<book>              a book                     ?c=<category>
//   /b/<book>/e/<entry>    an entry                   ?settings=<tab>
//   /b/<book>/new          a new entry                ?dialog=newbook
//
// Going deeper pushes a history entry; sideways moves (category, settings
// tab, another entry while one is open) replace it; closing an overlay goes
// Back, so history stays as the user expects.

import { useMemo, useSyncExternalStore } from "react";

export type SettingsTab = "book" | "general" | "account" | "help";
const TABS: SettingsTab[] = ["book", "general", "account", "help"];

export type Route = {
	book?: string;
	/** An entry id, or "new" for a new entry. */
	entry?: string;
	cat?: string;
	settings?: SettingsTab;
	dialog?: "newbook";
	start?: "new" | "mode";
};

export function parseRoute(pathname: string, search: string): Route {
	const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
	const q = new URLSearchParams(search);
	const r: Route = {};
	if (parts[0] === "b" && parts[1]) {
		r.book = parts[1];
		if (parts[2] === "e" && parts[3]) r.entry = parts[3];
		else if (parts[2] === "new") r.entry = "new";
		const c = q.get("c");
		if (c) r.cat = c;
		if (q.get("dialog") === "newbook") r.dialog = "newbook";
	} else if (parts[0] === "new" || parts[0] === "mode") {
		r.start = parts[0];
	}
	const s = q.get("settings") as SettingsTab | null;
	if (s && TABS.includes(s) && r.book) r.settings = s;
	return r;
}

export function routeHref(r: Route): string {
	let path = "/";
	if (r.book) {
		path = `/b/${encodeURIComponent(r.book)}`;
		if (r.entry === "new") path += "/new";
		else if (r.entry) path += `/e/${encodeURIComponent(r.entry)}`;
	} else if (r.start) {
		path = `/${r.start}`;
	}
	const q = new URLSearchParams();
	if (r.book && r.cat) q.set("c", r.cat);
	if (r.book && r.settings) q.set("settings", r.settings);
	if (r.book && r.dialog) q.set("dialog", r.dialog);
	const qs = q.toString();
	return qs ? `${path}?${qs}` : path;
}

// ── the store ──────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const here = () => location.pathname + location.search;
/** The page this history entry was opened from (set on push, kept on replace). */
const prevOf = (): string | null => (typeof history.state?.pmPrev === "string" ? history.state.pmPrev : null);
let shown = "";

/** Returns false to let a Back / Forward through; true blocks it (e.g. unsaved changes). */
type Blocker = (proceed: () => void) => boolean;
let blocker: Blocker | null = null;

const RETURN_KEY = "pm-return-to";

function init() {
	// Back from a full-page Google sign-in (popup blocked): return to where we were.
	try {
		const back = sessionStorage.getItem(RETURN_KEY);
		if (back) {
			sessionStorage.removeItem(RETURN_KEY);
			if (here() === "/") history.replaceState({ pmPrev: prevOf() }, "", back);
		}
	} catch {
		// storage blocked: start at /
	}
	shown = here();
	addEventListener("popstate", () => {
		if (blocker?.(() => history.back())) {
			// Undo the move: put the page we were on back on top (the target stays
			// just behind it, so "proceed" is one Back away).
			history.pushState({ pmPrev: here() }, "", shown);
			return;
		}
		shown = here();
		emit();
	});
}
if (typeof window !== "undefined") init();

/** Go to a place. `replace` for sideways moves that shouldn't add a Back step. */
export function navigate(r: Route, opts: { replace?: boolean } = {}) {
	const url = routeHref(r);
	if (url === here()) return;
	if (opts.replace) history.replaceState({ pmPrev: prevOf() }, "", url);
	else history.pushState({ pmPrev: here() }, "", url);
	shown = here();
	emit();
}

/**
 * Close something / return to `target`: a real Back when the page before is
 * exactly `target` (history stays tidy); otherwise go there, replacing this
 * entry (e.g. after a refresh, a link, or a category change meanwhile).
 */
export function goBack(target: Route) {
	if (prevOf() === routeHref(target)) history.back();
	else navigate(target, { replace: true });
}

/** Ask before Back / Forward leaves (only one blocker at a time). Returns the remover. */
export function setNavBlocker(b: Blocker): () => void {
	blocker = b;
	return () => {
		if (blocker === b) blocker = null;
	};
}

/** Before a full-page redirect away (Google sign-in), remember where to come back to. */
export function rememberReturn() {
	try {
		sessionStorage.setItem(RETURN_KEY, here());
	} catch {
		// not remembered: the app starts at /
	}
}

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export function useRoute(): Route {
	const url = useSyncExternalStore(subscribe, here);
	return useMemo(() => {
		const [path, search = ""] = url.split("?");
		return parseRoute(path, search ? `?${search}` : "");
	}, [url]);
}
