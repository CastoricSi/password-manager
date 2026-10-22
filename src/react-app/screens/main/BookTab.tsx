import { Check, Download, LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Group, GroupRow, Note, PasswordField, Switch, TextField } from "sityle";

import { useLibrary, useSync } from "@/app/context";
import type { MessageKey } from "@/app/i18n";
import { usePrefs } from "@/app/prefs";
import { hasPassword, passwordHint, slotsOf, type BookFile, type Opened } from "@/lib/bookfile";
import { setFeatures } from "@/lib/content";
import { recoveryHint, recoveryQuestion, unlockWithPassword } from "@/lib/crypto";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { usePasswordLabels } from "@/ui/fields";
import { NewPasswordFields } from "../NewPasswordFields";
import { RecoveryFields } from "../RecoveryFields";
import { newPasswordError, recoveryInput } from "../validation";
import { SharingSection } from "./SharingSection";

/** Settings of the current book: name, protection, features, sharing, backup, delete. */
export function BookTab({ book, opened, onGone, onGoToAccount }: { book: BookFile; opened: Opened; onGone: () => void; onGoToAccount: () => void }) {
	const { t } = usePrefs();
	const [{ records }, library] = useLibrary();
	const [, sync] = useSync();
	const [name, setName] = useState(book.name);
	const [confirm, setConfirm] = useState<null | "delete" | "leave" | "removePassword" | "removeRecovery">(null);
	const [exported, setExported] = useState(false);
	const content = opened.content;
	const locked = hasPassword(book);
	const sharedWithMe = records[book.id]?.ownedByMe === false;

	return (
		<>
			<p className="pm-muted">{locked ? t("book.protectedHint") : t("book.openHint")}</p>

			<Group plain title={t("book.general")}>
				<form
					className="si-group-row"
					style={{ alignItems: "flex-start" }}
					onSubmit={(e) => {
						e.preventDefault();
						if (name.trim() && name.trim() !== book.name) void library.rename(book.id, name);
					}}
				>
					<TextField className="pm-grow" label={t("book.name")} value={name} onChange={(e) => setName(e.target.value)} />
					<Button type="submit" variant="bordered" disabled={!name.trim() || name.trim() === book.name} style={{ marginTop: 8 }}>
						{t("common.save")}
					</Button>
				</form>
			</Group>

			<SharingSection book={book} onGoToAccount={onGoToAccount} />

			<Group plain title={t("book.protection")}>
				<PasswordRow book={book} />
				{locked && (
					<>
						<HintRow book={book} />
						<RecoveryRow book={book} onRemove={() => setConfirm("removeRecovery")} />
						<GroupRow title={t("book.removePassword")} hint={t("book.removePasswordHint")}>
							<Button variant="light" color="danger" onClick={() => setConfirm("removePassword")}>
								{t("book.removePassword")}
							</Button>
						</GroupRow>
					</>
				)}
			</Group>

			<Group plain title={t("book.features")}>
				<div className="si-group-row">
					<Switch
						label={t("book.featureFields")}
						description={t("book.featureFieldsHint")}
						checked={content.features.customFields}
						onChange={(on) => void library.updateContent(book.id, (c) => setFeatures(c, { ...c.features, customFields: on }))}
					/>
				</div>
			</Group>

			<Group plain title={t("settings.backup")}>
				<GroupRow
					title={t("book.export")}
					hint={
						exported ? (
							<span className="pm-ok pm-row" style={{ gap: 4 }}>
								<Check size={14} />
								{t("settings.exported")}
							</span>
						) : (
							t("book.exportHint")
						)
					}
				>
					<Button
						variant="bordered"
						icon={<Download />}
						onClick={async () => {
							await library.exportBook(book.id);
							setExported(true);
						}}
					>
						{t("book.export")}
					</Button>
				</GroupRow>
			</Group>

			<Group plain title={t("settings.danger")}>
				{sharedWithMe ? (
					<GroupRow title={t("share.leave")} hint={t("share.leaveHint")}>
						<Button variant="light" color="danger" icon={<LogOut />} onClick={() => setConfirm("leave")}>
							{t("share.leave")}
						</Button>
					</GroupRow>
				) : (
					<GroupRow title={t("book.delete")} hint={sync.connected ? t("book.deleteSyncedHint") : t("book.deleteHint")}>
						<Button variant="light" color="danger" icon={<Trash2 />} onClick={() => setConfirm("delete")}>
							{t("book.delete")}
						</Button>
					</GroupRow>
				)}
			</Group>

			<ConfirmDialog
				open={confirm === "delete"}
				title={t("book.deleteTitle", { name: book.name })}
				seal="删"
				body={sync.connected ? t("book.deleteSyncedHint") : t("book.deleteHint")}
				confirmLabel={t("common.delete")}
				onCancel={() => setConfirm(null)}
				onConfirm={async () => {
					setConfirm(null);
					await library.deleteBook(book.id);
					onGone();
				}}
			/>
			<ConfirmDialog
				open={confirm === "leave"}
				title={t("share.leaveTitle", { name: book.name })}
				body={t("share.leaveHint")}
				confirmLabel={t("share.leave")}
				onCancel={() => setConfirm(null)}
				onConfirm={async () => {
					setConfirm(null);
					await sync.leave(book.id);
					onGone();
				}}
			/>
			<ConfirmDialog
				open={confirm === "removePassword"}
				title={t("book.removePasswordTitle")}
				body={t("book.removePasswordBody")}
				confirmLabel={t("book.removePassword")}
				onCancel={() => setConfirm(null)}
				onConfirm={() => {
					setConfirm(null);
					void library.removePassword(book.id);
				}}
			/>
			<ConfirmDialog
				open={confirm === "removeRecovery"}
				title={t("settings.recoveryRemoveTitle")}
				body={t("settings.recoveryRemoveBody")}
				confirmLabel={t("settings.recoveryRemove")}
				onCancel={() => setConfirm(null)}
				onConfirm={() => {
					setConfirm(null);
					void library.removeRecovery(book.id);
				}}
			/>
		</>
	);
}

/** Set (open book) or change (password book) the main password. */
function PasswordRow({ book }: { book: BookFile }) {
	const { t } = usePrefs();
	const labels = usePasswordLabels();
	const [, library] = useLibrary();
	const locked = hasPassword(book);
	const [open, setOpen] = useState(false);
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [again, setAgain] = useState("");
	const [hint, setHint] = useState("");
	const [error, setError] = useState<MessageKey | null>(null);
	const [currentWrong, setCurrentWrong] = useState(false);
	const [done, setDone] = useState(false);
	const [busy, setBusy] = useState(false);

	const close = () => {
		setOpen(false);
		setCurrent("");
		setNext("");
		setAgain("");
		setError(null);
		setCurrentWrong(false);
	};

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		const err = newPasswordError(next, again);
		setError(err);
		if (err || (locked && !current)) return;
		setBusy(true);
		try {
			if (locked) {
				try {
					await unlockWithPassword(slotsOf(book), current);
				} catch {
					setCurrentWrong(true);
					return;
				}
			}
			await library.setPassword(book.id, next, hint);
			close();
			setDone(true);
		} finally {
			setBusy(false);
		}
	};

	if (!open) {
		return (
			<GroupRow
				title={t("settings.mainPassword")}
				hint={
					done ? (
						<span className="pm-ok pm-row" style={{ gap: 4 }}>
							<Check size={14} />
							{locked ? t("settings.passwordChanged") : t("book.passwordSet")}
						</span>
					) : locked ? (
						t("book.passwordOn")
					) : (
						t("book.passwordOff")
					)
				}
			>
				<Button
					variant={locked ? "bordered" : "solid"}
					onClick={() => {
						setDone(false);
						setHint(passwordHint(book) ?? "");
						setOpen(true);
					}}
				>
					{locked ? t("settings.changePassword") : t("book.setPassword")}
				</Button>
			</GroupRow>
		);
	}

	return (
		<form onSubmit={(e) => void submit(e)} className="pm-stack" style={{ padding: "14px 0" }}>
			<div style={{ fontWeight: 500 }}>{locked ? t("settings.changePassword") : t("book.setPassword")}</div>
			{locked && (
				<PasswordField
					label={t("settings.currentPassword")}
					autoFocus
					copy={false}
					labels={labels}
					value={current}
					error={currentWrong ? t("settings.currentWrong") : undefined}
					onChange={(e) => {
						setCurrent(e.target.value);
						setCurrentWrong(false);
					}}
				/>
			)}
			<NewPasswordFields
				password={next}
				confirm={again}
				onChange={(p, c) => {
					setNext(p);
					setAgain(c);
					setError(null);
				}}
				error={error}
				labels={{ password: "settings.newPassword", confirm: "setup.confirm" }}
				autoFocus={!locked}
			/>
			<TextField label={t("hint.password")} autoComplete="off" value={hint} hint={t("hint.passwordHint")} onChange={(e) => setHint(e.target.value)} />
			{!locked && <Note tone="warn">{t("setup.remember")}</Note>}
			<div className="pm-row">
				<Button type="submit" loading={busy}>
					{t("common.save")}
				</Button>
				<Button variant="ghost" onClick={close}>
					{t("common.cancel")}
				</Button>
			</div>
		</form>
	);
}

/** Change just the password hint. */
function HintRow({ book }: { book: BookFile }) {
	const { t } = usePrefs();
	const [, library] = useLibrary();
	const current = passwordHint(book) ?? "";
	const [value, setValue] = useState(current);
	return (
		<form
			className="si-group-row"
			style={{ alignItems: "flex-start" }}
			onSubmit={(e) => {
				e.preventDefault();
				void library.setPasswordHint(book.id, value);
			}}
		>
			<TextField className="pm-grow" label={t("hint.password")} hint={t("hint.passwordHint")} autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
			<Button type="submit" variant="bordered" disabled={value.trim() === current} style={{ marginTop: 8 }}>
				{t("common.save")}
			</Button>
		</form>
	);
}

function RecoveryRow({ book, onRemove }: { book: BookFile; onRemove: () => void }) {
	const { t } = usePrefs();
	const [, library] = useLibrary();
	const question = recoveryQuestion(slotsOf(book));
	const [editing, setEditing] = useState(false);
	const [q, setQ] = useState("");
	const [a, setA] = useState("");
	const [h, setH] = useState("");
	const [incomplete, setIncomplete] = useState(false);
	const [busy, setBusy] = useState(false);

	if (editing) {
		return (
			<form
				className="pm-stack"
				style={{ padding: "14px 0" }}
				onSubmit={async (e) => {
					e.preventDefault();
					const input = recoveryInput(q, a);
					if (typeof input === "string") return setIncomplete(true);
					setBusy(true);
					await library.setRecovery(book.id, input.question, input.answer, h);
					setBusy(false);
					setEditing(false);
				}}
			>
				<div style={{ fontWeight: 500 }}>{t("settings.recovery")}</div>
				<RecoveryFields
					question={q}
					answer={a}
					onChange={(nq, na) => {
						setQ(nq);
						setA(na);
						setIncomplete(false);
					}}
					error={incomplete ? t("q.incomplete") : null}
				/>
				<TextField label={t("hint.answer")} hint={t("hint.answerHint")} autoComplete="off" value={h} onChange={(e) => setH(e.target.value)} />
				<div className="pm-row">
					<Button type="submit" loading={busy}>
						{t("common.save")}
					</Button>
					<Button variant="ghost" onClick={() => setEditing(false)}>
						{t("common.cancel")}
					</Button>
				</div>
			</form>
		);
	}

	return (
		<GroupRow title={t("settings.recovery")} hint={question ? t("settings.recoveryOn", { q: question }) : t("settings.recoveryOff")}>
			<div className="pm-row">
				{question && (
					<Button variant="light" color="danger" onClick={onRemove}>
						{t("settings.recoveryRemove")}
					</Button>
				)}
				<Button
					variant="bordered"
					onClick={() => {
						setQ(question ?? "");
						setA("");
						setH(recoveryHint(slotsOf(book)) ?? "");
						setIncomplete(false);
						setEditing(true);
					}}
				>
					{question ? t("settings.recoveryChange") : t("settings.recoverySet")}
				</Button>
			</div>
		</GroupRow>
	);
}
