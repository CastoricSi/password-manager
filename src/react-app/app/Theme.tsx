import { SiProvider } from "sityle";

import { usePrefs } from "./prefs";

/** sityle (丹青) follows the app's own theme setting ("paper" = light). */
export function Theme({ children }: { children: React.ReactNode }) {
	const { theme } = usePrefs();
	return <SiProvider theme={theme === "paper" ? "light" : theme}>{children}</SiProvider>;
}
