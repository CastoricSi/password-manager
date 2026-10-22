// Google's file picker. With the drive.file scope, a book someone shared with
// the user becomes accessible to this app once the user picks it here — so
// accepting a share is "click Add, confirm once in Google's window".

type PickerResult = { action: string; docs?: Array<{ id: string }> };

/** The parts of google.picker we use (loaded at runtime from apis.google.com). */
type PickerApi = {
	DocsView: new (viewId?: string) => {
		setMimeTypes(m: string): PickerView;
		setIncludeFolders(b: boolean): PickerView;
		setFileIds?(ids: string): PickerView;
		setOwnedByMe(b: boolean): PickerView;
		setMode(m: string): PickerView;
	};
	PickerBuilder: new () => PickerBuilder;
	ViewId: { DOCS: string };
	DocsViewMode: { LIST: string };
	Action: { PICKED: string; CANCEL: string };
	Feature: { MULTISELECT_ENABLED: string };
};
type PickerView = InstanceType<PickerApi["DocsView"]>;
type PickerBuilder = {
	addView(v: PickerView): PickerBuilder;
	setOAuthToken(t: string): PickerBuilder;
	setDeveloperKey(k: string): PickerBuilder;
	setAppId(id: string): PickerBuilder;
	setTitle(t: string): PickerBuilder;
	setLocale(l: string): PickerBuilder;
	enableFeature(f: string): PickerBuilder;
	setCallback(cb: (r: PickerResult) => void): PickerBuilder;
	build(): { setVisible(v: boolean): void };
};

declare global {
	interface Window {
		gapi?: { load(name: string, opts: { callback: () => void; onerror?: () => void }): void };
		google?: { picker?: PickerApi };
	}
}

let loading: Promise<PickerApi> | null = null;

function loadPicker(): Promise<PickerApi> {
	return (loading ??= new Promise<PickerApi>((resolve, reject) => {
		const ready = () => window.gapi!.load("picker", { callback: () => resolve(window.google!.picker!), onerror: reject });
		if (window.gapi) return ready();
		const script = document.createElement("script");
		script.src = "https://apis.google.com/js/api.js";
		script.async = true;
		script.onload = ready;
		script.onerror = () => reject(new Error("picker failed to load"));
		document.head.appendChild(script);
	}).catch((e) => {
		loading = null;
		throw e;
	}));
}

/**
 * Opens the picker. With `fileIds`, only those files are offered (already
 * "selected" for the user); otherwise the user's shared-with-me JSON files.
 * Resolves the picked file ids ([] if cancelled).
 */
export async function pickSharedBooks(opts: {
	token: string;
	apiKey: string;
	appId: string;
	title: string;
	locale: string;
	fileIds?: string[];
}): Promise<string[]> {
	const picker = await loadPicker();
	let view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes("application/json").setIncludeFolders(false).setMode(picker.DocsViewMode.LIST);
	if (opts.fileIds?.length && view.setFileIds) view = view.setFileIds(opts.fileIds.join(","));
	else view = view.setOwnedByMe(false);

	return new Promise((resolve) => {
		new picker.PickerBuilder()
			.addView(view)
			.setOAuthToken(opts.token)
			.setDeveloperKey(opts.apiKey)
			.setAppId(opts.appId)
			.setTitle(opts.title)
			.setLocale(opts.locale)
			.enableFeature(picker.Feature.MULTISELECT_ENABLED)
			.setCallback((r) => {
				if (r.action === picker.Action.PICKED) resolve((r.docs ?? []).map((d) => d.id));
				else if (r.action === picker.Action.CANCEL) resolve([]);
			})
			.build()
			.setVisible(true);
	});
}
