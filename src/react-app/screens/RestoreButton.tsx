import { useRef, useState } from "react";
import { Button, ConfirmDialog, Dialog, type ButtonProps } from "sityle";

import { useLibrary } from "@/app/context";
import { useT } from "@/app/prefs";
import type { BookFile } from "@/lib/bookfile";
import { readBackup } from "@/lib/storage";
import { useLast } from "@/ui/useLast";

/**
 * Imports a backup file as a password book. It stays as protected as it was
 * (a password book opens with its own password). If this device already has
 * the same book, the user confirms replacing it.
 */
export function RestoreButton({ children, onImported, ...buttonProps }: Omit<ButtonProps, "onClick"> & { onImported?: (bookId: string) => void }) {
	const t = useT();
	const [{ books }, library] = useLibrary();
	const inputRef = useRef<HTMLInputElement>(null);
	const [invalid, setInvalid] = useState(false);
	const [replace, setReplace] = useState<BookFile | null>(null);
	const shownReplace = useLast(replace);

	const importBook = async (book: BookFile) => {
		await library.importBook(book);
		onImported?.(book.id);
	};

	const pick = async (file: File | undefined) => {
		if (!file) return;
		const book = await readBackup(file, t("book.defaultName"));
		if (!book || book.deletedAt) return setInvalid(true);
		if (books.some((b) => b.id === book.id)) return setReplace(book);
		await importBook(book);
	};

	return (
		<>
			<Button variant="bordered" {...buttonProps} onClick={() => inputRef.current?.click()}>
				{children}
			</Button>
			<input
				ref={inputRef}
				type="file"
				accept=".json,application/json"
				hidden
				onChange={(e) => {
					void pick(e.target.files?.[0]);
					e.target.value = "";
				}}
			/>
			<Dialog open={invalid} onClose={() => setInvalid(false)} title={t("restore.title")} actions={<Button onClick={() => setInvalid(false)}>{t("common.back")}</Button>}>
				{t("restore.invalid")}
			</Dialog>
			<ConfirmDialog
				open={!!replace}
				title={t("restore.replaceTitle", { name: shownReplace?.name ?? "" })}
				body={t("restore.replaceBody")}
				confirmLabel={t("restore.replace")}
				onCancel={() => setReplace(null)}
				onConfirm={() => {
					const book = replace;
					setReplace(null);
					if (book) void importBook(book);
				}}
			/>
		</>
	);
}
