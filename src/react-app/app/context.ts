import { createContext, useContext, useSyncExternalStore } from "react";

import type { Library } from "./library";
import type { SyncController } from "./syncController";

export const AppContext = createContext<{ library: Library; sync: SyncController } | null>(null);

function useApp() {
	const ctx = useContext(AppContext);
	if (!ctx) throw new Error("AppContext missing");
	return ctx;
}

/** Library state (re-renders on change) plus its actions. */
export function useLibrary() {
	const { library } = useApp();
	return [useSyncExternalStore(library.subscribe, library.getSnapshot), library] as const;
}

export function useSync() {
	const { sync } = useApp();
	return [useSyncExternalStore(sync.subscribe, sync.getSnapshot), sync] as const;
}
