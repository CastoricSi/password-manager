import { ArrowLeft, Check, ExternalLink, EyeOff, Plus, Trash2, WandSparkles, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button, ConfirmDialog, CopyButton, IconButton, Input, PasswordField, SelectField, TextAreaField, TextField } from "sityle";

import { usePrefs } from "@/app/prefs";
import { newField, toHref, type Category, type CustomField, type Entry } from "@/lib/content";
import { generatePassword } from "@/lib/password";
import { EntryAvatar } from "@/ui/Logo";
import { useMediaQuery } from "@/ui/useMediaQuery";
import { AddAttachmentButton, AttachmentList } from "./Attachments";
import { Pane } from "./Pane";

const NEW_CATEGORY = "__new__";

export type EntryDraftResult = { entry: Entry; newFiles: Record<string, string>; newCategory?: string };

/** Everything that counts as an edit (not the timestamps). */
const editable = (e: Entry) => JSON.stringify([e.name, e.username, e.password, e.url, e.notes, e.categoryId, e.fields, e.attachments]);

/**
 * One page per entry that is always editable: copy / show / open-site sit next
 * to each box, and a footer at the bottom holds Save (Ctrl+S) — plus Undo
 * changes and Delete. New entries use the same page.
 * The parent re-mounts it (key) after a save. Changes from sync replace the
 * boxes as long as nothing has been typed here.
 */
export function EntryEditor({
	initial,
	isNew,
	customFields,
	categories,
	labelSuggestions,
	justSaved,
	loadAttachment,
	onSave,
	onCancel,
	onDelete,
	onBack,
	onDirtyChange,
}: {
	initial: Entry;
	isNew: boolean;
	customFields: boolean;
	categories: Category[];
	labelSuggestions: string[];
	justSaved: boolean;
	loadAttachment: (id: string) => Promise<string | null>;
	onSave: (result: EntryDraftResult) => Promise<void>;
	/** New entry only: drop it. */
	onCancel: () => void;
	onDelete: () => void;
	onBack: () => void;
	onDirtyChange: (dirty: boolean) => void;
}) {
	const { t, lang } = usePrefs();
	const phone = useMediaQuery("(max-width: 767px)");
	const listId = useId();
	const [base, setBase] = useState(initial);
	const [draft, setDraft] = useState(initial);
	const [newFiles, setNewFiles] = useState<Record<string, string>>({});
	const [categoryChoice, setCategoryChoice] = useState(initial.categoryId ?? "");
	const [newCategory, setNewCategory] = useState("");
	const [tooBig, setTooBig] = useState<string[]>([]);
	const [nameMissing, setNameMissing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [pwKey, setPwKey] = useState(0); // re-mount the password box to show a generated one

	const dirty = editable(draft) !== editable(base) || Object.keys(newFiles).length > 0 || categoryChoice !== (base.categoryId ?? "");

	// Synced from elsewhere while untouched here: show the new version.
	if (initial !== base && !dirty) {
		setBase(initial);
		setDraft(initial);
		setCategoryChoice(initial.categoryId ?? "");
	}

	useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

	const set = <K extends keyof Entry>(key: K, value: Entry[K]) => setDraft((d) => ({ ...d, [key]: value }));
	const setField = (id: string, patch: Partial<CustomField>) => set("fields", draft.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
	const showFields = customFields || draft.fields.length > 0;
	const href = toHref(draft.url);
	const updated = new Date(base.updatedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

	const save = async () => {
		if (saving || (!dirty && !isNew)) return;
		if (!draft.name.trim()) return setNameMissing(true);
		const creating = categoryChoice === NEW_CATEGORY && newCategory.trim();
		setSaving(true);
		try {
			await onSave({
				entry: { ...draft, categoryId: categoryChoice && categoryChoice !== NEW_CATEGORY ? categoryChoice : null },
				newFiles,
				newCategory: creating ? newCategory : undefined,
			});
		} finally {
			setSaving(false);
		}
	};

	// Ctrl+S / ⌘S saves wherever the focus is.
	const saveRef = useRef(save);
	useEffect(() => {
		saveRef.current = save;
	});
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				void saveRef.current();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const undo = () => {
		setDraft(base);
		setNewFiles({});
		setCategoryChoice(base.categoryId ?? "");
		setNewCategory("");
		setNameMissing(false);
		setTooBig([]);
	};

	const copy = (value: string, what: string) => <CopyButton value={value} label={`${t("common.copy")} ${what}`} copiedLabel={t("common.copied")} />;

	return (
		<form
			className="pm-editor"
			onSubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			{/* stays at the top while the fields scroll, so ← is always at hand */}
			<div className="pm-entry-head">
				<div className="pm-stack is-tight pm-entry-head-inner">
					<div className="pm-row is-nowrap" style={{ gap: 12 }}>
						{/* close the entry (phones: back to the list) */}
						<span className="pm-fold">
							<IconButton label={phone ? t("common.back") : t("entry.collapse")} onClick={onBack}>
								<ArrowLeft />
							</IconButton>
						</span>
						<EntryAvatar name={draft.name} size={36} />
						<Input
							className="pm-grow pm-name-input"
							aria-label={t("field.name")}
							placeholder={t("field.namePlaceholder")}
							autoFocus={isNew}
							aria-invalid={nameMissing || undefined}
							value={draft.name}
							onChange={(e) => {
								set("name", e.target.value);
								setNameMissing(false);
							}}
						/>
					</div>
					{nameMissing && (
						<p role="alert" className="pm-error" style={{ paddingLeft: 100, paddingBottom: 6 }}>
							{t("field.nameRequired")}
						</p>
					)}
				</div>
			</div>
			<div className="pm-editor-body">
				<Pane>
					<div className="pm-stack is-loose">
						<div className="pm-stack is-loose">
								<div className="pm-row" style={{ alignItems: "flex-start" }}>
									<SelectField
										className="pm-grow"
										label={t("field.category")}
										value={categoryChoice}
										onChange={setCategoryChoice}
										style={{ minWidth: 160 }}
										options={[{ value: "", label: t("category.none") }, ...categories.map((c) => ({ value: c.id, label: c.name })), { value: NEW_CATEGORY, label: t("category.new") }]}
									/>
									{categoryChoice === NEW_CATEGORY && (
										<TextField className="pm-grow" autoFocus label={t("category.newName")} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
									)}
								</div>

								<TextField
									label={t("field.username")}
									autoComplete="off"
									autoCapitalize="off"
									hint={isNew ? t("field.usernamePlaceholder") : undefined}
									value={draft.username}
									onChange={(e) => set("username", e.target.value)}
									end={copy(draft.username, t("field.username"))}
								/>

								<PasswordField
									key={pwKey}
									label={t("field.password")}
									defaultVisible={pwKey > 0}
									value={draft.password}
									onChange={(e) => set("password", e.target.value)}
									extra={
										<IconButton
											key="gen"
											label={t("entry.generate")}
											onClick={() => {
												set("password", generatePassword());
												setPwKey((k) => k + 1);
											}}
										>
											<WandSparkles />
										</IconButton>
									}
								/>

								<TextField
									label={t("field.url")}
									inputMode="url"
									autoCapitalize="off"
									hint={isNew ? t("field.urlPlaceholder") : undefined}
									value={draft.url}
									onChange={(e) => set("url", e.target.value)}
									end={[
										<span key="c">{copy(draft.url, t("field.url"))}</span>,
										href ? (
											<IconButton key="o" label={t("entry.openSite")} onClick={() => window.open(href, "_blank", "noopener,noreferrer")}>
												<ExternalLink />
											</IconButton>
										) : null,
									]}
								/>

								{showFields && (
									<div className="pm-stack">
										{draft.fields.map((f) => (
											<div key={f.id} className="pm-custom-field">
												<TextField
													className="pm-custom-name"
													label={t("fields.name")}
													list={listId}
													value={f.label}
													autoFocus={!f.label && !f.value}
													onChange={(e) => setField(f.id, { label: e.target.value })}
												/>
												{f.secret ? (
													<PasswordField
														label={f.label || t("fields.value")}
														value={f.value}
														onChange={(e) => setField(f.id, { value: e.target.value })}
													/>
												) : (
													<TextField
														label={f.label || t("fields.value")}
														value={f.value}
														onChange={(e) => setField(f.id, { value: e.target.value })}
														end={copy(f.value, f.label || t("fields.value"))}
													/>
												)}
												<div className="pm-custom-actions">
													<IconButton label={t("fields.secret")} active={f.secret} onClick={() => setField(f.id, { secret: !f.secret })}>
														<EyeOff />
													</IconButton>
													<IconButton label={t("fields.remove")} onClick={() => set("fields", draft.fields.filter((x) => x.id !== f.id))}>
														<X />
													</IconButton>
												</div>
											</div>
										))}
										<datalist id={listId}>
											{labelSuggestions.map((l) => (
												<option key={l} value={l} />
											))}
										</datalist>
										{customFields && (
											<div>
												<Button size="sm" variant="light" icon={<Plus />} onClick={() => set("fields", [...draft.fields, newField()])}>
													{t("fields.add")}
												</Button>
											</div>
										)}
									</div>
								)}

								<TextAreaField label={t("field.notes")} rows={3} value={draft.notes} onChange={(e) => set("notes", e.target.value)} end={copy(draft.notes, t("field.notes"))} />

								<div className="pm-stack is-tight">
									<span className="pm-label">{t("field.attachments")}</span>
									{draft.attachments.length > 0 && (
										<AttachmentList
											items={draft.attachments}
											load={async (id) => newFiles[id] ?? loadAttachment(id)}
											onRemove={(id) => {
												set("attachments", draft.attachments.filter((a) => a.id !== id));
												setNewFiles((m) => {
													const next = { ...m };
													delete next[id];
													return next;
												});
											}}
										/>
									)}
									<AddAttachmentButton
										onAdd={(added, big) => {
											setTooBig(big);
											if (!added.length) return;
											set("attachments", [...draft.attachments, ...added.map((a) => a.meta)]);
											setNewFiles((m) => ({ ...m, ...Object.fromEntries(added.map((a) => [a.meta.id, a.dataUrl])) }));
										}}
									/>
									{tooBig.length > 0 && <p className="pm-error">{t("attachment.tooBig", { names: tooBig.join("、") })}</p>}
								</div>
							</div>

						{!isNew && <p className="pm-faint">{t("entry.updated", { time: updated })}</p>}
					</div>
				</Pane>
			</div>

			<footer className="pm-editor-foot">
				<div className="pm-editor-foot-inner">
					{!isNew && (
						<Button variant="light" tone="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)} aria-label={t("common.delete")} className="pm-foot-btn pm-icon-on-phone">
							<span>{t("common.delete")}</span>
						</Button>
					)}
					<span className="pm-grow pm-editor-status" aria-live="polite">
						{dirty ? (
							<span className="pm-warn">{t("entry.unsaved")}</span>
						) : justSaved && !isNew ? (
							<span className="pm-ok pm-row is-nowrap" style={{ gap: 4 }}>
								<Check size={15} />
								{t("entry.saved")}
							</span>
						) : null}
					</span>
					{isNew ? (
						<Button className="pm-foot-btn" variant="ghost" onClick={onCancel}>
							{t("common.cancel")}
						</Button>
					) : (
						dirty && (
							<Button className="pm-foot-btn" variant="ghost" onClick={undo}>
								{t("entry.undo")}
							</Button>
						)
					)}
					<Button className="pm-foot-btn" type="submit" loading={saving} disabled={!dirty && !isNew} style={{ minWidth: 96 }}>
						{t("common.save")}
					</Button>
				</div>
			</footer>

			<ConfirmDialog
				open={confirmDelete}
				title={t("entry.deleteTitle", { name: base.name })}
				seal="删"
				body={t("entry.deleteBody")}
				confirmLabel={t("common.delete")}
				onCancel={() => setConfirmDelete(false)}
				onConfirm={() => {
					setConfirmDelete(false);
					onDelete();
				}}
			/>
		</form>
	);
}
