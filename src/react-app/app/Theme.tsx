import { useMemo } from "react";
import { SiProvider, type Messages } from "sityle";

import { usePrefs, useT } from "./prefs";

/**
 * sityle (丹青) follows the app's own theme setting ("paper" = light), and the
 * texts sityle writes itself (copy, show / hide, cancel, strength…) come from
 * the app's language.
 */
export function Theme({ children }: { children: React.ReactNode }) {
	const { theme } = usePrefs();
	const t = useT();
	const messages = useMemo<Partial<Messages>>(
		() => ({
			copy: t("common.copy"),
			copied: t("common.copied"),
			show: t("common.show"),
			hide: t("common.hide"),
			clear: t("common.clear"),
			cancel: t("common.cancel"),
			loading: t("common.loading"),
			strength: [t("pw.s0"), t("pw.s1"), t("pw.s2"), t("pw.s3"), t("pw.s4")],
		}),
		[t],
	);
	return (
		<SiProvider theme={theme === "paper" ? "light" : theme} messages={messages}>
			{children}
		</SiProvider>
	);
}
