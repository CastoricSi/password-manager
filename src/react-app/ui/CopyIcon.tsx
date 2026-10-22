import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "@/app/prefs";
import { cn } from "sityle";

/**
 * Icon-only copy button for dense places (table cells). Shows a check when
 * done. Hidden until hover on pointer devices, always visible on touch.
 */
export function CopyIcon({ value, label }: { value: string; label: string }) {
	const t = useT();
	const [done, setDone] = useState(false);

	useEffect(() => {
		if (!done) return;
		const timer = setTimeout(() => setDone(false), 1500);
		return () => clearTimeout(timer);
	}, [done]);

	if (!value) return null;
	return (
		<button
			type="button"
			onClick={async (e) => {
				e.stopPropagation();
				try {
					await navigator.clipboard.writeText(value);
					setDone(true);
				} catch {
					// Clipboard blocked: nothing sensible to show in a cell.
				}
			}}
			title={done ? t("common.copied") : `${t("common.copy")} ${label}`}
			aria-label={done ? t("common.copied") : `${t("common.copy")} ${label}`}
			className={cn("pm-cell-action", done && "is-done")}
		>
			{done ? <Check /> : <Copy />}
		</button>
	);
}
