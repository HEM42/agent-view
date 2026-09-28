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
