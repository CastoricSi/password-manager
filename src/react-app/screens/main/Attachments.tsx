import { Download, Eye, FileText, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, IconButton } from "sityle";

import { useT } from "@/app/prefs";
import type { AttachmentMeta } from "@/lib/content";
import { formatSize, MAX_ATTACHMENT_BYTES } from "./attachmentUtils";

const isImage = (a: AttachmentMeta) => a.type.startsWith("image/");

function saveToDevice(name: string, dataUrl: string) {
	const a = document.createElement("a");
	a.href = dataUrl;
	a.download = name;
	a.click();
}

/**
 * Attachment list. `load` returns the data URL (decrypting if needed).
 * View / Save on each file; with `onRemove` also a remove button (editor).
 */
export function AttachmentList({
	items,
	load,
	onRemove,
}: {
	items: AttachmentMeta[];
	load: (id: string) => Promise<string | null>;
	onRemove?: (id: string) => void;
}) {
	const t = useT();
	const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
	const [thumbs, setThumbs] = useState<Record<string, string>>({});

	// Small inline thumbnails for photos.
	useEffect(() => {
		let cancelled = false;
		for (const a of items.filter(isImage)) {
			if (thumbs[a.id]) continue;
			void load(a.id).then((url) => !cancelled && url && setThumbs((m) => ({ ...m, [a.id]: url })));
		}
		return () => {
			cancelled = true;
		};
	}, [items, load]); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<>
			<ul className="pm-files">
				{items.map((a) => (
					<li key={a.id} className="pm-file">
						{thumbs[a.id] ? (
							<button type="button" className="pm-file-thumb" onClick={() => setPreview({ name: a.name, url: thumbs[a.id] })} aria-label={`${t("attachment.view")} ${a.name}`}>
								<img src={thumbs[a.id]} alt="" />
							</button>
						) : (
							<span className="pm-file-thumb">
								<FileText />
							</span>
						)}
						<span className="pm-two-line">
							<span>{a.name}</span>
							<small>{formatSize(a.size)}</small>
						</span>
						{isImage(a) && (
							<IconButton
								label={t("attachment.view")}
								onClick={async () => {
									const url = thumbs[a.id] ?? (await load(a.id));
									if (url) setPreview({ name: a.name, url });
								}}
							>
								<Eye />
							</IconButton>
						)}
						<IconButton
							label={t("attachment.save")}
							onClick={async () => {
								const url = await load(a.id);
								if (url) saveToDevice(a.name, url);
							}}
						>
							<Download />
						</IconButton>
						{onRemove && (
							<IconButton label={`${t("common.delete")} ${a.name}`} onClick={() => onRemove(a.id)}>
								<X />
							</IconButton>
						)}
					</li>
				))}
			</ul>
			<Dialog
				open={!!preview}
				onClose={() => setPreview(null)}
				title={preview?.name ?? ""}
				wide
				actions={
					<>
						<Button variant="bordered" icon={<Download />} onClick={() => preview && saveToDevice(preview.name, preview.url)}>
							{t("attachment.save")}
						</Button>
						<Button onClick={() => setPreview(null)}>{t("common.close")}</Button>
					</>
				}
			>
				{preview && <img src={preview.url} alt={preview.name} className="pm-preview" />}
			</Dialog>
		</>
	);
}

/** "Add attachment" button; reads files as data URLs, enforcing the size limit. */
export function AddAttachmentButton({ onAdd }: { onAdd: (files: Array<{ meta: AttachmentMeta; dataUrl: string }>, tooBig: string[]) => void }) {
	const t = useT();
	const ref = useRef<HTMLInputElement>(null);

	const read = (file: File) =>
		new Promise<string>((resolve, reject) => {
			const r = new FileReader();
			r.onload = () => resolve(String(r.result));
			r.onerror = () => reject(r.error);
			r.readAsDataURL(file);
		});

	return (
		<>
			<div>
				<Button size="sm" variant="bordered" icon={<Paperclip />} onClick={() => ref.current?.click()}>
					{t("attachment.add")}
				</Button>
			</div>
			<input
				ref={ref}
				type="file"
				multiple
				hidden
				onChange={async (e) => {
					const files = [...(e.target.files ?? [])];
					e.target.value = "";
					const ok = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
					const added = await Promise.all(
						ok.map(async (f) => ({
							meta: { id: crypto.randomUUID(), name: f.name, type: f.type || "application/octet-stream", size: f.size },
							dataUrl: await read(f),
						})),
					);
					onAdd(added, files.filter((f) => f.size > MAX_ATTACHMENT_BYTES).map((f) => f.name));
				}}
			/>
		</>
	);
}
