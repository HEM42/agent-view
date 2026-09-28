import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { FakeSource } from "./fake";
import { HerdrError } from "./herdr-core";

const T0 = new Date("2026-01-01T00:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

afterEach(() => {
	setSystemTime(); // back to the real clock
});

describe("FakeSource outage", () => {
	test("default: the scripted 60-64s outage throws server-down", async () => {
		setSystemTime(T0);
		const src = new FakeSource("1");
		setSystemTime(at(61));
		await expect(src.list()).rejects.toBeInstanceOf(HerdrError);
	});

	test("outage: false keeps serving agents through the outage window", async () => {
		setSystemTime(T0);
		const src = new FakeSource("1", { outage: false });
		setSystemTime(at(61));
		expect((await src.list()).length).toBeGreaterThan(0);
	});
});

describe("FakeSource subagent scenes", () => {
	const subsAt = async (s: number) => {
		setSystemTime(T0);
		const src = new FakeSource("1");
		setSystemTime(at(s));
		return (await src.list()).map((a) => a.subagents);
	};

	test("background: agent 0 keeps 2 subagents after it goes idle at 5s", async () => {
		const list = await subsAt(10);
		expect(list[0]!.map((s) => s.id)).toEqual(["fake_sub_bg0", "fake_sub_bg1"]);
		expect(list[0]![0]!.startedAt).toBe(T0.getTime() + 2000);
		expect(list[0]![0]!.description).toBe("Implement Task 5: bridge reads feed");
	});

	test("burst: agent 2 has 8 subagents at 24s (6 drones + 2), 6 left at 34s, none at 50s", async () => {
		expect((await subsAt(24))[2]).toHaveLength(8);
		expect((await subsAt(34))[2]).toHaveLength(6);
		expect((await subsAt(50))[2]).toHaveLength(0);
	});

	test("the second loop's startedAt moves with the loop", async () => {
		setSystemTime(T0);
		const src = new FakeSource("1");
		setSystemTime(at(90 + 10));
		expect((await src.list())[0]!.subagents[0]!.startedAt).toBe(T0.getTime() + 92_000);
	});
});
