import { useState } from "react";

/**
 * The value, or the last non-empty one while it is empty — so a dialog showing
 * it can play its closing animation with its text intact.
 */
export function useLast<T>(value: T | null | undefined): T | null {
	const [last, setLast] = useState<T | null>(value ?? null);
	if (value != null && value !== last) setLast(value);
	return value ?? last;
}
