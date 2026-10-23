import { Menu, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLibrary } from "@/app/context";
import { usePrefs } from "@/app/prefs";
import { goBack, navigate, setNavBlocker, type Route } from "@/app/nav";
import { hasPassword, type BookFile } from "@/lib/bookfile";
import { deleteCategory, ensureCategory, fieldLabels, findEntries, liveCategories, newEntry, renameCategory, type Entry } from "@/lib/content";
import { AnimatePresence, motion } from "motion/react";
import { Button, ConfirmDialog, Dialog, Fab, IconButton } from "sityle";
import { cn } from "@/ui/cn";

import { Logo } from "@/ui/Logo";
import { useLast } from "@/ui/useLast";
import { useMediaQuery } from "@/ui/useMediaQuery";
import { NewBookWizard } from "../NewBookWizard";
import { EntryEditor } from "./EntryEditor";
import { EntryList, ListFooter, SearchBox } from "./EntryList";
import { EntryTable } from "./EntryTable";
import { LockedPanel } from "./LockedPanel";
import { NewPasswordDialog } from "./NewPasswordDialog";
import { Pane } from "./Pane";
import { SettingsDialog } from "./SettingsPane";
import { Sidebar } from "./Sidebar";


/**
 * The usual password-manager layout:
 *   sidebar (book, All + categories, sync / settings / lock) | list | details.
 * Below 1024px the sidebar becomes a ☰ drawer; below 768px list and details
 * are separate pages. On wide screens the list can be a table instead, with
 * the details in a panel on the right. Settings and "new book" are dialogs.
 * Leaving a form with unsaved changes always asks first, also on the
 * browser's Back / Forward. What is open (entry, category, settings, new
 * book) lives in the URL (app/nav.ts).
 */
export function MainScreen({ book, route, autoLocked }: { book: BookFile; route: Route; autoLocked: boolean }) {
	const { t, lang, layout } = usePrefs();
	const wide = useMediaQuery("(min-width: 1024px)");
	// phones: ☰ + search on top, "New" as a floating button
	const phone = useMediaQuery("(max-width: 767px)");
	const tableMode = wide && layout === "table";
	const detailWidth = useMediaQuery("(min-width: 1280px)") ? 540 : 480;
	const [{ opened, saveFailed }, library] = useLibrary();
	// Bumped on every save: re-mounts the editor and shows "Saved ✓".
	const [saves, setSaves] = useState(0);
	const settings = route.settings ?? null;
	// kept while the settings dialog plays its closing animation
	const shownSettings = useLast(settings);
	const newBook = route.dialog === "newbook";
	const [drawer, setDrawer] = useState(false);
	const [query, setQuery] = useState("");
	const categoryId = route.cat ?? null;
	// The draft of a new entry (the URL only says "new").
	const [draft, setDraft] = useState<Entry | null>(null);
	const [mustReset, setMustReset] = useState<string | null>(null);
	const dirty = useRef(false);
	const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);

	const open = opened[book.id];
	const content = open?.content;
	const categories = useMemo(() => (content ? liveCategories(content) : []), [content]);
	const activeCategory = categories.some((c) => c.id === categoryId) ? categoryId : null;
	const entries = useMemo(() => (content ? findEntries(content, query, activeCategory, lang) : []), [content, query, activeCategory, lang]);
	const counts = useMemo(() => {
		const m = new Map<string | null, number>();
		for (const e of content?.entries ?? []) m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + 1);
		return m;
	}, [content]);
	// In the table, a category filter adds that category's custom fields as columns.
	const fieldColumns = useMemo(
		() => (activeCategory ? [...new Set(entries.flatMap((e) => e.fields.map((f) => f.label)).filter(Boolean))] : []),
		[entries, activeCategory],
	);
	const total = content?.entries.length ?? 0;

	const onDirtyChange = useCallback((d: boolean) => {
		dirty.current = d;
	}, []);

	// URLs within this book; the current category stays unless changed.
	const at = (r: Omit<Route, "book">): Route => ({ book: book.id, cat: activeCategory ?? undefined, ...r });
	const go = (r: Omit<Route, "book">, opts?: { replace?: boolean }) => navigate(at(r), opts);
	const view = route.entry === "new" ? "new" : route.entry ? "entry" : "none";

	const guard = (action: () => void) => {
		if (view !== "none" && dirty.current) setPendingNav(() => action);
		else {
			dirty.current = false;
			setSaves(0);
			action();
		}
	};

	const switchBook = (id: string, opts?: { replace?: boolean }) =>
		guard(() => {
			navigate({ book: id }, opts);
			setQuery("");
			setDrawer(false);
		});

	// Browser Back / Forward with unsaved changes: ask first.
	useEffect(
		() =>
			setNavBlocker((proceed) => {
				if (!dirty.current) return false;
				setPendingNav(() => proceed);
				return true;
			}),
		[],
	);
	// Refresh / closing the tab with unsaved changes: the browser asks.
	useEffect(() => {
		const warn = (e: BeforeUnloadEvent) => {
			if (dirty.current) e.preventDefault();
		};
		addEventListener("beforeunload", warn);
		return () => removeEventListener("beforeunload", warn);
	}, []);

	const loadAttachment = useCallback((id: string) => library.attachment(book.id, id), [library, book.id]);
	// Close the dialog first and change the URL once its fade is over: a
	// history step under the backdrop makes some GPUs flash a dark band.
	// `closing` lasts until the URL has really moved on (history.back() lands a
	// moment later), or the dialog would open again for that moment.
	const [closing, setClosing] = useState(false);
	if (closing && !settings && !newBook) setClosing(false);
	const closeOverlay = () => {
		setClosing(true);
		setTimeout(() => goBack(at({ entry: route.entry })), 200);
	};

	const selectedId = view === "entry" ? route.entry! : null;
	const current = selectedId ? content?.entries.find((e) => e.id === selectedId) : undefined;
	const showPane = view !== "none";
	// Another entry while one is open replaces it, so one Back returns to the list.
	const openEntry = (id: string) => (id === selectedId ? undefined : guard(() => go({ entry: id }, { replace: showPane })));
	const startNew = () =>
		guard(() => {
			setDraft(newEntry(activeCategory));
			go({ entry: "new" }, { replace: showPane });
		});
	const closeEntry = () => guard(() => goBack(at({})));

	// A new entry reached by Back / Forward or a refresh gets a fresh draft.
	if (view === "new" && !draft) setDraft(newEntry(activeCategory));
	// An entry or category that isn't here (deleted, synced away): drop it from the URL.
	useEffect(() => {
		if (!content) return;
		const goneEntry = view === "entry" && !current;
		const goneCat = !!route.cat && !activeCategory;
		if (goneEntry || goneCat) navigate({ ...route, entry: goneEntry ? undefined : route.entry, cat: goneCat ? undefined : route.cat }, { replace: true });
	}, [content, view, current, route, activeCategory]);

	let pane: React.ReactNode;
	if (content && ((view === "new" && draft) || (view === "entry" && current))) {
		const isNew = view === "new";
		const initial = isNew ? draft! : current!;
		pane = (
			<EntryEditor
				key={`${initial.id}:${saves}`}
				initial={initial}
				isNew={isNew}
				customFields={content.features.customFields}
				categories={categories}
				labelSuggestions={fieldLabels(content)}
				justSaved={saves > 0}
				loadAttachment={loadAttachment}
				onDirtyChange={onDirtyChange}
				onSave={async ({ entry, newFiles, newCategory }) => {
					await library.saveEntry(book.id, entry, newFiles, newCategory);
					dirty.current = false;
					if (isNew) go({ entry: entry.id }, { replace: true });
					setSaves((n) => n + 1);
				}}
				onCancel={closeEntry}
				onDelete={async () => {
					dirty.current = false;
					await library.deleteEntry(book.id, initial.id);
					goBack(at({}));
				}}
				onBack={closeEntry}
			/>
		);
	} else {
		pane = <Placeholder empty={total === 0} onNew={startNew} />;
	}

	const sidebar = (
		<Sidebar
			unlocked={!!content}
			categories={categories}
			counts={counts}
			total={total}
			activeCategory={activeCategory}
			onCategory={(id) => {
				go({ entry: route.entry, cat: id ?? undefined }, { replace: true });
				setDrawer(false);
			}}
			onAddCategory={(name) => {
				let made = "";
				void library.updateContent(book.id, (c) => {
					const r = ensureCategory(c, name);
					made = r.id;
					return r.content;
				}).then(() => made && go({ entry: route.entry, cat: made }, { replace: true }));
			}}
			onRenameCategory={(id, name) => void library.updateContent(book.id, (c) => renameCategory(c, id, name))}
			onDeleteCategory={(id) => void library.updateContent(book.id, (c) => deleteCategory(c, id))}
			onSelectBook={switchBook}
			onNewBook={() => {
				setDrawer(false);
				go({ entry: route.entry, dialog: "newbook" });
			}}
			onBookSettings={() => {
				setDrawer(false);
				go({ entry: route.entry, settings: "book" });
			}}
			onAllBooks={() => guard(() => navigate({}))}
			onSettings={() => {
				setDrawer(false);
				go({ entry: route.entry, settings: open ? "book" : "general" });
			}}
			onSync={() => {
				setDrawer(false);
				go({ entry: route.entry, settings: "account" });
			}}
			onLock={
				library.hasPasswordBooks
					? () =>
							guard(() => {
								library.lockAll();
								setDrawer(false);
								if (hasPassword(book)) go({}, { replace: true });
							})
					: undefined
			}
		/>
	);

	const menuButton = (
		<span className="pm-only-narrow">
			<IconButton label={t("nav.menu")} onClick={() => setDrawer(true)}>
				<Menu />
			</IconButton>
		</span>
	);

	// Title of the list: the category, or "All" (on narrow screens the book's
	// name, since the sidebar with the book switcher is hidden there).
	const listHeader = (
		<div className="pm-listhead">
			<div className="pm-listhead-bar">
				{menuButton}
				{/* no title here: the sidebar shows the book and the category */}
				<div className="pm-listhead-search">
					<SearchBox query={query} onQuery={setQuery} />
				</div>
				{!phone && (
					<div className="pm-listhead-end">
						<Button size="sm" icon={<Plus />} onClick={startNew}>
							{t("main.new")}
						</Button>
					</div>
				)}
			</div>
		</div>
	);

	let body: React.ReactNode;
	if (!content) {
		body = (
			<section className="pm-locked">
				<div className="pm-listhead-bar">
					{menuButton}
				</div>
				<LockedPanel key={book.id} book={book} autoLocked={autoLocked} onRecovered={setMustReset} />
			</section>
		);
	} else if (tableMode) {
		body = (
			<>
				<section className="pm-listcol is-table">
					{listHeader}
					<div className="pm-listbody is-table">
						<EntryTable
							entries={entries}
							total={total}
							categories={categories}
							showCategory={!activeCategory}
							fieldColumns={fieldColumns}
							selectedId={selectedId}
							onSelect={openEntry}
						/>
					</div>
					<ListFooter total={entries.length} saveFailed={saveFailed} />
				</section>
				<AnimatePresence initial={false}>
					{showPane && (
						<motion.aside
							key="detail"
							className="pm-detail"
							initial={{ width: 0 }}
							animate={{ width: detailWidth }}
							exit={{ width: 0 }}
							transition={{ type: "spring", stiffness: 380, damping: 40 }}
						>
							<div className="pm-pane" style={{ width: detailWidth }}>
								{pane}
							</div>
						</motion.aside>
					)}
				</AnimatePresence>
			</>
		);
	} else {
		body = (
			<>
				<section className={cn("pm-listcol", showPane && "is-behind")}>
					{listHeader}
					<div className="pm-listbody">
						<EntryList entries={entries} total={total} selectedId={selectedId} onSelect={openEntry} />
					</div>
					{/* phones: no footer (it only returns to warn that saving failed) */}
					{(!phone || saveFailed) && <ListFooter total={entries.length} saveFailed={saveFailed} />}
				</section>
				<main className={cn("pm-pane", !showPane && "is-idle")}>{pane}</main>
			</>
		);
	}

	return (
		<div className="pm-main">
			<aside className="pm-side">{sidebar}</aside>
			{drawer && !wide && (
				<div className="pm-drawer">
					<div className="pm-drawer-scrim" onClick={() => setDrawer(false)} aria-hidden />
					<aside className="pm-side">{sidebar}</aside>
				</div>
			)}
			{body}

			{phone && content && !showPane && <Fab icon={<Plus />} label={t("main.new")} onClick={startNew} />}

			<SettingsDialog
				open={!!settings && !closing}
				tab={shownSettings ?? "book"}
				onTab={(tab) => go({ entry: route.entry, settings: tab }, { replace: true })}
				book={book}
				opened={open}
				onClose={closeOverlay}
				// deleted or left: back to the picker (not into some other book)
				onBookGone={() => navigate({}, { replace: true })}
				onImported={(id) => switchBook(id, { replace: true })}
			/>
			<Dialog open={newBook && !closing} title={t("book.new")} onClose={closeOverlay} wide phone="full">
				<NewBookWizard
					inDialog
					defaultName=""
					onDone={(id) => switchBook(id, { replace: true })}
					onCancel={closeOverlay}
				/>
			</Dialog>
			<ConfirmDialog
				open={!!pendingNav}
				title={t("entry.discardTitle")}
				body={t("entry.discardBody")}
				confirmLabel={t("entry.discard")}
				cancelLabel={t("entry.keepEditing")}
				onCancel={() => setPendingNav(null)}
				onConfirm={() => {
					dirty.current = false;
					setSaves(0);
					pendingNav?.();
					setPendingNav(null);
				}}
			/>
			{mustReset && <NewPasswordDialog bookId={mustReset} onDone={() => setMustReset(null)} />}
		</div>
	);
}

function Placeholder({ empty, onNew }: { empty: boolean; onNew: () => void }) {
	const { t } = usePrefs();
	return (
		<Pane>
			<div className="pm-placeholder">
				<span className={cn(!empty && "pm-dim")} style={empty ? undefined : { opacity: 0.35, filter: "grayscale(0.4)" }}>
					<Logo size={80} />
				</span>
				{empty ? (
					<>
						<h2 className="pm-title">{t("main.emptyTitle")}</h2>
						<p className="pm-muted">{t("main.emptyBody")}</p>
						<Button icon={<Plus />} onClick={onNew} style={{ marginTop: 12 }}>
							{t("main.new")}
						</Button>
					</>
				) : (
					<p className="pm-muted">{t("main.pick")}</p>
				)}
			</div>
		</Pane>
	);
}
