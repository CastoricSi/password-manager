import { useCallback, useEffect, useMemo, useState } from "react";

import { dictionaries, format, type Lang, type MessageKey } from "./i18n";
import { AUTO_LOCK_CHOICES, PrefsContext, type Prefs } from "./prefs";

const STORAGE_KEY = "password-book-prefs";

function defaults(): Prefs {
	const lang: Lang = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
	return { theme: "paper", fontSize: "normal", lang, autoLock: 10, layout: "list" };
}

function load(): Prefs {
	const base = defaults();
	try {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Prefs>;
		return {
			theme: saved.theme === "dark" || saved.theme === "system" || saved.theme === "paper" ? saved.theme : base.theme,
			fontSize: saved.fontSize === "large" ? "large" : "normal",
			lang: saved.lang === "en" || saved.lang === "zh" ? saved.lang : base.lang,
			autoLock: (AUTO_LOCK_CHOICES as readonly number[]).includes(saved.autoLock as number)
				? (saved.autoLock as Prefs["autoLock"])
				: base.autoLock,
			layout: saved.layout === "table" ? "table" : "list",
		};
	} catch {
		return base;
	}
}

export function PrefsProvider({ children }: { children: React.ReactNode }) {
	const [prefs, setPrefs] = useState<Prefs>(load);

	// The theme itself is applied by <SiProvider> (main.tsx); this only keeps
	// the browser's bar colour in step. Text size and language go on <html>.
	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const dark = prefs.theme === "dark" || (prefs.theme === "system" && media.matches);
			document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#131715" : "#f0f1e9");
		};
		apply();
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, [prefs.theme]);

	useEffect(() => {
		document.documentElement.style.fontSize = prefs.fontSize === "large" ? "18px" : "16px";
	}, [prefs.fontSize]);

	useEffect(() => {
		document.documentElement.lang = prefs.lang === "zh" ? "zh-CN" : "en";
		document.title = dictionaries[prefs.lang]["app.name"];
	}, [prefs.lang]);

	const set = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
		setPrefs((prev) => {
			const next = { ...prev, [key]: value };
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			} catch {
				// Private mode — preferences just won't persist.
			}
			return next;
		});
	}, []);

	const t = useCallback(
		(key: MessageKey, params?: Record<string, string | number>) => format(dictionaries[prefs.lang][key], params),
		[prefs.lang],
	);

	const value = useMemo(() => ({ ...prefs, set, t }), [prefs, set, t]);
	return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
