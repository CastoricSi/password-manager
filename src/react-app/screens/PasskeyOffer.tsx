import { ScanFace } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, IconBadge } from "sityle";

import { useLibrary } from "@/app/context";
import { closePasskeyOffer, usePasskeyOffer } from "@/app/passkeyOffer";
import { useT } from "@/app/prefs";
import { enablePasskey, PasskeyUnsupportedError, skipPasskey } from "@/lib/passkey";
import { useLast } from "@/ui/useLast";

/** Asked once per book on this device, after the main password: Face ID / fingerprint from now on? */
export function PasskeyOffer() {
	const t = useT();
	const [{ books, opened }] = useLibrary();
	const offered = usePasskeyOffer();
	const bookId = useLast(offered);
	const book = books.find((b) => b.id === bookId);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState<string | null>(null);

	const close = () => {
		setFailed(null);
		closePasskeyOffer();
	};
	const enable = async () => {
		const key = bookId ? opened[bookId]?.key : null;
		if (!bookId || !key) return close();
		setBusy(true);
		setFailed(null);
		try {
			await enablePasskey(bookId, key, t("passkey.name"));
			close();
		} catch (e) {
			// cancelled: stay, they can try again or skip
			if (e instanceof DOMException && e.name === "NotAllowedError") setFailed(t("passkey.cancelled"));
			else setFailed(e instanceof PasskeyUnsupportedError ? t("passkey.unsupported") : t("passkey.failed"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog
			open={!!offered && !!book}
			onClose={close}
			title={t("passkey.offerTitle")}
			actions={
				<>
					<Button
						variant="ghost"
						onClick={() => {
							if (bookId) skipPasskey(bookId);
							close();
						}}
					>
						{t("passkey.skip")}
					</Button>
					<Button icon={<ScanFace />} loading={busy} onClick={() => void enable()}>
						{t("passkey.enable")}
					</Button>
				</>
			}
		>
			<div className="pm-stack is-tight">
				<div className="pm-row is-nowrap">
					<IconBadge>
						<ScanFace />
					</IconBadge>
					<p>{t("passkey.offerBody", { name: book?.name ?? "" })}</p>
				</div>
				<p className="pm-faint">{t("passkey.offerNote")}</p>
				{failed && <p className="pm-error">{failed}</p>}
			</div>
		</Dialog>
	);
}
