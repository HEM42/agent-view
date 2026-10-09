import { describe, expect, test } from "bun:test";
import type { Snapshot } from "../shared/types";
import {
	API_VERSION,
	DEFAULT_PORT,
	daemonPort,
	parseClientMessage,
	parseServerMessage,
	worldMessage,
} from "./protocol";

const snap: Snapshot = { herdrOnline: true, agents: [], ts: 5 };

describe("worldMessage", () => {
	test("wraps the snapshot with the api version", () => {
		expect(worldMessage(snap, {})).toEqual({ t: "world", api: API_VERSION, snapshot: snap, world: {} });
	});
});

describe("parseClientMessage", () => {
	test("hello", () => {
		expect(parseClientMessage(`{"t":"hello","client":"app","version":"0.1.0"}`)).toEqual({
			kind: "hello",
			client: "app",
			version: "0.1.0",
		});
	});

	test("hello with missing fields is invalid", () => {
		expect(parseClientMessage(`{"t":"hello","client":"app"}`)).toEqual({ kind: "invalid", error: "bad hello" });
	});

	test("request keeps its args without t and id", () => {
		expect(parseClientMessage(`{"t":"focus","id":"7","agent":"term_1"}`)).toEqual({
			kind: "request",
			t: "focus",
			id: "7",
			args: { agent: "term_1" },
		});
	});

	test("not JSON", () => {
		expect(parseClientMessage("{nope")).toEqual({ kind: "invalid", error: "not json" });
	});

	test("JSON that is not an object", () => {
		expect(parseClientMessage("[1,2]")).toEqual({ kind: "invalid", error: "not an object" });
		expect(parseClientMessage("null")).toEqual({ kind: "invalid", error: "not an object" });
	});

	test("missing t keeps the id so the daemon can answer", () => {
		expect(parseClientMessage(`{"id":"9"}`)).toEqual({ kind: "invalid", error: "missing t", id: "9" });
	});

	test("a request without a string id is invalid and unanswerable", () => {
		expect(parseClientMessage(`{"t":"focus","id":3}`)).toEqual({ kind: "invalid", error: "request without id" });
	});
});

describe("parseServerMessage", () => {
	test("world", () => {
		expect(parseServerMessage(JSON.stringify(worldMessage(snap, {})))).toEqual({ kind: "world", snapshot: snap, world: {} });
	});

	test("world from another api version", () => {
		expect(parseServerMessage(`{"t":"world","api":2,"snapshot":{},"world":{}}`)).toEqual({ kind: "incompatible", api: 2 });
	});

	test("world with a broken snapshot is invalid", () => {
		expect(parseServerMessage(`{"t":"world","api":1,"snapshot":{"agents":3},"world":{}}`)).toEqual({ kind: "invalid" });
	});

	test("reply", () => {
		expect(parseServerMessage(`{"t":"reply","id":"4","ok":false,"error":"nope"}`)).toEqual({
			kind: "reply",
			reply: { t: "reply", id: "4", ok: false, error: "nope" },
		});
	});

	test("garbage", () => {
		expect(parseServerMessage("{")).toEqual({ kind: "invalid" });
		expect(parseServerMessage(`{"t":"reply","id":4,"ok":true}`)).toEqual({ kind: "invalid" });
	});
});

describe("daemonPort", () => {
	test("default", () => {
		expect(daemonPort({})).toBe(DEFAULT_PORT);
	});

	test("override", () => {
		expect(daemonPort({ AGENT_VIEW_PORT: "50000" })).toBe(50000);
	});

	test("nonsense falls back to the default", () => {
		for (const v of ["", "abc", "0", "70000", "12.5", "-1"]) {
			expect(daemonPort({ AGENT_VIEW_PORT: v })).toBe(DEFAULT_PORT);
		}
	});
});
