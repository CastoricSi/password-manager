import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { useT } from "@/app/prefs";
import { toHref, type Category, type Entry } from "@/lib/content";
import { cn } from "@/ui/cn";

import { CopyIcon } from "@/ui/CopyIcon";
import { EntryAvatar } from "@/ui/Logo";
import { PinnedName } from "./EntryList";

const DOTS = "••••••••";

/**
 * Several entries at once (wide screens). Every cell can be copied in place;
 * passwords and hidden fields stay masked until shown per row. Clicking a
 * name opens the entry in the side panel.
 */
export function EntryTable({
	entries,
	total,
	categories,
	showCategory,
	fieldColumns,
	selectedId,
	onSelect,
}: {
	entries: Entry[];
	total: number;
	categories: Category[];
	/** Category column (when the book uses categories and no filter is set). */
	showCategory: boolean;
	/** Custom field labels to show as columns (when filtered to a category). */
	fieldColumns: string[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	const t = useT();
	const [revealed, setRevealed] = useState<Set<string>>(new Set());
	const toggle = (id: string) =>
		setRevealed((s) => {
			const next = new Set(s);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	if (total === 0) return <p className="pm-empty">{t("main.emptyBody")}</p>;
	if (entries.length === 0) return <p className="pm-empty">{t("main.noMatch")}</p>;

	const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "";
	const none = <span className="pm-faint">—</span>;

	return (
		<table className="pm-table">
			<thead>
				<tr>
					<th style={{ minWidth: 200 }}>{t("field.name")}</th>
					<th style={{ minWidth: 170 }}>{t("field.username")}</th>
					<th style={{ minWidth: 170 }}>{t("field.password")}</th>
					<th style={{ minWidth: 150 }}>{t("field.url")}</th>
					{showCategory && <th style={{ minWidth: 96 }}>{t("field.category")}</th>}
					{fieldColumns.map((label) => (
						<th key={label} style={{ minWidth: 140 }}>
							{label}
						</th>
					))}
					<th style={{ minWidth: 190 }}>{t("field.notes")}</th>
				</tr>
			</thead>
			<tbody>
				{entries.map((e) => {
					const show = revealed.has(e.id);
					return (
						<tr
							key={e.id}
							aria-selected={e.id === selectedId}
							onClick={(ev) => {
								if (!(ev.target as HTMLElement).closest("button, a")) onSelect(e.id);
							}}
						>
							<td>
								<button type="button" className="pm-table-name" onClick={() => onSelect(e.id)}>
									<EntryAvatar name={e.name} size={28} />
									<span className="pm-truncate">{e.pinned ? <PinnedName name={e.name} /> : e.name}</span>
								</button>
							</td>
							<td>
								<Cell value={e.username} label={t("field.username")} />
							</td>
							<td>
								<div className="pm-cell">
									<span className={cn("pm-cell-text", e.password && "is-mono")}>{e.password ? (show ? e.password : DOTS) : none}</span>
									{e.password && (
										<button
											type="button"
											className="pm-cell-action"
											onClick={() => toggle(e.id)}
											title={show ? t("common.hide") : t("common.show")}
											aria-label={`${show ? t("common.hide") : t("common.show")} ${t("field.password")}`}
										>
											{show ? <EyeOff /> : <Eye />}
										</button>
									)}
									<CopyIcon value={e.password} label={t("field.password")} />
								</div>
							</td>
							<td>
								<UrlCell url={e.url} />
							</td>
							{showCategory && <td className="pm-muted">{catName(e.categoryId)}</td>}
							{fieldColumns.map((label) => {
								const f = e.fields.find((x) => x.label === label);
								return (
									<td key={label}>
										{f?.secret ? (
											<div className="pm-cell">
												<span className="pm-cell-text is-mono">{f.value ? (show ? f.value : DOTS) : none}</span>
												<CopyIcon value={f.value} label={label} />
											</div>
										) : (
											<Cell value={f?.value ?? ""} label={label} />
										)}
									</td>
								);
							})}
							<td>
								<Cell value={e.notes.replace(/\s+/g, " ")} copyValue={e.notes} label={t("field.notes")} muted />
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

function Cell({ value, copyValue, label, muted }: { value: string; copyValue?: string; label: string; muted?: boolean }) {
	return (
		<div className="pm-cell">
			<span title={value || undefined} className={cn("pm-cell-text", muted && "pm-muted")}>
				{value || <span className="pm-faint">—</span>}
			</span>
			<CopyIcon value={copyValue ?? value} label={label} />
		</div>
	);
}

function UrlCell({ url }: { url: string }) {
	const href = toHref(url);
	if (!url) return <span className="pm-faint">—</span>;
	return href ? (
		<a href={href} target="_blank" rel="noopener noreferrer" title={href} className="pm-cell-text pm-link">
			{url}
		</a>
	) : (
		<span className="pm-cell-text">{url}</span>
	);
}
