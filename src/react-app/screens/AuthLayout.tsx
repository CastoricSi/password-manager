import { Button } from "sityle";

import { usePrefs } from "@/app/prefs";
import { Logo } from "@/ui/Logo";

/**
 * The one fixed-size card for everything before a book is open; the steps
 * slide inside it. On phones there is no card: the same content fills the page.
 */
export function AuthLayout({ children }: { children: React.ReactNode }) {
	const { lang, set } = usePrefs();
	return (
		<div className="pm-auth">
			<div className="pm-auth-top">
				<Button variant="ghost" size="sm" onClick={() => set("lang", lang === "zh" ? "en" : "zh")} lang={lang === "zh" ? "en" : "zh-CN"}>
					{lang === "zh" ? "English" : "中文"}
				</Button>
			</div>
			<main className="pm-auth-main">
				<div className="si-card pm-auth-card">{children}</div>
			</main>
			<BuildInfo />
		</div>
	);
}

/** Which build is running (version · commit · sityle), at the foot of the page; hover shows when it was built. */
function BuildInfo() {
	const { t, lang } = usePrefs();
	const { version, commit, sityle, time } = __PM_BUILD__;
	const built = new Date(time).toLocaleString(lang === "zh" ? "zh-CN" : "en");
	return (
		<footer className="pm-auth-version" title={t("app.built", { time: built })}>
			{[t("app.version", { version }), commit, `sityle ${sityle}`].filter(Boolean).join(" · ")}
		</footer>
	);
}

/** Icon + big title at the top of a step (start and book picker only); it slides with its step. */
export function Brand() {
	const { t } = usePrefs();
	return (
		<div className="pm-brand">
			<Logo size={88} />
			<h1>{t("app.name")}</h1>
			<p className="pm-muted">{t("app.tagline")}</p>
		</div>
	);
}
