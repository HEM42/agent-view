import { describe, expect, test } from "bun:test";
import {
	HerdrError,
	HerdrPoller,
	interpretHerdrResult,
	parseAgentList,
	type AgentSource,
	type RawAgent,
} from "./herdr-core";
import type { Snapshot } from "./types";

const RAW: RawAgent = {
	terminal_id: "t1",
	pane_id: "",
	agent: "claude",
	status: "working",
	cwd: "/x/demo",
	focused: false,
	subagents: [],
};

const OK = JSON.stringify({
	result: {
		agents: [{ terminal_id: "t1", agent: "claude", agent_status: "working", cwd: "/x/demo" }],
	},
});

describe("interpretHerdrResult", () => {
	test("exit 0 parses agents", () => {
		expect(interpretHerdrResult(0, OK)[0]!.terminal_id).toBe("t1");
	});

	test("non-zero exit surfaces the JSON error message", () => {
		const envelope = JSON.stringify({ error: { message: "server not running" } });
		try {
			interpretHerdrResult(1, envelope);
			throw new Error("expected throw");
		} catch (e) {
			expect((e as HerdrError).reason).toBe("server-down");
			expect((e as HerdrError).message).toBe("server not running");
		}
	});

	test("non-zero exit without an envelope reports the exit code", () => {
		try {
			interpretHerdrResult(2, "garbage");
			throw new Error("expected throw");
		} catch (e) {
			expect((e as HerdrError).reason).toBe("server-down");
			expect((e as HerdrError).message).toBe("herdr exited with code 2");
		}
	});
});

describe("HerdrPoller loop", () => {
	test("stop/start leaves exactly one polling loop", async () => {
		let calls = 0;
		const src: AgentSource = {
			list: async () => {
				calls++;
				return [];
			},
			focus: async () => {},
		};
		const p = new HerdrPoller(src, () => {});
		void p.start();
		p.stop();
		void p.start();
		p.stop();
		void p.start();
		await new Promise((r) => setTimeout(r, 1300));
		p.stop();
		// three immediate first ticks, then one follow-up from the surviving loop
		expect(calls).toBe(4);
	});

	test("a tick still awaiting the source when its loop stops changes nothing and emits nothing", async () => {
		const pending: Array<{ ok: (v: RawAgent[]) => void; fail: (e: unknown) => void }> = [];
		const src: AgentSource = {
			list: () => new Promise<RawAgent[]>((ok, fail) => pending.push({ ok, fail })),
			focus: async () => {},
		};
		const snaps: Snapshot[] = [];
		const p = new HerdrPoller(src, (s) => snaps.push(s));
		void p.start();
		await new Promise((r) => setTimeout(r, 5));
		p.stop(); // saver pause while the first poll is out
		pending[0]!.ok([RAW]);
		pending.length = 0;
		await new Promise((r) => setTimeout(r, 5));
		expect(snaps).toEqual([]);
		expect(p.lastSnapshot().herdrOnline).toBe(false);

		void p.start(); // resume: a new loop, its first poll is out too
		await new Promise((r) => setTimeout(r, 5));
		p.stop();
		pending[0]!.fail(new HerdrError("server-down", "late failure"));
		await new Promise((r) => setTimeout(r, 5));
		expect(snaps).toEqual([]); // the late failure neither counts nor emits
	});
});

describe("parseAgentList subagents", () => {
	const feed = (extra: object) =>
		JSON.stringify({
			result: {
				agents: [{ terminal_id: "t1", pane_id: "wV:p2", agent: "claude", agent_status: "working", cwd: "/x/demo", ...extra }],
			},
		});

	test("plain herdr output: pane_id kept, no subagents", () => {
		const [a] = parseAgentList(feed({}));
		expect(a!.pane_id).toBe("wV:p2");
		expect(a!.subagents).toEqual([]);
	});

	test("missing pane_id becomes an empty string", () => {
		const text = JSON.stringify({ result: { agents: [{ terminal_id: "t1", agent: "pi", agent_status: "idle", cwd: "/x" }] } });
		expect(parseAgentList(text)[0]!.pane_id).toBe("");
	});

	test("subagents parse oldest first; malformed entries are skipped", () => {
		const [a] = parseAgentList(
			feed({
				subagents: [
					{ id: "b2", type: "Explore", startedAt: 200 },
					{ id: "a1", type: "general-purpose", startedAt: 100, description: "probe the folder", model: "haiku" },
					{ id: "", type: "x", startedAt: 1 },
					{ type: "no-id", startedAt: 1 },
					{ id: "c3", type: "x", startedAt: "soon" },
					"junk",
				],
			}),
		);
		expect(a!.subagents).toEqual([
			{ id: "a1", type: "general-purpose", startedAt: 100, description: "probe the folder", model: "haiku" },
			{ id: "b2", type: "Explore", startedAt: 200 },
		]);
	});

	test("same startedAt orders by id", () => {
		const [a] = parseAgentList(
			feed({
				subagents: [
					{ id: "z", type: "x", startedAt: 5 },
					{ id: "a", type: "x", startedAt: 5 },
				],
			}),
		);
		expect(a!.subagents.map((s) => s.id)).toEqual(["a", "z"]);
	});

	test("missing type falls back to 'agent'; a non-array field is ignored", () => {
		expect(parseAgentList(feed({ subagents: [{ id: "a", startedAt: 1 }] }))[0]!.subagents[0]!.type).toBe("agent");
		expect(parseAgentList(feed({ subagents: { a: 1 } }))[0]!.subagents).toEqual([]);
	});
});

describe("HerdrPoller subagents", () => {
	test("snapshots carry each agent's subagents", async () => {
		const subs = [{ id: "a1", type: "Explore", startedAt: 1 }];
		const src: AgentSource = {
			list: async () => [
				{
					terminal_id: "t1",
					pane_id: "p",
					agent: "claude",
					status: "working",
					cwd: "/x/demo",
					focused: false,
					subagents: subs,
				},
			],
			focus: async () => {},
		};
		const snaps: Snapshot[] = [];
		const p = new HerdrPoller(src, (s) => snaps.push(s));
		void p.start();
		await new Promise((r) => setTimeout(r, 20));
		p.stop();
		expect(snaps[0]!.agents[0]!.subagents).toEqual(subs);
	});
});
