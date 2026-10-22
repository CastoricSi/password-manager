import { ShieldCheck, TriangleAlert } from "lucide-react";

import { ListItem, SearchField } from "sityle";

import { useT } from "@/app/prefs";
import type { Entry } from "@/lib/content";
import { EntryAvatar } from "@/ui/Logo";

/** Search box at the top of the list (sityle's SearchField). */
export function SearchBox({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
	const t = useT();
	return <SearchField value={query} onChange={onQuery} label={t("main.search")} clearLabel={t("common.cancel")} />;
}

/** "46 items · Saved on this device". */
export function ListFooter({ total, saveFailed }: { total: number; saveFailed: boolean }) {
	const t = useT();
	return (
		<div className="pm-listfoot">
			<span>{total > 0 ? t("main.count", { n: total }) : ""}</span>
			{saveFailed ? (
				<span style={{ color: "var(--si-cinnabar-text)" }}>
					<TriangleAlert />
					{t("main.saveFailed")}
				</span>
			) : (
				<span>
					<ShieldCheck />
					{t("main.savedLocal")}
				</span>
			)}
		</div>
	);
}

/** The list (sityle ListItems; details open on the right / next page). */
export function EntryList({
	entries,
	total,
	selectedId,
	onSelect,
}: {
	entries: Entry[];
	total: number;
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	const t = useT();
	if (total === 0)
		return (
			<div className="pm-empty pm-only-phone">
				<p style={{ fontWeight: 500 }}>{t("main.emptyTitle")}</p>
				<p className="pm-muted">{t("main.emptyBody")}</p>
			</div>
		);
	if (entries.length === 0) return <p className="pm-empty">{t("main.noMatch")}</p>;
	return (
		<div className="pm-stack" style={{ gap: 2 }}>
			{entries.map((e) => (
				<ListItem key={e.id} current={e.id === selectedId} leading={<EntryAvatar name={e.name} />} title={e.name} description={e.username || undefined} onClick={() => onSelect(e.id)} />
			))}
		</div>
	);
}
