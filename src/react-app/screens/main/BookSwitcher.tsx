import { BookOpen, Check, ChevronsUpDown, CloudAlert, LayoutGrid, Lock, LockOpen, Plus, Settings2, Users } from "lucide-react";
import { Menu, type MenuEntry } from "sityle";

import { useLibrary, useSync } from "@/app/context";
import { useT } from "@/app/prefs";
import { hasPassword, type BookFile } from "@/lib/bookfile";

export function BookIcon({ book, open, size = 16 }: { book: BookFile; open: boolean; size?: number }) {
	if (!hasPassword(book)) return <BookOpen size={size} />;
	return open ? <LockOpen size={size} /> : <Lock size={size} />;
}

/** Top of the sidebar: the current book; sityle's menu switches, creates, opens its settings. */
export function BookSwitcher({
	onSelect,
	onNewBook,
	onBookSettings,
	onAllBooks,
}: {
	onSelect: (id: string) => void;
	onNewBook: () => void;
	onBookSettings: () => void;
	onAllBooks: () => void;
}) {
	const t = useT();
	const [{ books, opened, currentId, records }] = useLibrary();
	const [syncState] = useSync();
	const current = books.find((b) => b.id === currentId);

	const status = (b: BookFile) => (!hasPassword(b) ? t("book.statusOpen") : opened[b.id] ? t("book.statusUnlocked") : t("book.statusLocked"));

	const bookItems: MenuEntry[] = books.map((b) => {
		const rec = records[b.id];
		const shared = rec?.ownedByMe === false;
		const waiting = syncState.waitingForUnlock.includes(b.id);
		return {
			icon: b.id === currentId ? <Check /> : <BookIcon book={b} open={!!opened[b.id]} />,
			label: (
				<span className="pm-two-line">
					<span>{b.name}</span>
					<small>
						{status(b)}
						{shared && (
							<>
								{" · "}
								<Users size={11} style={{ verticalAlign: -1 }} /> {t("share.from", { who: rec?.ownerName || rec?.ownerEmail || "" })}
							</>
						)}
						{waiting && (
							<span style={{ color: "var(--si-gold-text)" }}>
								{" · "}
								<CloudAlert size={11} style={{ verticalAlign: -1 }} /> {t("sync.waitingUnlock")}
							</span>
						)}
					</small>
				</span>
			),
			onSelect: () => onSelect(b.id),
		};
	});

	return (
		<div className="pm-switcher">
			<Menu
				trigger={(p) => (
					<button type="button" className="pm-switcher-button" {...p}>
						<span className="pm-book-icon">{current && <BookIcon book={current} open={!!opened[current.id]} />}</span>
						<span className="pm-two-line">
							<span style={{ fontWeight: 500 }}>{current?.name}</span>
							<small>{current && status(current)}</small>
						</span>
						<ChevronsUpDown />
					</button>
				)}
				items={[
					...bookItems,
					"divider",
					{ label: t("book.new"), icon: <Plus />, onSelect: onNewBook },
					{ label: t("book.settings"), icon: <Settings2 />, onSelect: onBookSettings },
					{ label: t("book.allBooks"), icon: <LayoutGrid />, onSelect: onAllBooks },
				]}
			/>
		</div>
	);
}
