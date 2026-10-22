import { Lightbulb } from "lucide-react";
import { useState } from "react";
import { Button, Note, PasswordField, TextField } from "sityle";

import { useLibrary } from "@/app/context";
import { useT } from "@/app/prefs";
import { passwordHint, slotsOf, type BookFile } from "@/lib/bookfile";
import { recoveryHint, recoveryQuestion } from "@/lib/crypto";
import { capsLock, usePasswordLabels } from "@/ui/fields";

/**
 * Main password (with an optional "show hint"), or — after "Forgot?" — the
 * recovery question (with its optional answer hint).
 */
export function UnlockForm({ book, onUnlocked }: { book: BookFile; onUnlocked: (viaRecovery: boolean) => void }) {
	const t = useT();
	const labels = usePasswordLabels();
	const [, library] = useLibrary();
	const [mode, setMode] = useState<"password" | "forgot">("password");
	const [secret, setSecret] = useState("");
	const [wrong, setWrong] = useState(false);
	const [caps, setCaps] = useState(false);
	const [busy, setBusy] = useState(false);
	const [showHint, setShowHint] = useState(false);
	const hint = passwordHint(book);
	const question = recoveryQuestion(slotsOf(book));
	const answerHint = recoveryHint(slotsOf(book));

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!secret || busy) return;
		setBusy(true);
		try {
			const ok = mode === "password" ? await library.unlock(book.id, secret) : await library.unlockWithAnswer(book.id, secret);
			if (!ok) setWrong(true);
			else onUnlocked(mode === "forgot");
		} finally {
			setBusy(false);
		}
	};

	const switchTo = (next: "password" | "forgot") => {
		setMode(next);
		setSecret("");
		setWrong(false);
	};

	const hintNote = (text: string) => (
		<Note tone="warn" icon={<Lightbulb />}>
			{text}
		</Note>
	);

	return (
		<div className="pm-stack">
			{mode === "password" || question ? (
				<form onSubmit={(e) => void submit(e)} className="pm-stack">
					{mode === "password" ? (
						<PasswordField
							label={t("unlock.prompt")}
							autoFocus
							copy={false}
							labels={labels}
							value={secret}
							error={wrong ? t("unlock.wrong") : undefined}
							hint={caps ? t("unlock.capsLock") : undefined}
							{...capsLock(setCaps)}
							onChange={(e) => {
								setSecret(e.target.value);
								setWrong(false);
							}}
						/>
					) : (
						<TextField
							label={question!}
							autoFocus
							autoComplete="off"
							value={secret}
							error={wrong ? t("unlock.wrongAnswer") : undefined}
							onChange={(e) => {
								setSecret(e.target.value);
								setWrong(false);
							}}
						/>
					)}
					{mode === "password" && hint && showHint && hintNote(t("hint.show", { hint }))}
					{mode === "forgot" && answerHint && hintNote(t("hint.show", { hint: answerHint }))}
					<Button type="submit" className="pm-block" disabled={!secret} loading={busy}>
						{t("unlock.open")}
					</Button>
				</form>
			) : (
				<p className="pm-muted">{t("locked.noRecovery")}</p>
			)}
			<div className="pm-row is-center">
				{mode === "password" && hint && !showHint && (
					<Button variant="ghost" size="sm" icon={<Lightbulb />} onClick={() => setShowHint(true)}>
						{t("hint.reveal")}
					</Button>
				)}
				<Button variant="ghost" size="sm" onClick={() => switchTo(mode === "password" ? "forgot" : "password")}>
					{mode === "password" ? t("unlock.forgot") : t("unlock.usePassword")}
				</Button>
			</div>
		</div>
	);
}
