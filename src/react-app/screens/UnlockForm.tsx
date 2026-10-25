import { Lightbulb, ScanFace } from "lucide-react";
import { useState } from "react";
import { Button, Note, PasswordField, TextField } from "sityle";

import { useLibrary } from "@/app/context";
import { offerPasskey } from "@/app/passkeyOffer";
import { useT } from "@/app/prefs";
import { passwordHint, slotsOf, type BookFile } from "@/lib/bookfile";
import { recoveryHint, recoveryQuestion } from "@/lib/crypto";
import { hasPasskey, unlockWithPasskey } from "@/lib/passkey";
import { capsLock } from "@/ui/fields";

/**
 * Main password (with an optional "show hint"), or — after "Forgot?" — the
 * recovery question (with its optional answer hint). On a device where the book
 * opens with its passkey, Face ID / fingerprint comes first (the password stays
 * below); after the password, that is offered once.
 */
export function UnlockForm({ book, onUnlocked }: { book: BookFile; onUnlocked: (viaRecovery: boolean) => void }) {
	const t = useT();
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
	const [passkey, setPasskey] = useState(() => hasPasskey(book.id));
	const [passkeyFailed, setPasskeyFailed] = useState(false);

	const withPasskey = async () => {
		if (busy) return;
		setBusy(true);
		setPasskeyFailed(false);
		try {
			const key = await unlockWithPasskey(book.id);
			if (key && (await library.unlockWithKey(book.id, key))) onUnlocked(false);
		} catch {
			// this device's passkey no longer opens it: the password does
			setPasskeyFailed(true);
			setPasskey(hasPasskey(book.id));
		} finally {
			setBusy(false);
		}
	};

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!secret || busy) return;
		setBusy(true);
		try {
			const ok = mode === "password" ? await library.unlock(book.id, secret) : await library.unlockWithAnswer(book.id, secret);
			if (!ok) setWrong(true);
			else {
				if (mode === "password") void offerPasskey(book.id);
				onUnlocked(mode === "forgot");
			}
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
		<Note tone="gold" icon={<Lightbulb />}>
			{text}
		</Note>
	);

	return (
		<div className="pm-stack">
			{passkey && mode === "password" && (
				<>
					<Button icon={<ScanFace />} className="pm-block" loading={busy} onClick={() => void withPasskey()}>
						{t("passkey.unlock")}
					</Button>
					<p className="pm-faint pm-or">{t("passkey.orPassword")}</p>
				</>
			)}
			{passkeyFailed && <p className="pm-error">{t("passkey.unlockFailed")}</p>}
			{mode === "password" || question ? (
				<form onSubmit={(e) => void submit(e)} className="pm-stack">
					{mode === "password" ? (
						<PasswordField
							label={t("unlock.prompt")}
							autoFocus={!passkey}
							copy={false}
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
					<Button type="submit" className="pm-block" variant={passkey && mode === "password" ? "flat" : "solid"} disabled={!secret} loading={busy}>
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
