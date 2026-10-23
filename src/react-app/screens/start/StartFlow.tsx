import { ArrowLeft, BookOpen, Cloud, HardDrive, Lock, LogOut, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button, ConfirmDialog, IconBadge, IconButton, InkDrop, ListItem } from "sityle";
import { cn } from "@/ui/cn";

import { useLibrary, useSync } from "@/app/context";
import { useT } from "@/app/prefs";
import { goBack, navigate, type Route } from "@/app/nav";
import { hasPassword, type BookFile } from "@/lib/bookfile";
import { AuthLayout, Brand } from "../AuthLayout";
import { NewBookWizard } from "../NewBookWizard";
import { NewPasswordForm } from "../NewPasswordForm";
import { UnlockForm } from "../UnlockForm";
import { ShareNotices } from "./ShareNotices";

const ORDER = { mode: 0, books: 1, new: 2, unlock: 2, recovered: 3 } as const;

type Step = { kind: "mode" } | { kind: "books" } | { kind: "new" } | { kind: "unlock"; id: string } | { kind: "recovered"; id: string };

/**
 * Before the main screen, step by step:
 *   1. where to keep books: this device, or a Google account (until chosen once)
 *   2. which book — with none yet, an empty picker: create one, or (with Google)
 *      add one someone shared; nobody is pushed into making a book of their own
 *   3. its main password, if it has one
 */
export function StartFlow({
	route,
	unlockBook,
	recovering,
	onUnlocked,
	onRecoveredDone,
}: {
	route: Route;
	/** A password book named by the URL, to unlock here. */
	unlockBook?: BookFile;
	/** Opened with its recovery question: a new password comes first. */
	recovering?: string | null;
	onUnlocked: (bookId: string, viaRecovery: boolean) => void;
	onRecoveredDone: (bookId: string) => void;
}) {
	const [syncState] = useSync();
	const [{ books }, library] = useLibrary();
	const waitingForCloud = syncState.mode === "google" && !syncState.firstSyncDone && books.length === 0;
	// Never chosen where books live: that comes first.
	const fresh = books.length === 0 && !waitingForCloud && syncState.mode === null;

	// The step follows the URL.
	const step: Step = recovering
		? { kind: "recovered", id: recovering }
		: unlockBook
			? { kind: "unlock", id: unlockBook.id }
			: route.start === "mode" || (fresh && !route.start)
				? { kind: "mode" }
				: route.start === "new"
					? { kind: "new" }
					: { kind: "books" };

	// +1 = forward (the new step comes from the right), -1 = back (from the left)
	const [shownKind, setShownKind] = useState(step.kind);
	const [dir, setDir] = useState(1);
	if (shownKind !== step.kind) {
		setDir(ORDER[step.kind] >= ORDER[shownKind] ? 1 : -1);
		setShownKind(step.kind);
	}

	const open = (b: BookFile) => navigate({ book: b.id });
	// Chosen: on to the picker (Google's books arrive there; with none, it offers new / shared).
	const fromMode = () => {
		if (route.start === "mode") goBack({});
		else navigate({}, { replace: true });
	};

	let key: string = step.kind;
	let content: React.ReactNode;
	if (step.kind === "mode") {
		content = (
			<>
				<Brand />
				<ModeStep onChosen={fromMode} />
			</>
		);
	} else if (step.kind === "unlock" && unlockBook) {
		const b = unlockBook;
		content = (
			<div className="pm-stack is-loose">
				<BackLink onClick={() => goBack({})} />
				<div className="pm-row is-nowrap">
					<IconBadge>
						<Lock />
					</IconBadge>
					<h2 className="pm-title pm-grow">{b.name}</h2>
				</div>
				<UnlockForm book={b} onUnlocked={(viaRecovery) => onUnlocked(b.id, viaRecovery)} />
			</div>
		);
	} else if (step.kind === "recovered") {
		content = <NewPasswordForm bookId={step.id} onDone={() => onRecoveredDone(step.id)} />;
	} else if (step.kind === "new") {
		content = (
			<NewBookWizard
				defaultName={books.length === 0 ? library.defaultName : ""}
				onDone={(id) => navigate({ book: id }, { replace: true })}
				onCancel={() => (route.start === "new" ? goBack({}) : navigate({ start: "mode" }))}
			/>
		);
	} else {
		key = "books";
		content = (
			<>
				<Brand />
				<BooksStep waiting={waitingForCloud} onOpen={open} onNew={() => navigate({ start: "new" })} onSwitchMode={() => navigate({ start: "mode" })} />
			</>
		);
	}

	return (
		<AuthLayout>
			<AnimatePresence mode="popLayout" initial={false} custom={dir}>
				<motion.div
					key={key}
					className={cn("pm-auth-step", `is-${key}`)}
					custom={dir}
					variants={slide}
					initial="enter"
					animate="center"
					exit="exit"
					transition={{ x: { type: "spring", stiffness: 420, damping: 42 }, opacity: { duration: 0.2 } }}
				>
					{content}
				</motion.div>
			</AnimatePresence>
		</AuthLayout>
	);
}

/** Steps slide sideways: forward = in from the right, back = in from the left. */
const slide = {
	enter: (d: number) => ({ x: d > 0 ? "60%" : "-60%", opacity: 0 }),
	center: { x: 0, opacity: 1 },
	exit: (d: number) => ({ x: d > 0 ? "-60%" : "60%", opacity: 0 }),
};

function BackLink({ onClick }: { onClick: () => void }) {
	const t = useT();
	return (
		<div>
			<Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onClick} style={{ marginLeft: -8 }}>
				{t("common.back")}
			</Button>
		</div>
	);
}

/** Step 1: this device, or a Google account. */
function ModeStep({ onChosen }: { onChosen: () => void }) {
	const t = useT();
	const [syncState, sync] = useSync();
	const [connecting, setConnecting] = useState(false);
	const [failed, setFailed] = useState(false);
	const unavailable = syncState.status === "unavailable";

	return (
		<>
			<div className="pm-stack is-loose">
				<div className="pm-stack is-tight">
					<h2 className="pm-title">{t("start.title")}</h2>
					<p className="pm-muted">{t("start.subtitle")}</p>
				</div>
				<div className="pm-list">
					<ListItem
						leading={
							<IconBadge>
								<HardDrive />
							</IconBadge>
						}
						title={t("start.local")}
						description={t("start.localHint")}
						onClick={() => {
							sync.useLocal();
							onChosen();
						}}
					/>
					<ListItem
						leading={<IconBadge>{connecting ? <InkDrop /> : <Cloud />}</IconBadge>}
						title={t("start.google")}
						description={unavailable ? t("sync.unavailable") : t("start.googleHint")}
						onClick={
							connecting || unavailable
								? undefined
								: async () => {
										setConnecting(true);
										const ok = await sync.connect();
										setConnecting(false);
										setFailed(!ok);
										if (ok) onChosen();
									}
						}
					/>
				</div>
				{failed && <p className="pm-error">{t("sync.connectFailed")}</p>}
			</div>
		</>
	);
}

/** Step 2: pick a book (last used first), accept shares, or create one. */
function BooksStep({ waiting, onOpen, onNew, onSwitchMode }: { waiting: boolean; onOpen: (b: BookFile) => void; onNew: () => void; onSwitchMode: () => void }) {
	const t = useT();
	const [{ books, opened, currentId, records }] = useLibrary();
	const [syncState, sync] = useSync();
	const ordered = [...books].sort((a, b) => (a.id === currentId ? -1 : b.id === currentId ? 1 : 0));
	const google = syncState.mode === "google" && sync.connected;
	const [removing, setRemoving] = useState<Removing>(null);

	const status = (b: BookFile) => {
		const base = hasPassword(b) ? (opened[b.id] ? t("book.statusUnlocked") : t("start.needsPassword")) : t("book.statusOpen");
		const rec = records[b.id];
		const sharedFrom = rec?.ownedByMe === false ? rec.ownerName || rec.ownerEmail : null;
		return sharedFrom ? (
			<>
				{base} · <Users size={11} style={{ verticalAlign: -1 }} /> {t("share.from", { who: sharedFrom })}
			</>
		) : (
			base
		);
	};

	return (
		<>
			<div className="pm-books">
				<div className="pm-row is-nowrap" style={{ alignItems: "flex-start" }}>
					<div className="pm-grow pm-stack is-tight">
						<h2 className="pm-title">{t("start.pickTitle")}</h2>
						<p className="pm-muted pm-row is-nowrap" style={{ gap: 6 }}>
							{google ? <Cloud size={14} /> : <HardDrive size={14} />}
							<span className="pm-truncate">{google ? t("start.inGoogle", { email: syncState.email ?? "" }) : t("start.onDevice")}</span>
							{syncState.status === "syncing" && <InkDrop />}
						</p>
					</div>
					{syncState.status !== "unavailable" && (
						<Button variant="ghost" size="sm" onClick={onSwitchMode}>
							{t("start.switch")}
						</Button>
					)}
				</div>

				{google && <ShareNotices />}

				{waiting ? (
					<p className="pm-muted pm-row is-center" style={{ padding: "28px 0", color: "var(--si-jade)" }}>
						<InkDrop />
						<span style={{ color: "var(--si-ink-2)" }}>{t("start.loadingCloud")}</span>
					</p>
				) : ordered.length === 0 ? (
					<div className="pm-books-empty">
						<IconBadge>
							<BookOpen />
						</IconBadge>
						<p className="pm-label">{t("start.noBooks")}</p>
						<p className="pm-muted">{google ? t("start.noBooksHintGoogle") : t("start.noBooksHint")}</p>
					</div>
				) : (
					<div className="pm-list pm-books-list">
						{ordered.map((b) => {
							const shared = records[b.id]?.ownedByMe === false;
							return (
								<div key={b.id} className="pm-book-row">
									<ListItem
										current={b.id === currentId}
										leading={<IconBadge>{hasPassword(b) ? <Lock /> : <BookOpen />}</IconBadge>}
										title={b.name}
										description={status(b)}
										onClick={() => onOpen(b)}
									/>
									<IconButton label={shared ? t("share.leave") : t("book.delete")} onClick={() => setRemoving({ book: b, step: 1 })}>
										{shared ? <LogOut /> : <Trash2 />}
									</IconButton>
								</div>
							);
						})}
					</div>
				)}

				{/* one above the other: side by side they squeezed "New password book" */}
				<div className="pm-wizard-actions pm-actions-stack">
					<Button icon={<Plus />} onClick={onNew} className="pm-block">
						{t("book.new")}
					</Button>
					{google && syncState.canPick && (
						<Button variant="ghost" icon={<UserPlus />} onClick={() => void sync.addShared()} className="pm-block">
							{t("share.addShared")}
						</Button>
					)}
					{/* shared books come through Google: without it, the way there */}
					{!google && syncState.status !== "unavailable" && (
						<Button variant="ghost" icon={<UserPlus />} onClick={onSwitchMode} className="pm-block">
							{t("start.useShared")}
						</Button>
					)}
				</div>
			</div>
			<RemoveBook removing={removing} onStep={setRemoving} />
		</>
	);
}

type Removing = { book: BookFile; step: 1 | 2 } | null;

/**
 * Deleting from the picker asks twice: what will happen, then a last word (a
 * book only on this device is gone for good; a synced one can come back within
 * 30 days). Leaving a book someone shared asks once: the owner keeps it.
 */
function RemoveBook({ removing, onStep }: { removing: Removing; onStep: (r: Removing) => void }) {
	const t = useT();
	const [{ records }, library] = useLibrary();
	const [, sync] = useSync();
	// the book stays on screen while a dialog plays its closing animation
	const [last, setLast] = useState(removing);
	if (removing && removing !== last) setLast(removing);
	const b = (removing ?? last)?.book;
	const shared = b ? records[b.id]?.ownedByMe === false : false;
	const synced = sync.connected;
	const step = removing?.step ?? 0;
	const close = () => onStep(null);
	return (
		<>
			<ConfirmDialog
				open={step === 1 && shared}
				title={t("share.leaveTitle", { name: b?.name ?? "" })}
				body={t("share.leaveHint")}
				confirmLabel={t("share.leave")}
				onCancel={close}
				onConfirm={() => {
					close();
					if (b) void sync.leave(b.id);
				}}
			/>
			<ConfirmDialog
				open={step === 1 && !shared}
				seal="删"
				title={t("book.deleteTitle", { name: b?.name ?? "" })}
				body={synced ? t("book.deleteSyncedHint") : t("book.deleteHint")}
				confirmLabel={t("book.deleteContinue")}
				onCancel={close}
				onConfirm={() => b && onStep({ book: b, step: 2 })}
			/>
			<ConfirmDialog
				open={step === 2}
				seal="删"
				title={t("book.deleteFinalTitle", { name: b?.name ?? "" })}
				body={synced ? t("book.deleteFinalSynced") : t("book.deleteFinalLocal")}
				confirmLabel={t("book.deleteFinal")}
				onCancel={close}
				onConfirm={() => {
					close();
					if (b) void library.deleteBook(b.id);
				}}
			/>
		</>
	);
}
