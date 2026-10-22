import type { MessageKey } from "@/app/i18n";

/** Validates a new main password pair; returns the error key or null. */
export function newPasswordError(password: string, confirm: string): MessageKey | null {
	if (!password) return "pw.required";
	if (password !== confirm) return "pw.mismatch";
	return null;
}

/** Both empty → no question; both filled → a question; otherwise incomplete. */
export function recoveryInput(question: string, answer: string): "none" | "incomplete" | { question: string; answer: string } {
	const q = question.trim();
	const a = answer.trim();
	if (!q && !a) return "none";
	if (!q || !a) return "incomplete";
	return { question: q, answer: a };
}
