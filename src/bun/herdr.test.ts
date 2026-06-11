import { describe, expect, test } from "bun:test";
import type { Snapshot } from "../shared/types";
import {
	HerdrError,
	HerdrPoller,
	basenameOf,
	normalizeStatus,
	parseAgentList,
	type AgentSource,
	type RawAgent,
} from "./herdr";

// Captured from a real `herdr agent list` on this machine (herdr 0.6.8).
const REAL_OUTPUT = JSON.stringify({
	id: "cli:agent:list",
	result: {
		agents: [
			{
				agent: "claude",
				agent_session: { agent: "claude", kind: "id", source: "herdr:claude", value: "fcbff396" },
				agent_status: "working",
				cwd: "/Users/john/Projects/nordlink",
				focused: false,
				foreground_cwd: "/Users/john/Projects/nordlink",
				pane_id: "w653e1c7d189ff12-1",
				revision: 0,
				tab_id: "w653e1c7d189ff12:1",
				terminal_id: "term_653e1c7d189fc1f",
				workspace_id: "w653e1c7d189ff12",
			},
			{
				agent: "pi",
				agent_status: "idle",
				cwd: "/Users/john/Projects/nordlink",
				focused: true,
				pane_id: "w653e1c7d189ff12-2",
				terminal_id: "term_653f6ff66592b24",
			},
		],
		type: "agent_list",
	},
});

const ERROR_ENVELOPE = JSON.stringify({
	error: { code: "agent_not_found", message: "no such agent" },
	id: "cli:agent:get",
});

describe("parseAgentList", () => {
	test("parses real herdr output", () => {
		const agents = parseAgentList(REAL_OUTPUT);
		expect(agents).toHaveLength(2);
		expect(agents[0]).toEqual({
			terminal_id: "term_653e1c7d189fc1f",
			agent: "claude",
			status: "working",
			cwd: "/Users/john/Projects/nordlink",
			focused: false,
		});
		expect(agents[1]!.status).toBe("idle");
		expect(agents[1]!.focused).toBe(true);
	});

	test("throws server-down on JSON error envelope", () => {
		expect(() => parseAgentList(ERROR_ENVELOPE)).toThrow(HerdrError);
		try {
			parseAgentList(ERROR_ENVELOPE);
		} catch (e) {
			expect((e as HerdrError).reason).toBe("server-down");
			expect((e as HerdrError).message).toBe("no such agent");
		}
	});

	test("throws protocol-error on non-JSON", () => {
		try {
			parseAgentList("zsh: command not found");
		} catch (e) {
			expect((e as HerdrError).reason).toBe("protocol-error");
		}
	});

	test("throws protocol-error on missing agents array", () => {
		try {
			parseAgentList(JSON.stringify({ id: "x", result: { type: "other" } }));
		} catch (e) {
			expect((e as HerdrError).reason).toBe("protocol-error");
		}
	});

	test("skips entries without terminal_id, keeps the rest", () => {
		const agents = parseAgentList(
			JSON.stringify({
				result: {
					agents: [
						{ agent: "claude", agent_status: "working" }, // no terminal_id
						{ agent: "pi", agent_status: "idle", terminal_id: "t1", cwd: "/x" },
					],
				},
			}),
		);
		expect(agents).toHaveLength(1);
		expect(agents[0]!.terminal_id).toBe("t1");
	});
});

describe("normalizeStatus", () => {
	test("passes valid statuses through", () => {
		expect(normalizeStatus("working")).toBe("working");
		expect(normalizeStatus("idle")).toBe("idle");
		expect(normalizeStatus("blocked")).toBe("blocked");
	});
	test("maps done to idle", () => {
		expect(normalizeStatus("done")).toBe("idle");
	});
	test("maps version drift to unknown", () => {
		expect(normalizeStatus("pondering")).toBe("unknown");
		expect(normalizeStatus(undefined)).toBe("unknown");
		expect(normalizeStatus(42)).toBe("unknown");
	});
});

describe("basenameOf", () => {
	test("takes the last path segment", () => {
		expect(basenameOf("/Users/john/Projects/nordlink")).toBe("nordlink");
		expect(basenameOf("/Users/john/Projects/nordlink/")).toBe("nordlink");
		expect(basenameOf("")).toBe("?");
		expect(basenameOf("/")).toBe("/");
	});
});

describe("HerdrPoller.debounceStatus", () => {
	function makePoller(): HerdrPoller {
		const source: AgentSource = {
			list: async () => [],
			focus: async () => {},
		};
		return new HerdrPoller(source, () => {});
	}

	test("new agent gets its first status instantly", () => {
		const p = makePoller();
		expect(p.debounceStatus("a", "working")).toBe("working");
	});

	test("suppresses a one-tick flicker", () => {
		const p = makePoller();
		p.debounceStatus("a", "working");
		expect(p.debounceStatus("a", "idle")).toBe("working"); // tick 1: pending
		expect(p.debounceStatus("a", "working")).toBe("working"); // flicker over
		expect(p.debounceStatus("a", "working")).toBe("working");
	});

	test("confirms a sustained change after 2 ticks", () => {
		const p = makePoller();
		p.debounceStatus("a", "working");
		expect(p.debounceStatus("a", "idle")).toBe("working"); // pending tick 1
		expect(p.debounceStatus("a", "idle")).toBe("idle"); // confirmed tick 2
	});

	test("blocked is confirmed immediately", () => {
		const p = makePoller();
		p.debounceStatus("a", "working");
		expect(p.debounceStatus("a", "blocked")).toBe("blocked");
	});

	test("leaving blocked is debounced like any other change", () => {
		const p = makePoller();
		p.debounceStatus("a", "blocked");
		expect(p.debounceStatus("a", "working")).toBe("blocked"); // pending
		expect(p.debounceStatus("a", "working")).toBe("working"); // confirmed
	});

	test("pending change resets if a different status appears", () => {
		const p = makePoller();
		p.debounceStatus("a", "working");
		expect(p.debounceStatus("a", "idle")).toBe("working"); // pending idle:1
		expect(p.debounceStatus("a", "unknown")).toBe("working"); // pending unknown:1
		expect(p.debounceStatus("a", "unknown")).toBe("unknown"); // confirmed
	});
});

describe("HerdrPoller offline state machine", () => {
	function scriptedSource(script: Array<RawAgent[] | HerdrError>): AgentSource {
		let i = 0;
		return {
			list: async () => {
				const step = script[Math.min(i++, script.length - 1)]!;
				if (step instanceof HerdrError) throw step;
				return step;
			},
			focus: async () => {},
		};
	}

	const agent = (id: string, status: RawAgent["status"]): RawAgent => ({
		terminal_id: id,
		agent: "claude",
		status,
		cwd: "/Users/john/Projects/demo",
		focused: false,
	});

	async function runTicks(p: HerdrPoller, n: number): Promise<Snapshot[]> {
		const out: Snapshot[] = [];
		for (let i = 0; i < n; i++) {
			// @ts-expect-error reaching into private tick for deterministic tests
			await p.tick();
			out.push(p.lastSnapshot());
		}
		return out;
	}

	test("grace window: 1-2 failures re-emit last good data as online", async () => {
		const src = scriptedSource([
			[agent("t1", "working")],
			new HerdrError("server-down", "boom"),
			new HerdrError("server-down", "boom"),
			[agent("t1", "working")],
		]);
		const p = new HerdrPoller(src, () => {});
		const snaps = await runTicks(p, 4);
		expect(snaps[0]!.herdrOnline).toBe(true);
		expect(snaps[1]!.herdrOnline).toBe(true); // grace
		expect(snaps[1]!.agents).toHaveLength(1);
		expect(snaps[2]!.herdrOnline).toBe(true); // still grace
		expect(snaps[3]!.herdrOnline).toBe(true); // recovered
	});

	test("3 consecutive failures flip to offline with reason", async () => {
		const src = scriptedSource([
			[agent("t1", "working")],
			new HerdrError("server-down", "boom"),
			new HerdrError("server-down", "boom"),
			new HerdrError("server-down", "boom"),
		]);
		const p = new HerdrPoller(src, () => {});
		const snaps = await runTicks(p, 4);
		expect(snaps[3]!.herdrOnline).toBe(false);
		expect(snaps[3]!.offlineReason).toBe("server-down");
		expect(snaps[3]!.agents).toHaveLength(0);
	});

	test("not-installed goes offline immediately", async () => {
		const src = scriptedSource([new HerdrError("not-installed", "ENOENT")]);
		const p = new HerdrPoller(src, () => {});
		const snaps = await runTicks(p, 1);
		expect(snaps[0]!.herdrOnline).toBe(false);
		expect(snaps[0]!.offlineReason).toBe("not-installed");
	});

	test("recovery after offline is immediate and debounce is fresh", async () => {
		const err = new HerdrError("server-down", "boom");
		const src = scriptedSource([
			[agent("t1", "working")],
			err,
			err,
			err,
			[agent("t1", "idle")],
		]);
		const p = new HerdrPoller(src, () => {});
		const snaps = await runTicks(p, 5);
		expect(snaps[3]!.herdrOnline).toBe(false);
		expect(snaps[4]!.herdrOnline).toBe(true);
		// debounce map was cleared: first status after reconnect is instant
		expect(snaps[4]!.agents[0]!.status).toBe("idle");
	});

	test("focusAgent validates against known ids", async () => {
		const src = scriptedSource([[agent("t1", "working")]]);
		const p = new HerdrPoller(src, () => {});
		await runTicks(p, 1);
		expect((await p.focus("nope")).ok).toBe(false);
		expect((await p.focus("t1")).ok).toBe(true);
	});
});
