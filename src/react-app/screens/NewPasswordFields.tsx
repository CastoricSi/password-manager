import { useState } from "react";
import { PasswordField } from "sityle";

import type { MessageKey } from "@/app/i18n";
import { useT } from "@/app/prefs";
import { capsLock, usePasswordLabels, useStrengthLabels } from "@/ui/fields";

/** "Main password" (with sityle's strength bar) + "Type it again". */
export function NewPasswordFields({
	password,
	confirm,
	onChange,
	error,
	labels,
	autoFocus,
}: {
	password: string;
	confirm: string;
	onChange: (password: string, confirm: string) => void;
	error: MessageKey | null;
	labels: { password: MessageKey; confirm: MessageKey };
	autoFocus?: boolean;
}) {
	const t = useT();
	const buttonLabels = usePasswordLabels();
	const strengthLabels = useStrengthLabels();
	const [caps, setCaps] = useState(false);
	const mismatch = confirm.length > 0 && confirm !== password;

	return (
		<div className="pm-stack">
			<PasswordField
				label={t(labels.password)}
				autoFocus={autoFocus}
				copy={false}
				labels={buttonLabels}
				strength={!!password}
				strengthLabels={strengthLabels}
				value={password}
				error={error === "pw.required" ? t(error) : undefined}
				hint={caps ? t("unlock.capsLock") : undefined}
				{...capsLock(setCaps)}
				onChange={(e) => onChange(e.target.value, confirm)}
			/>
			<PasswordField
				label={t(labels.confirm)}
				copy={false}
				labels={buttonLabels}
				value={confirm}
				error={mismatch || error === "pw.mismatch" ? t("pw.mismatch") : undefined}
				onChange={(e) => onChange(password, e.target.value)}
			/>
		</div>
	);
}
