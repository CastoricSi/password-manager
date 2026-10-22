import { useEffect, useState } from "react";

import { AppContext } from "./context";
import { Library } from "./library";
import { usePrefs } from "./prefs";
import { SyncController } from "./syncController";

export function AppProvider({ children }: { children: React.ReactNode }) {
	const { t, lang } = usePrefs();
	const [value] = useState(() => {
		const library = new Library();
		const sync = new SyncController(library, {
			folder: t("drive.folder"),
			deleted: t("drive.deleted"),
			pickTitle: t("share.pickTitle"),
			locale: lang === "zh" ? "zh-CN" : "en",
		});
		return { library, sync };
	});

	useEffect(() => {
		void value.library.load(t("book.defaultName")).then(() => value.sync.start());
		// Load once; the names only matter for new folders / upgraded old data.
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
