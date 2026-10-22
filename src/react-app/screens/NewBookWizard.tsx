import { ArrowLeft, BookOpen, Lock, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button, Note, RadioCard, Steps, TextField } from "sityle";

import { useLibrary } from "@/app/context";
import type { MessageKey } from "@/app/i18n";
import { useT } from "@/app/prefs";
import { NewPasswordFields } from "./NewPasswordFields";
import { RecoveryFields } from "./RecoveryFields";
import { RestoreButton } from "./RestoreButton";
import { newPasswordError, recoveryInput } from "./validation";

type Mode = "password" | "open";

/**
 * New password book, step by step:
 *   1. name + protection (or import a backup instead)
 *   2. main password, again, optional hint            (password books only)
 *   3. recovery question, answer, optional answer hint (optional step)
 */
export function NewBookWizard({ defaultName, onDone, onCancel, inDialog }: { defaultName: string; onDone: (bookId: string) => void; onCancel?: () => void; /** The dialog already says "New book". */ inDialog?: boolean }) {
	const t = useT();
	const [, library] = useLibrary();
	const [step, setStep] = useState<1 | 2 | 3>(1);
	const [name, setName] = useState(defaultName);
	const [mode, setMode] = useState<Mode>("password");
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [hint, setHint] = useState("");
	const [question, setQuestion] = useState("");
	const [answer, setAnswer] = useState("");
	const [answerHint, setAnswerHint] = useState("");
	const [nameMissing, setNameMissing] = useState(false);
	const [pwError, setPwError] = useState<MessageKey | null>(null);
	const [hintError, setHintError] = useState(false);
	const [recoveryError, setRecoveryError] = useState(false);
	const [busy, setBusy] = useState(false);

	const total = mode === "password" ? 3 : 1;

	// Focus the step's first box once it has slid in, without letting the
	// browser scroll anything (an autoFocus mid-slide makes the stepper shake).
	const stepBox = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const timer = setTimeout(() => stepBox.current?.querySelector<HTMLInputElement>("input:not([type=radio]), button[role=combobox]")?.focus({ preventScroll: true }), 280);
		return () => clearTimeout(timer);
	}, [step]);

	const create = async (withRecovery: boolean) => {
		setBusy(true);
		try {
			const recovery = withRecovery ? recoveryInput(question, answer) : "none";
			const id = await library.createBook(
				name,
				mode === "open"
					? null
					: {
							password,
							hint,
							recovery: typeof recovery === "object" ? { ...recovery, hint: answerHint } : undefined,
						},
			);
			onDone(id);
		} finally {
			setBusy(false);
		}
	};

	const next1 = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return setNameMissing(true);
		if (mode === "open") return void create(false);
		setStep(2);
	};

	const next2 = (e: React.FormEvent) => {
		e.preventDefault();
		const err = newPasswordError(password, confirm);
		setPwError(err);
		// A hint that simply is the password defeats the purpose.
		const badHint = !!hint.trim() && hint.trim() === password;
		setHintError(badHint);
		if (err || badHint) return;
		setStep(3);
	};

	const finish = (e: React.FormEvent) => {
		e.preventDefault();
		const recovery = recoveryInput(question, answer);
		if (recovery === "incomplete") return setRecoveryError(true);
		void create(recovery !== "none");
	};

	const back = (to: 1 | 2) => (
		<Button variant="ghost" icon={<ArrowLeft />} onClick={() => setStep(to)}>
			{t("common.back")}
		</Button>
	);

	const choice = (value: Mode, icon: React.ReactNode, title: MessageKey, text: MessageKey) => (
		<RadioCard name="book-mode" checked={mode === value} onChange={() => setMode(value)} icon={icon} title={t(title)} description={t(text)} />
	);

	return (
		<div className="pm-wizard">
			<Steps current={step} total={total} label={t("wizard.step", { n: step, total })} />
			<AnimatePresence mode="wait" initial={false}>
				<motion.div
					key={step}
					ref={stepBox}
					className="pm-wizard-step"
					initial={{ opacity: 0, x: 18 }}
					animate={{ opacity: 1, x: 0 }}
					exit={{ opacity: 0, x: -18, transition: { duration: 0.12 } }}
					transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
				>

			{step === 1 && (
				<form onSubmit={next1} className="pm-stack is-loose">
					{!inDialog && <h2 className="pm-title">{t("wizard.title1")}</h2>}
					<TextField
						label={t("book.name")}
						value={name}
						error={nameMissing ? t("book.nameRequired") : undefined}
						// hint={t("book.namePlaceholder")}
						onChange={(e) => {
							setName(e.target.value);
							setNameMissing(false);
						}}
					/>
					<fieldset className="pm-stack is-tight" style={{ border: 0, padding: 0, margin: 0 }}>
						<legend className="pm-label" style={{ marginBottom: 6 }}>
							{t("book.protection")}
						</legend>
						{choice("password", <Lock />, "book.withPassword", "book.withPasswordHint")}
						{choice("open", <BookOpen />, "book.open", "book.openHint")}
					</fieldset>
					<hr className="pm-divider" />
					<div className="pm-stack is-tight" style={{ justifyItems: "center", textAlign: "center" }}>
						{/* <p className="pm-muted">{t("wizard.orImport")}</p> */}
						<RestoreButton icon={<Upload />} onImported={onDone}>
							{t("welcome.fromBackup")}
						</RestoreButton>
					</div>
					<div className="pm-row pm-wizard-actions">
						{onCancel && (
							<Button variant="ghost" icon={<ArrowLeft />} onClick={onCancel}>
								{t("common.back")}
							</Button>
						)}
						<Button type="submit" className="pm-grow" loading={busy}>
							{mode === "open" ? t("book.create") : t("wizard.next")}
						</Button>
					</div>
				</form>
			)}

			{step === 2 && (
				<form onSubmit={next2} className="pm-stack is-loose">
					<h2 className="pm-title">{t("wizard.title2")}</h2>
					<NewPasswordFields
						password={password}
						confirm={confirm}
						onChange={(p, c) => {
							setPassword(p);
							setConfirm(c);
							setPwError(null);
						}}
						error={pwError}
						labels={{ password: "setup.password", confirm: "setup.confirm" }}
					/>
					<TextField
						label={t("hint.password")}
						autoComplete="off"
						value={hint}
						hint={t("hint.passwordHint")}
						error={hintError ? t("hint.notThePassword") : undefined}
						onChange={(e) => {
							setHint(e.target.value);
							setHintError(false);
						}}
					/>
					<Note tone="warn">{t("setup.remember")}</Note>
					<div className="pm-row pm-wizard-actions">
						{back(1)}
						<Button type="submit" className="pm-grow">
							{t("wizard.next")}
						</Button>
					</div>
				</form>
			)}

			{step === 3 && (
				<form onSubmit={finish} className="pm-stack is-loose">
					<div className="pm-stack is-tight">
						<h2 className="pm-title">{t("wizard.title3")}</h2>
						<p className="pm-muted">{t("setup.recoveryHint")}</p>
					</div>
					<RecoveryFields
						question={question}
						answer={answer}
						onChange={(q, a) => {
							setQuestion(q);
							setAnswer(a);
							setRecoveryError(false);
						}}
						error={recoveryError ? t("q.incomplete") : null}
					/>
					<TextField label={t("hint.answer")} autoComplete="off" value={answerHint} hint={t("hint.answerHint")} onChange={(e) => setAnswerHint(e.target.value)} />
					<div className="pm-row pm-wizard-actions">
						{back(2)}
						<Button variant="bordered" disabled={busy} onClick={() => void create(false)}>
							{t("wizard.skip")}
						</Button>
						<Button type="submit" className="pm-grow" loading={busy}>
							{t("wizard.finish")}
						</Button>
					</div>
				</form>
			)}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
