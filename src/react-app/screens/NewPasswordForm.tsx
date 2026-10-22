import { useState } from "react";
import { Button, TextField } from "sityle";

import { useLibrary } from "@/app/context";
import type { MessageKey } from "@/app/i18n";
import { useT } from "@/app/prefs";
import { NewPasswordFields } from "./NewPasswordFields";
import { newPasswordError } from "./validation";

/** After opening a book with its recovery question: choose a new password (+ hint). */
export function NewPasswordForm({ bookId, onDone, bare }: { bookId: string; onDone: () => void; bare?: boolean }) {
	const t = useT();
	const [, library] = useLibrary();
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [hint, setHint] = useState("");
	const [error, setError] = useState<MessageKey | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		const err = newPasswordError(password, confirm);
		setError(err);
		if (err) return;
		setBusy(true);
		await library.setPassword(bookId, password, hint);
		setBusy(false);
		onDone();
	};

	return (
		<form onSubmit={(e) => void submit(e)} className="pm-stack is-loose">
			<div className="pm-stack is-tight">
				{!bare && <h2 className="pm-title">{t("recovered.title")}</h2>}
				<p className="pm-muted">{t("recovered.intro")}</p>
			</div>
			<NewPasswordFields
				password={password}
				confirm={confirm}
				onChange={(p, c) => {
					setPassword(p);
					setConfirm(c);
					setError(null);
				}}
				error={error}
				labels={{ password: "settings.newPassword", confirm: "setup.confirm" }}
				autoFocus
			/>
			<TextField label={t("hint.password")} autoComplete="off" value={hint} hint={t("hint.passwordHint")} onChange={(e) => setHint(e.target.value)} />
			<Button type="submit" className="pm-block" loading={busy}>
				{t("common.save")}
			</Button>
		</form>
	);
}
