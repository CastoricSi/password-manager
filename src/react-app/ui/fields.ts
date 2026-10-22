import { useT } from "@/app/prefs";

/** Show / hide / copy texts for sityle's PasswordField, in the app's language. */
export function usePasswordLabels() {
	const t = useT();
	return { show: t("common.show"), hide: t("common.hide"), copy: t("common.copy"), copied: t("common.copied") };
}

/** Strength bar texts, weakest first. */
export function useStrengthLabels() {
	const t = useT();
	return [t("pw.s0"), t("pw.s1"), t("pw.s2"), t("pw.s3"), t("pw.s4")];
}

/** onKeyDown / onKeyUp that report whether Caps Lock is on. */
export function capsLock(report: (on: boolean) => void) {
	const check = (e: React.KeyboardEvent) => report(e.getModifierState?.("CapsLock") ?? false);
	return { onKeyDown: check, onKeyUp: check };
}
