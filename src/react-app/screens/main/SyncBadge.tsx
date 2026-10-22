import { Cloud, CloudAlert, CloudCheck, CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { useSync } from "@/app/context";
import { usePrefs } from "@/app/prefs";
import { IconButton, InkDrop } from "sityle";

/** "Synced · just now", "Syncing…", "Offline — will sync when back online"… */
function useStatusText() {
	const { t, lang } = usePrefs();
	const [state] = useSync();
	// "now" refreshes every 30 s so "just now" turns into "2 minutes ago".
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(timer);
	}, []);

	const ago = (d: Date) => {
		const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
		if (s < 60) return t("time.justNow");
		const rtf = new Intl.RelativeTimeFormat(lang === "zh" ? "zh-CN" : "en", { numeric: "auto" });
		return s < 3600 ? rtf.format(-Math.round(s / 60), "minute") : rtf.format(-Math.round(s / 3600), "hour");
	};

	switch (state.status) {
		case "syncing":
			return { tone: "muted", Icon: RefreshCw, short: t("sync.syncing"), long: t("sync.syncing") };
		case "synced":
			return {
				tone: state.waitingForUnlock.length ? "warn" : "ok",
				Icon: state.waitingForUnlock.length ? CloudAlert : CloudCheck,
				short: t("sync.synced"),
				long: state.waitingForUnlock.length
					? t("sync.waitingUnlockLong")
					: state.lastSyncedAt
						? t("sync.syncedAt", { time: ago(state.lastSyncedAt) })
						: t("sync.synced"),
			};
		case "offline":
			return { tone: "muted", Icon: CloudOff, short: t("sync.offline"), long: t("sync.offlineLong") };
		case "error":
			return { tone: "danger", Icon: CloudAlert, short: t("sync.error"), long: t("sync.errorLong") };
		default:
			return null;
	}
}

const toneColor = { ok: "var(--si-jade-text)", warn: "var(--si-gold-text)", danger: "var(--si-cinnabar-text)", muted: "var(--si-ink-2)" } as const;

/** Sync status as an icon next to the brand (only when sync is connected); the tooltip says it, a click opens the account settings. */
export function SyncBadge({ onClick }: { onClick: () => void }) {
	const status = useStatusText();
	const [state] = useSync();
	if (!status) return null;
	const { Icon } = status;
	return (
		<IconButton label={status.long} onClick={onClick} style={{ color: toneColor[status.tone as keyof typeof toneColor] }}>
			{state.status === "syncing" ? <InkDrop /> : <Icon />}
		</IconButton>
	);
}

export function SyncStatusText() {
	const status = useStatusText();
	if (!status) return <Cloud size={14} />;
	const { Icon } = status;
	return (
		<span className="pm-row is-nowrap" style={{ gap: 6, fontSize: "0.875rem", color: toneColor[status.tone as keyof typeof toneColor] }}>
			<Icon size={14} style={{ flex: "none" }} />
			{status.long}
		</span>
	);
}
