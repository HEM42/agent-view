import { describe, expect, test } from "bun:test";
import {
	HerdrError,
	HerdrPoller,
	interpretHerdrResult,
	type AgentSource,
} from "./herdr-core";

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
});
