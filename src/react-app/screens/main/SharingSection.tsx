import { UserPlus, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, Button, ConfirmDialog, Group, GroupRow, IconBadge, IconButton, InkDrop, Tag, TextField } from "sityle";

import { useLibrary, useSync } from "@/app/context";
import { usePrefs } from "@/app/prefs";
import type { ShareResult } from "@/app/syncController";
import { hasPassword, type BookFile } from "@/lib/bookfile";
import type { Person } from "@/lib/drive";
import { useLast } from "@/ui/useLast";

/**
 * Share this book with other Google users (they can edit; the password is
 * never shared). Owner: list / add / remove people. Recipient: who shared it.
 */
export function SharingSection({ book, onGoToAccount }: { book: BookFile; onGoToAccount: () => void }) {
	const { t } = usePrefs();
	const [{ records }] = useLibrary();
	const [, sync] = useSync();
	const rec = records[book.id];

	if (!sync.connected) {
		return (
			<Group plain title={t("share.title")}>
				<GroupRow title={t("share.needGoogle")} description={t("share.needGoogleHint")}>
					<Button variant="bordered" onClick={onGoToAccount}>
						{t("share.goToAccount")}
					</Button>
				</GroupRow>
			</Group>
		);
	}

	if (rec?.ownedByMe === false) {
		return (
			<Group plain title={t("share.title")}>
				<div className="si-group-row">
					<IconBadge>
						<Users />
					</IconBadge>
					<div className="si-group-text">
						<div>{t("share.sharedWithYou", { who: rec.ownerName || rec.ownerEmail || "" })}</div>
						<div className="pm-muted">{t("share.sharedWithYouHint")}</div>
					</div>
				</div>
			</Group>
		);
	}

	return <OwnerSharing book={book} />;
}

function OwnerSharing({ book }: { book: BookFile }) {
	const { t } = usePrefs();
	const [{ records }] = useLibrary();
	const [syncState, sync] = useSync();
	const [people, setPeople] = useState<Person[] | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [email, setEmail] = useState("");
	const [result, setResult] = useState<ShareResult | null>(null);
	const [busy, setBusy] = useState(false);
	const [removing, setRemoving] = useState<Person | null>(null);
	const shownRemoving = useLast(removing);
	const uploaded = !!records[book.id]?.remoteId;
	const [reload, setReload] = useState(0);
	const load = () => setReload((n) => n + 1);

	useEffect(() => {
		if (!uploaded) {
			void sync.syncNow(); // a new book: upload first, then it can be shared
			return;
		}
		let cancelled = false;
		sync
			.people(book.id)
			.then((list) => {
				if (cancelled) return;
				setPeople(list ?? []);
				setLoadFailed(false);
			})
			.catch(() => !cancelled && setLoadFailed(true));
		return () => {
			cancelled = true;
		};
	}, [uploaded, sync, book.id, reload]);

	const others = (people ?? []).filter((p) => p.role !== "owner");
	const waiting = (text: string) => (
		<p className="pm-muted pm-row" style={{ gap: 10 }}>
			<span style={{ color: "var(--si-jade)" }}>
				<InkDrop />
			</span>
			{text}
		</p>
	);

	return (
		<Group plain title={t("share.title")}>
			<div className="pm-stack" style={{ paddingTop: 2 }}>
				<p className="pm-muted">{hasPassword(book) ? t("share.explainPassword") : t("share.explainOpen")}</p>

				{!uploaded ? (
					waiting(syncState.status === "offline" ? t("sync.offlineLong") : t("share.uploading"))
				) : people === null && !loadFailed ? (
					waiting(t("common.working"))
				) : (
					<>
						{loadFailed && <p className="pm-error">{t("share.loadFailed")}</p>}
						{others.length > 0 && (
							<ul className="pm-stack is-tight" style={{ margin: 0, padding: 0, listStyle: "none" }}>
								{others.map((p) => (
									<li key={p.permissionId} className="pm-row is-nowrap">
										<Avatar name={p.name || p.email} size={32} tone="azure" decorative />
										<span className="pm-two-line">
											<span>{p.name || p.email}</span>
											{p.name && <small>{p.email}</small>}
										</span>
										<Tag tone="jade">{t("share.canEdit")}</Tag>
										<IconButton label={`${t("share.remove")} ${p.email}`} onClick={() => setRemoving(p)}>
											<X />
										</IconButton>
									</li>
								))}
							</ul>
						)}
						<form
							className="pm-row"
							style={{ alignItems: "flex-start" }}
							onSubmit={async (e) => {
								e.preventDefault();
								if (!email.trim()) return;
								setBusy(true);
								setResult(null);
								const r = await sync.share(book.id, email);
								setResult(r);
								setBusy(false);
								if (r === "ok") {
									setEmail("");
									load();
								}
							}}
						>
							<TextField
								className="pm-grow"
								type="email"
								label={t("share.emailPlaceholder")}
								value={email}
								error={result === "invalid" ? t("share.invalid") : result === "failed" || result === "notUploaded" ? t("share.failed") : undefined}
								hint={result === "ok" ? t("share.done") : undefined}
								onChange={(e) => {
									setEmail(e.target.value);
									setResult(null);
								}}
								style={{ minWidth: 200 }}
							/>
							<Button type="submit" icon={<UserPlus />} loading={busy} disabled={!email.trim()} style={{ marginTop: 8 }}>
								{t("share.share")}
							</Button>
						</form>
					</>
				)}
			</div>

			<ConfirmDialog
				open={!!removing}
				title={t("share.removeTitle", { who: shownRemoving?.name || shownRemoving?.email || "" })}
				body={t("share.removeBody")}
				confirmLabel={t("share.remove")}
				onCancel={() => setRemoving(null)}
				onConfirm={async () => {
					const p = removing;
					setRemoving(null);
					if (p) await sync.unshare(book.id, p);
					load();
				}}
			/>
		</Group>
	);
}
