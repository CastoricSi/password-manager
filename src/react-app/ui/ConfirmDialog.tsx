import { ConfirmDialog as SiConfirmDialog } from "sityle";

import { useT } from "@/app/prefs";

/** sityle's "Are you sure?" with "Cancel" in the app's language. */
export function ConfirmDialog(props: React.ComponentProps<typeof SiConfirmDialog>) {
	const t = useT();
	return <SiConfirmDialog cancelLabel={t("common.cancel")} {...props} />;
}
