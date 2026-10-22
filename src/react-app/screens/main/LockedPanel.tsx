import { Lock } from "lucide-react";
import { IconBadge } from "sityle";

import { useT } from "@/app/prefs";
import type { BookFile } from "@/lib/bookfile";
import { UnlockForm } from "../UnlockForm";

/**
 * Shown in place of the list while the current book is locked. Unlocking
 * happens right here — other books stay one click away in the switcher.
 */
export function LockedPanel({ book, autoLocked, onRecovered }: { book: BookFile; autoLocked: boolean; onRecovered: (id: string) => void }) {
	const t = useT();
	return (
		<div className="pm-locked-body">
			<div className="pm-locked-box">
				<div className="pm-locked-head">
					<IconBadge size={52}>
						<Lock />
					</IconBadge>
					<h2 className="pm-title">{t("locked.title", { name: book.name })}</h2>
					{autoLocked && <p className="pm-muted">{t("unlock.autoLocked")}</p>}
				</div>
				<UnlockForm book={book} onUnlocked={(viaRecovery) => viaRecovery && onRecovered(book.id)} />
			</div>
		</div>
	);
}
