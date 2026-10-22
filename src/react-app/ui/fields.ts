/** onKeyDown / onKeyUp that report whether Caps Lock is on. */
export function capsLock(report: (on: boolean) => void) {
	const check = (e: React.KeyboardEvent) => report(e.getModifierState?.("CapsLock") ?? false);
	return { onKeyDown: check, onKeyUp: check };
}
