import { describe, expect, test } from "bun:test";
import { HerdrError, HerdrPoller, type AgentSource, type RawAgent } from "../shared/herdr-core";
import { DEMO_AFTER, LiveOrDemoSource, NativeHerdrSource, type Bridge, type BridgeReply } from "./source";

const agent = (id: string): RawAgent => ({
	terminal_id: id,
	agent: "claude",
	status: "working",
	cwd: "/x/demo",
	focused: false,
});
const LIVE = [agent("term_live")];
const DEMO = [agent("fake_term_0")];
const down = new HerdrError("server-down", "boom");
const gone = new HerdrError("not-installed", "ENOENT");

const demoSource: AgentSource = { list: async () => DEMO, focus: async () => {} };

function scripted(script: Array<RawAgent[] | HerdrError>): AgentSource {
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

const bridgeOf = (reply: () => Promise<BridgeReply>): Bridge => ({ list: reply });
const OK_STDOUT = JSON.stringify({
	result: {
		agents: [{ terminal_id: "t1", agent: "pi", agent_status: "idle", cwd: "/x/nordlink" }],
	},
});

async function reasonOf(p: Promise<unknown>): Promise<string> {
	try {
		await p;
		return "resolved";
	} catch (e) {
		return (e as HerdrError).reason;
	}
}

describe("NativeHerdrSource", () => {
	test("exit 0 reply parses agents", async () => {
		const src = new NativeHerdrSource(bridgeOf(async () => ({ code: 0, stdout: OK_STDOUT })));
		const agents = await src.list();
		expect(agents[0]!.terminal_id).toBe("t1");
		expect(agents[0]!.status).toBe("idle");
	});

	test("missing reply maps to not-installed", async () => {
		const src = new NativeHerdrSource(bridgeOf(async () => ({ error: "missing" })));
		expect(await reasonOf(src.list())).toBe("not-installed");
	});

	test("stale reply maps to server-down", async () => {
		const src = new NativeHerdrSource(bridgeOf(async () => ({ error: "stale" })));
		expect(await reasonOf(src.list())).toBe("server-down");
	});

	test("unreadable reply maps to server-down", async () => {
		const src = new NativeHerdrSource(
			bridgeOf(async () => ({ error: "unreadable", message: "Operation not permitted" })),
		);
		expect(await reasonOf(src.list())).toBe("server-down");
	});

	test("non-zero exit maps to server-down", async () => {
		const src = new NativeHerdrSource(bridgeOf(async () => ({ code: 1, stdout: "" })));
		expect(await reasonOf(src.list())).toBe("server-down");
	});

	test("bridge that never replies times out as server-down", async () => {
		const src = new NativeHerdrSource(
			bridgeOf(() => new Promise(() => {})),
			20,
		);
		expect(await reasonOf(src.list())).toBe("server-down");
	});

	test("bridge rejection maps to server-down", async () => {
		const src = new NativeHerdrSource(bridgeOf(async () => Promise.reject(new Error("xpc died"))));
		expect(await reasonOf(src.list())).toBe("server-down");
	});
});

describe("LiveOrDemoSource", () => {
	test("no live source: demo from the first tick", async () => {
		const s = new LiveOrDemoSource(null, demoSource);
		expect(await s.list()).toEqual(DEMO);
		expect(s.isDemo).toBe(true);
	});

	test("live never succeeded: first failure goes straight to demo", async () => {
		const s = new LiveOrDemoSource(scripted([down]), demoSource);
		expect(s.isDemo).toBe(false);
		expect(await s.list()).toEqual(DEMO);
		expect(s.isDemo).toBe(true);
	});

	test("after live data, failures below DEMO_AFTER rethrow, then demo", async () => {
		const script: Array<RawAgent[] | HerdrError> = [LIVE];
		for (let i = 0; i < DEMO_AFTER; i++) script.push(down);
		const s = new LiveOrDemoSource(scripted(script), demoSource);
		expect(await s.list()).toEqual(LIVE);
		for (let i = 1; i < DEMO_AFTER; i++) {
			expect(await reasonOf(s.list())).toBe("server-down");
			expect(s.isDemo).toBe(false);
		}
		expect(await s.list()).toEqual(DEMO);
		expect(s.isDemo).toBe(true);
	});

	test("not-installed skips the grace window", async () => {
		const s = new LiveOrDemoSource(scripted([LIVE, gone]), demoSource);
		await s.list();
		expect(await s.list()).toEqual(DEMO);
		expect(s.isDemo).toBe(true);
	});

	test("first live success leaves demo immediately", async () => {
		const s = new LiveOrDemoSource(scripted([down, LIVE]), demoSource);
		expect(await s.list()).toEqual(DEMO);
		expect(await s.list()).toEqual(LIVE);
		expect(s.isDemo).toBe(false);
	});

	test("reset() after live data forgets it: the next failure goes straight to demo", async () => {
		const s = new LiveOrDemoSource(scripted([LIVE, down]), demoSource);
		expect(await s.list()).toEqual(LIVE);
		s.reset();
		expect(await s.list()).toEqual(DEMO);
		expect(s.isDemo).toBe(true);
	});

	test("a live list() that was in flight at reset() does not bring its live streak back", async () => {
		let release!: (v: RawAgent[]) => void;
		let calls = 0;
		const live: AgentSource = {
			list: () => (++calls === 1 ? new Promise<RawAgent[]>((r) => (release = r)) : Promise.reject(down)),
			focus: async () => {},
		};
		const s = new LiveOrDemoSource(live, demoSource);
		const pending = s.list();
		s.reset(); // the saver paused while the bridge call was out
		release(LIVE);
		await pending;
		expect(await s.list()).toEqual(DEMO); // no grace window from pre-pause data
		expect(s.isDemo).toBe(true);
	});

	test("poller over LiveOrDemoSource never reports offline", async () => {
		const live = scripted([down, LIVE, down, down, down, down, gone, LIVE, down, LIVE]);
		const p = new HerdrPoller(new LiveOrDemoSource(live, demoSource), () => {});
		for (let i = 0; i < 10; i++) {
			// @ts-expect-error reaching into private tick for deterministic tests
			await p.tick();
			expect(p.lastSnapshot().herdrOnline).toBe(true);
		}
	});
});
