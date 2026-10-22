import { Dialog } from "sityle";

import { useT } from "@/app/prefs";
import { NewPasswordForm } from "../NewPasswordForm";

/** After unlocking with the recovery question in the main view: a new password is required (can't be dismissed). */
export function NewPasswordDialog({ bookId, onDone }: { bookId: string; onDone: () => void }) {
	const t = useT();
	return (
		<Dialog open title={t("recovered.title")} onClose={() => {}}>
			<NewPasswordForm bookId={bookId} onDone={onDone} bare />
		</Dialog>
	);
}
