import { useState } from "react";
import { SelectField, TextField } from "sityle";

import type { MessageKey } from "@/app/i18n";
import { useT } from "@/app/prefs";

const PRESETS: MessageKey[] = ["q.preset1", "q.preset2", "q.preset3", "q.preset4", "q.preset5"];
const CUSTOM = "__custom__";

/** Pick a common question (or write one) and type the answer. */
export function RecoveryFields({
	question,
	answer,
	onChange,
	error,
}: {
	question: string;
	answer: string;
	onChange: (question: string, answer: string) => void;
	error?: string | null;
}) {
	const t = useT();
	const presets = PRESETS.map((k) => t(k));
	const [custom, setCustom] = useState(() => !!question && !presets.includes(question));

	return (
		<div className="pm-stack">
			<SelectField
				label={t("q.question")}
				value={custom ? CUSTOM : question}
				onChange={(v) => {
					setCustom(v === CUSTOM);
					onChange(v === CUSTOM ? "" : v, answer);
				}}
				options={[{ value: "", label: t("q.pick") }, ...presets.map((p) => ({ value: p, label: p })), { value: CUSTOM, label: t("q.custom") }]}
			/>
			{custom && <TextField label={t("q.customPlaceholder")} value={question} autoFocus onChange={(e) => onChange(e.target.value, answer)} />}
			<TextField label={t("q.answer")} autoComplete="off" value={answer} hint={t("q.answerHint")} error={error ?? undefined} onChange={(e) => onChange(question, e.target.value)} />
		</div>
	);
}
