import { RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, ConfirmDialog, IconButton } from "sityle";

import { usePrefs } from "@/app/prefs";
import { trashDaysLeft, trashed, type BookContent } from "@/lib/content";
import { EntryAvatar } from "@/ui/Logo";
import { useLast } from "@/ui/useLast";

/**
 * The book's recycle bin: deleted entries for 30 days, newest first. Restore
 * puts one back where it was; deleting for good (one, or all) asks first.
 */
export function TrashView({
	content,
	menuButton,
	onRestore,
	onPurge,
}: {
	content: BookContent;
	/** ☰ on narrow screens (the sidebar is a drawer there). */
	menuButton: React.ReactNode;
	onRestore: (entryId: string) => void;
	/** Deletes for good: these entries, or all without ids. */
	onPurge: (entryIds?: string[]) => void;
}) {
	const { t, lang } = usePrefs();
	const items = useMemo(() => trashed(content), [content]);
	const [confirm, setConfirm] = useState<{ id: string; name: string } | "all" | null>(null);
	// kept while the dialog plays its closing animation
	const asked = useLast(confirm);
	const date = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", { dateStyle: "medium" });

	return (
		<>
			<div className="pm-listhead">
				<div className="pm-listhead-bar">
					{menuButton}
					<h2 className="pm-title pm-grow">{t("trash.title")}</h2>
					{items.length > 0 && (
						<Button size="sm" variant="light" tone="danger" onClick={() => setConfirm("all")}>
							{t("trash.purgeAll")}
						</Button>
					)}
				</div>
			</div>
			<div className="pm-listbody">
				<p className="pm-muted pm-trash-hint">{t("trash.hint")}</p>
				{items.length === 0 ? (
					<p className="pm-empty">{t("trash.empty")}</p>
				) : (
					<ul className="pm-trash">
						{items.map(({ entry, deletedAt }) => (
							<li key={entry.id} className="pm-trash-row">
								<EntryAvatar name={entry.name} />
								<div className="pm-grow pm-trash-text">
									<b className="pm-truncate">{entry.name}</b>
									<span className="pm-faint pm-truncate">
										{t("trash.deletedAt", { time: date.format(new Date(deletedAt)) })} · {t("trash.daysLeft", { n: trashDaysLeft(deletedAt) })}
									</span>
								</div>
								<Button size="sm" variant="light" icon={<RotateCcw />} onClick={() => onRestore(entry.id)}>
									{t("trash.restore")}
								</Button>
								<IconButton label={t("trash.purge")} onClick={() => setConfirm({ id: entry.id, name: entry.name })}>
									<Trash2 />
								</IconButton>
							</li>
						))}
					</ul>
				)}
			</div>

			<ConfirmDialog
				open={confirm !== null}
				seal="删"
				title={asked === "all" ? t("trash.purgeAllTitle") : t("trash.purgeTitle", { name: asked?.name ?? "" })}
				body={asked === "all" ? t("trash.purgeAllBody", { n: items.length }) : t("trash.purgeBody")}
				confirmLabel={asked === "all" ? t("trash.purgeAll") : t("trash.purge")}
				onCancel={() => setConfirm(null)}
				onConfirm={() => {
					onPurge(confirm === "all" || !confirm ? undefined : [confirm.id]);
					setConfirm(null);
				}}
			/>
		</>
	);
}
