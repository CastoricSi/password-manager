import { useEffect, useRef, useState } from "react";

import { useLibrary, useSync } from "@/app/context";
import { navigate, useRoute } from "@/app/nav";
import { usePrefs } from "@/app/prefs";
import { hasPassword } from "@/lib/bookfile";
import { MainScreen } from "@/screens/main/MainScreen";
import { StartFlow } from "@/screens/start/StartFlow";

const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/**
 * The URL picks the screen (see app/nav.ts): no book → the start card; a
 * book → the main screen. A password book reached from outside (the picker,
 * a refresh, a link) is unlocked in the start card first; one that locks
 * while in use is unlocked in place.
 */
export default function App() {
	const [{ loaded, books, opened, currentId }, library] = useLibrary();
	const [syncState] = useSync();
	const { autoLock } = usePrefs();
	const route = useRoute();
	const [entered, setEntered] = useState(false);
	const [recovering, setRecovering] = useState<string | null>(null);
	const [autoLocked, setAutoLocked] = useState(false);

	const book = route.book ? books.find((b) => b.id === route.book) : undefined;
	const cloudPending = syncState.mode === "google" && !syncState.firstSyncDone;
	const locked = !!book && hasPassword(book) && !opened[book.id];

	// Back at the picker: the next password book is unlocked in the card again.
	if (!route.book && entered) setEntered(false);
	// A book that can be shown directly counts as entered.
	if (book && !locked && !recovering && !entered) setEntered(true);

	// A book that isn't here (deleted, another device's link): back to the picker.
	useEffect(() => {
		if (loaded && route.book && !book && !cloudPending) navigate({}, { replace: true });
	}, [loaded, route.book, book, cloudPending]);
	// Remember the last book (the picker lists it first).
	useEffect(() => {
		if (book && book.id !== currentId) library.select(book.id);
	}, [book, currentId, library]);

	// Lock password books after `autoLock` minutes without any activity.
	const lockRef = useRef(() => {});
	useEffect(() => {
		lockRef.current = () => {
			if (!library.anyUnlocked) return;
			library.lockAll();
			setAutoLocked(true);
		};
	});
	useEffect(() => {
		if (autoLock === 0) return;
		let timer = window.setTimeout(() => lockRef.current(), autoLock * 60_000);
		const reset = () => {
			setAutoLocked(false);
			window.clearTimeout(timer);
			timer = window.setTimeout(() => lockRef.current(), autoLock * 60_000);
		};
		for (const ev of ACTIVITY) window.addEventListener(ev, reset, { passive: true });
		return () => {
			window.clearTimeout(timer);
			for (const ev of ACTIVITY) window.removeEventListener(ev, reset);
		};
	}, [autoLock]);

	if (!loaded) return null;
	if (!book || recovering || (locked && !entered)) {
		return (
			<StartFlow
				route={book ? {} : route}
				unlockBook={locked && !entered && !recovering ? book : undefined}
				recovering={recovering}
				onUnlocked={(_id, viaRecovery) => (viaRecovery ? setRecovering(_id) : setEntered(true))}
				onRecoveredDone={() => {
					setRecovering(null);
					setEntered(true);
				}}
			/>
		);
	}
	return <MainScreen key="main" book={book} route={route} autoLocked={autoLocked} />;
}
