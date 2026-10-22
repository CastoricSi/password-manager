import { Folder, Inbox, Lock, MoreHorizontal, Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { useState } from "react";
import { IconButton, Input, Menu, NavItem } from "sityle";

import { useT } from "@/app/prefs";
import type { Category } from "@/lib/content";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Logo } from "@/ui/Logo";
import { BookSwitcher } from "./BookSwitcher";
import { SyncBadge } from "./SyncBadge";

/**
 * Left column, like most password managers: the book at the top, then "All"
 * and the categories (created, renamed and deleted right here), and the app's
 * own actions — sync status, settings, lock — at the bottom.
 */
export function Sidebar({
	unlocked,
	categories,
	counts,
	total,
	activeCategory,
	onCategory,
	onAddCategory,
	onRenameCategory,
	onDeleteCategory,
	onSelectBook,
	onNewBook,
	onBookSettings,
	onAllBooks,
	onSettings,
	onSync,
	onLock,
}: {
	unlocked: boolean;
	categories: Category[];
	counts: Map<string | null, number>;
	total: number;
	activeCategory: string | null;
	onCategory: (id: string | null) => void;
	onAddCategory: (name: string) => void;
	onRenameCategory: (id: string, name: string) => void;
	onDeleteCategory: (id: string) => void;
	onSelectBook: (id: string) => void;
	onNewBook: () => void;
	onBookSettings: () => void;
	onAllBooks: () => void;
	onSettings: () => void;
	onSync: () => void;
	onLock?: () => void;
}) {
	const t = useT();
	const [adding, setAdding] = useState(false);

	return (
		<nav aria-label={t("nav.categories")} className="pm-nav">
			<div className="pm-nav-brand">
				<Logo size={28} />
				<span className="pm-grow pm-truncate">{t("app.name")}</span>
				<SyncBadge onClick={onSync} />
				{onLock && (
					<IconButton label={t("main.lock")} onClick={onLock}>
						<Lock />
					</IconButton>
				)}
			</div>
			<BookSwitcher onSelect={onSelectBook} onNewBook={onNewBook} onBookSettings={onBookSettings} onAllBooks={onAllBooks} />

			<div className="pm-nav-scroll">
				{unlocked ? (
					<>
						<NavItem icon={<Inbox />} label={t("category.all")} count={total} current={activeCategory === null} onClick={() => onCategory(null)} />

						<div className="pm-nav-section">
							<span className="pm-label">{t("nav.categories")}</span>
							<IconButton label={t("category.add")} onClick={() => setAdding(true)} style={{ width: 30, height: 30 }}>
								<Plus />
							</IconButton>
						</div>
						<ul className="pm-stack" style={{ gap: 2, margin: 0, padding: 0 }}>
							{categories.map((c) => (
								<CategoryItem
									key={c.id}
									category={c}
									count={counts.get(c.id) ?? 0}
									active={activeCategory === c.id}
									onSelect={() => onCategory(c.id)}
									onRename={(name) => onRenameCategory(c.id, name)}
									onDelete={() => onDeleteCategory(c.id)}
								/>
							))}
							{adding && (
								<li className="pm-cat">
									<NameInput
										initial=""
										placeholder={t("category.newName")}
										onDone={(name) => {
											setAdding(false);
											if (name) onAddCategory(name);
										}}
									/>
								</li>
							)}
						</ul>
						{categories.length === 0 && !adding && (
							<NavItem icon={<Plus />} label={t("category.add")} onClick={() => setAdding(true)} />
						)}
					</>
				) : (
					<p className="pm-faint pm-row" style={{ padding: "4px 12px" }}>
						<Lock size={14} />
						{t("book.statusLocked")}
					</p>
				)}
			</div>

			<div className="pm-nav-foot">
				<NavItem icon={<Settings />} label={t("main.settings")} onClick={onSettings} />
			</div>
		</nav>
	);
}

function CategoryItem({
	category,
	count,
	active,
	onSelect,
	onRename,
	onDelete,
}: {
	category: Category;
	count: number;
	active: boolean;
	onSelect: () => void;
	onRename: (name: string) => void;
	onDelete: () => void;
}) {
	const t = useT();
	const [renaming, setRenaming] = useState(false);
	const [confirm, setConfirm] = useState(false);

	if (renaming) {
		return (
			<li className="pm-cat">
				<NameInput
					initial={category.name}
					placeholder={t("category.newName")}
					onDone={(name) => {
						setRenaming(false);
						if (name && name !== category.name) onRename(name);
					}}
				/>
			</li>
		);
	}

	return (
		<li className="pm-cat">
			<NavItem icon={<Folder />} label={category.name} count={count} current={active} onClick={onSelect} />
			<span className="pm-cat-more">
				<Menu
					align="end"
					trigger={(p) => (
						<IconButton label={`${t("category.more")}: ${category.name}`} {...p}>
							<MoreHorizontal />
						</IconButton>
					)}
					items={[
						{ label: t("category.rename"), icon: <Pencil />, onSelect: () => setRenaming(true) },
						{ label: t("common.delete"), icon: <Trash2 />, danger: true, onSelect: () => setConfirm(true) },
					]}
				/>
			</span>
			<ConfirmDialog
				open={confirm}
				title={t("category.deleteTitle", { name: category.name })}
				seal="删"
				body={t("category.deleteBody")}
				confirmLabel={t("common.delete")}
				onCancel={() => setConfirm(false)}
				onConfirm={() => {
					setConfirm(false);
					onDelete();
				}}
			/>
		</li>
	);
}

/** Inline name box: Enter or clicking away saves, Escape cancels (an empty name = cancel). */
function NameInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (name: string) => void }) {
	const [value, setValue] = useState(initial);
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				onDone(value.trim());
			}}
		>
			<Input
				autoFocus
				value={value}
				placeholder={placeholder}
				aria-label={placeholder}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => e.key === "Escape" && onDone("")}
				onBlur={() => onDone(value.trim() === initial ? "" : value.trim())}
				style={{ height: 38 }}
			/>
		</form>
	);
}
