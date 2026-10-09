import { describe, expect, test } from "bun:test";
import { fitName, nameRoom } from "./scoreboard";

describe("scoreboard rows", () => {
	test("a short name fits as is", () => {
		expect(fitName("claude", "nexel", 20)).toEqual({ agent: "claude", project: "nexel" });
	});

	test("a long project is cut with a trailing dot to fit agent·project", () => {
		const n = fitName("claude", "perl-fibia-nexel-model", 20);
		expect(`${n.agent}·${n.project}`).toHaveLength(20);
		expect(n.project.endsWith(".")).toBe(true);
	});

	test("a very long agent name is cut too, never overflowing", () => {
		const n = fitName("averyveryverylongagentname", "p", 12);
		expect(`${n.agent}·${n.project}`.length).toBeLessThanOrEqual(12);
	});

	test("name room shrinks as the score grows", () => {
		expect(nameRoom("1-0")).toBeGreaterThan(nameRoom("12-10"));
	});
});
