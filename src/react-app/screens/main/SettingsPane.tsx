import { ChevronDown, Cloud, LayoutList, LogOut, RefreshCw, Table2, Undo2, Upload, UserPlus } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Button, ConfirmDialog, Dialog, Group, GroupRow, IconBadge, Segmented, SelectField, Tabs } from "sityle";

import { useLibrary, useSync } from "@/app/context";
import type { MessageKey } from "@/app/i18n";
import { AUTO_LOCK_CHOICES, usePrefs } from "@/app/prefs";
import type { BookFile, Opened } from "@/lib/bookfile";
import { useMediaQuery } from "@/ui/useMediaQuery";
import { RestoreButton } from "../RestoreButton";
import { ShareNotices } from "../start/ShareNotices";
import { BookTab } from "./BookTab";
import { SyncStatusText } from "./SyncBadge";

export type { SettingsTab } from "@/app/nav";
import type { SettingsTab } from "@/app/nav";

const TABS: Array<{ id: SettingsTab; label: MessageKey }> = [
	{ id: "book", label: "tabs.book" },
	{ id: "general", label: "tabs.general" },
	{ id: "account", label: "tabs.account" },
	{ id: "help", label: "tabs.help" },
];

/** Settings: a sityle dialog over the app with tabs — this book, general, account & sync, help. */
export function SettingsDialog({
	open,
	tab,
	onTab,
	book,
	opened,
	onClose,
	onBookGone,
	onImported,
}: {
	open: boolean;
	tab: SettingsTab;
	onTab: (tab: SettingsTab) => void;
	book: BookFile;
	opened: Opened | undefined;
	onClose: () => void;
	onBookGone: () => void;
	onImported: (id: string) => void;
}) {
	const { t } = usePrefs();
	return (
		<Dialog open={open} wide phone="full" title={t("settings.title")} onClose={onClose} actions={<Button onClick={onClose}>{t("common.close")}</Button>}>
			<div className="pm-settings">
				<Tabs<SettingsTab> label={t("settings.title")} value={tab} onChange={onTab} options={TABS.map((x) => ({ value: x.id, label: x.id === "book" ? book.name : t(x.label) }))} />
				<motion.div key={tab} role="tabpanel" className="pm-stack is-loose pm-settings-panel" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
					{tab === "book" &&
						(opened ? (
							<BookTab key={book.id} book={book} opened={opened} onGone={onBookGone} onGoToAccount={() => onTab("account")} />
						) : (
							<p className="pm-muted">{t("tabs.bookLocked")}</p>
						))}
					{tab === "general" && <GeneralTab onImported={onImported} />}
					{tab === "account" && <AccountTab />}
					{tab === "help" && <HelpTab />}
				</motion.div>
			</div>
		</Dialog>
	);
}

function GeneralTab({ onImported }: { onImported: (id: string) => void }) {
	const { t, theme, fontSize, lang, autoLock, layout, set } = usePrefs();
	const [, library] = useLibrary();
	const [confirmErase, setConfirmErase] = useState(false);

	return (
		<>
			<Group plain title={t("settings.appearance")}>
				<ChoiceRow
					title={t("settings.theme")}
					value={theme}
					onChange={(v) => set("theme", v)}
					options={[
						{ value: "paper", label: t("settings.theme.paper") },
						{ value: "dark", label: t("settings.theme.dark") },
						{ value: "system", label: t("settings.theme.system") },
					]}
				/>
				<GroupRow title={t("settings.fontSize")}>
					<Segmented
						label={t("settings.fontSize")}
						value={fontSize}
						onChange={(v) => set("fontSize", v)}
						options={[
							{ value: "normal", label: t("settings.font.normal") },
							{ value: "large", label: t("settings.font.large") },
						]}
					/>
				</GroupRow>
				<GroupRow title={t("layout.label")} description={t("layout.hint")}>
					<Segmented<"list" | "table">
						label={t("layout.label")}
						value={layout}
						onChange={(v) => set("layout", v)}
						options={[
							{ value: "list", icon: <LayoutList size={15} />, label: t("layout.list") },
							{ value: "table", icon: <Table2 size={15} />, label: t("layout.table") },
						]}
					/>
				</GroupRow>
				<GroupRow title={t("settings.language")}>
					<Segmented
						label={t("settings.language")}
						value={lang}
						onChange={(v) => set("lang", v)}
						options={[
							{ value: "zh", label: "中文" },
							{ value: "en", label: "English" },
						]}
					/>
				</GroupRow>
			</Group>

			<Group plain title={t("settings.security")}>
				<ChoiceRow
					title={t("settings.autoLock")}
					hint={t("settings.autoLockHint")}
					value={String(autoLock)}
					onChange={(v) => set("autoLock", Number(v) as (typeof AUTO_LOCK_CHOICES)[number])}
					options={AUTO_LOCK_CHOICES.map((n) => ({ value: String(n), label: n === 0 ? t("settings.autoLock.never") : t("settings.autoLock.min", { n }) }))}
				/>
			</Group>

			<Group plain title={t("settings.backup")}>
				<GroupRow title={t("settings.import")} description={t("settings.importHint")}>
					<RestoreButton icon={<Upload />} onImported={onImported}>
						{t("settings.import")}
					</RestoreButton>
				</GroupRow>
			</Group>

			<Group plain title={t("settings.danger")}>
				<GroupRow title={t("settings.reset")} description={t("settings.resetHint")}>
					<Button variant="light" tone="danger" onClick={() => setConfirmErase(true)}>
						{t("settings.reset")}
					</Button>
				</GroupRow>
			</Group>

			<ConfirmDialog
				open={confirmErase}
				title={t("reset.title")}
				seal="删"
				body={t("reset.body")}
				confirmLabel={t("reset.confirm")}
				onCancel={() => setConfirmErase(false)}
				onConfirm={() => {
					setConfirmErase(false);
					void library.eraseEverything();
				}}
			/>
		</>
	);
}

/**
 * A setting with a few choices: the sliding pill, or on phones (where three or
 * more pills don't fit) a dropdown carrying the title and hint itself.
 */
function ChoiceRow<T extends string>({
	title,
	hint,
	value,
	onChange,
	options,
}: {
	title: string;
	hint?: string;
	value: T;
	onChange: (v: T) => void;
	options: Array<{ value: T; label: string }>;
}) {
	const narrow = useMediaQuery("(max-width: 600px)");
	if (narrow && options.length > 2)
		return (
			<GroupRow>
				<SelectField className="pm-grow" label={title} hint={hint} value={value} onChange={onChange} options={options} />
			</GroupRow>
		);
	return (
		<GroupRow title={title} description={hint}>
			<Segmented label={title} value={value} onChange={onChange} options={options} />
		</GroupRow>
	);
}

function AccountTab() {
	const { t, lang } = usePrefs();
	const [state, sync] = useSync();
	const [connecting, setConnecting] = useState(false);
	const [failed, setFailed] = useState(false);
	const [confirmSignOut, setConfirmSignOut] = useState(false);

	if (state.status === "unavailable") {
		return (
			<Group plain title={t("sync.title")}>
				<GroupRow title={t("sync.unavailable")} description={t("sync.unavailableHint")} />
			</Group>
		);
	}

	if (!sync.connected) {
		return (
			<Group plain title={t("sync.title")}>
				<div className="si-group-row">
					<IconBadge>
						<Cloud />
					</IconBadge>
					<div className="si-group-text">
						<div style={{ fontWeight: 500 }}>{state.mode === "google" ? t("sync.signInAgain") : t("sync.pitch")}</div>
						<div className="pm-muted">{t("sync.pitchHint")}</div>
						{failed && <div className="pm-error">{t("sync.connectFailed")}</div>}
					</div>
					<Button
						loading={connecting}
						onClick={async () => {
							setConnecting(true);
							setFailed(!(await sync.connect()));
							setConnecting(false);
						}}
					>
						{t("sync.connect")}
					</Button>
				</div>
			</Group>
		);
	}

	return (
		<>
			<Group plain title={t("sync.title")}>
				<GroupRow title={state.email ?? t("sync.connected")} description={<SyncStatusText />}>
					<Button variant="bordered" icon={<RefreshCw />} loading={state.status === "syncing"} onClick={() => void sync.syncNow()}>
						{t("sync.now")}
					</Button>
				</GroupRow>
				<GroupRow title={t("sync.alwaysOn")} description={t("sync.alwaysOnHint")} />
			</Group>

			<Group plain title={t("share.sharedWithMe")}>
				<div className="pm-stack">
					<ShareNotices />
					{state.notices.length === 0 && <p className="pm-muted">{t("share.noNotices")}</p>}
					{state.canPick && (
						<div>
							<Button variant="light" size="sm" icon={<UserPlus />} onClick={() => void sync.addShared()}>
								{t("share.addShared")}
							</Button>
						</div>
					)}
				</div>
			</Group>

			{state.recentlyDeleted.length > 0 && (
				<Group plain title={t("sync.recentlyDeleted")}>
					<p className="pm-muted">{t("sync.recentlyDeletedHint")}</p>
					{state.recentlyDeleted.map((r) => (
						<GroupRow key={r.id} title={r.name} description={new Date(r.deletedAt!).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-GB")}>
							<Button size="sm" variant="bordered" icon={<Undo2 />} onClick={() => void sync.restore(r)}>
								{t("sync.restore")}
							</Button>
						</GroupRow>
					))}
				</Group>
			)}

			<Group plain title={t("sync.account")}>
				<GroupRow title={t("sync.signOut")} description={t("sync.signOutHint")}>
					<Button variant="light" tone="danger" icon={<LogOut />} onClick={() => setConfirmSignOut(true)}>
						{t("sync.signOut")}
					</Button>
				</GroupRow>
			</Group>

			<ConfirmDialog
				open={confirmSignOut}
				title={t("sync.signOutTitle")}
				body={t("sync.signOutHint")}
				confirmLabel={t("sync.signOut")}
				onCancel={() => setConfirmSignOut(false)}
				onConfirm={() => {
					setConfirmSignOut(false);
					void sync.disconnect();
				}}
			/>
		</>
	);
}

function HelpTab() {
	const { t } = usePrefs();
	return (
		<Group plain title={t("settings.help")}>
			{([1, 2, 3, 4, 5, 6, 7] as const).map((n) => (
				<details key={n} className="pm-faq">
					<summary>
						<span>{t(`help.q${n}`)}</span>
						<ChevronDown />
					</summary>
					<p className="pm-muted">{t(`help.a${n}`)}</p>
				</details>
			))}
		</Group>
	);
}
