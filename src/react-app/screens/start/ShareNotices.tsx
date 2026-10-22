import { Users } from "lucide-react";
import { useState } from "react";
import { Button, Note } from "sityle";

import { useSync } from "@/app/context";
import { useT } from "@/app/prefs";

/** "a@x.com shared “Family” with you — [Add] [Dismiss]" */
export function ShareNotices() {
	const t = useT();
	const [syncState, sync] = useSync();
	const [busy, setBusy] = useState<string | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	if (syncState.notices.length === 0) return null;

	return (
		<div className="pm-stack is-tight">
			{syncState.notices.map((n) => (
				<Note key={n.fileId} tone="accent" icon={<Users />}>
					<div className="pm-stack is-tight">
						<span>{t("share.notice", { who: n.from, name: n.bookName })}</span>
						{!syncState.canPick && <span className="pm-faint">{t("share.noPicker")}</span>}
						{failed === n.fileId && <span className="pm-error">{t("share.addFailed")}</span>}
						<div className="pm-row is-end">
							<Button size="sm" variant="ghost" onClick={() => void sync.dismiss(n)}>
								{t("share.dismiss")}
							</Button>
							<Button
								size="sm"
								loading={busy === n.fileId}
								disabled={!syncState.canPick}
								onClick={async () => {
									setBusy(n.fileId);
									setFailed(null);
									try {
										if (!(await sync.accept(n))) setFailed(n.fileId);
									} catch {
										setFailed(n.fileId);
									} finally {
										setBusy(null);
									}
								}}
							>
								{t("share.add")}
							</Button>
						</div>
					</div>
				</Note>
			))}
		</div>
	);
}
