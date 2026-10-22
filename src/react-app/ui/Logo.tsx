import { Avatar } from "sityle";

import iconUrl from "@/assets/icon.webp";

/** The app icon (祀, the same portrait as sityle's), in a circle. Decorative. */
export function Logo({ size = 32 }: { size?: number }) {
	return (
		<img
			src={iconUrl}
			alt=""
			aria-hidden
			draggable={false}
			width={size}
			height={size}
			style={{ objectFit: "cover", borderRadius: "50%", userSelect: "none", flex: "none", boxShadow: "0 0 0 1px var(--si-line)" }}
		/>
	);
}

const PIGMENTS = ["jade", "azure", "gold"] as const;

/** sityle's letter tile ("微" for 微信); the pigment follows the name, so it stays the same. */
export function EntryAvatar({ name, size = 40 }: { name: string; size?: number }) {
	let h = 0;
	for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
	return <Avatar name={name} size={size} color={PIGMENTS[h % PIGMENTS.length]} />;
}
