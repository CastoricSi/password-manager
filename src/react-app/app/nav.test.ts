import { describe, expect, it } from "vitest";

import { parseRoute, routeHref, type Route } from "./nav";

const roundTrip = (r: Route) => {
	const href = routeHref(r);
	const [path, search = ""] = href.split("?");
	return parseRoute(path, search ? `?${search}` : "");
};

describe("routes", () => {
	it("round-trips every place", () => {
		const places: Route[] = [
			{},
			{ start: "new" },
			{ start: "mode" },
			{ book: "b1" },
			{ book: "b1", cat: "c1" },
			{ book: "b1", entry: "e1" },
			{ book: "b1", entry: "new", cat: "c1" },
			{ book: "b1", entry: "e1", settings: "account" },
			{ book: "b1", dialog: "newbook" },
			{ book: "b1", trash: true },
		];
		for (const r of places) expect(roundTrip(r)).toEqual(r);
	});

	it("builds readable URLs", () => {
		expect(routeHref({})).toBe("/");
		expect(routeHref({ book: "b1", entry: "e1", cat: "c1" })).toBe("/b/b1/e/e1?c=c1");
		expect(routeHref({ book: "b1", entry: "new" })).toBe("/b/b1/new");
		expect(routeHref({ book: "b1", trash: true })).toBe("/b/b1/trash");
		expect(routeHref({ book: "b1", settings: "general" })).toBe("/b/b1?settings=general");
	});

	it("ignores what doesn't belong", () => {
		expect(parseRoute("/b/b1", "?settings=nonsense")).toEqual({ book: "b1" });
		expect(parseRoute("/", "?settings=general&c=x")).toEqual({});
		expect(parseRoute("/whatever/else", "")).toEqual({});
		expect(parseRoute("/b", "")).toEqual({});
		// overlays and categories need a book
		expect(routeHref({ start: "new", settings: "help", cat: "c" })).toBe("/new");
	});

	it("escapes ids", () => {
		const r = { book: "a/b c", entry: "x?y" };
		expect(routeHref(r)).toBe("/b/a%2Fb%20c/e/x%3Fy");
		expect(roundTrip(r)).toEqual(r);
	});
});
