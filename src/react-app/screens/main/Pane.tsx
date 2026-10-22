import { ChevronLeft } from "lucide-react";
import { Button } from "sityle";

import { useT } from "@/app/prefs";

/** The entry area's page. On phones it's a full page with a Back button. */
export function Pane({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
	const t = useT();
	return (
		<div className="pm-pane-inner">
			{onBack && (
				<Button variant="ghost" size="sm" icon={<ChevronLeft />} onClick={onBack} className="pm-pane-back">
					{t("common.back")}
				</Button>
			)}
			{children}
		</div>
	);
}
