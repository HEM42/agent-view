import { describe, expect, test } from "bun:test";
import { BOARD, CROWN, fitName, headerLayout, nameRoom } from "./scoreboard";
import { textWidth } from "./font3x5";

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

describe("scoreboard header with a champion", () => {
	const PAD = 3;
	const who = (agent: string, project: string) => ({ agent, project });

	test("the crown is five pixels wide on every row", () => {
		expect(CROWN.length).toBeGreaterThanOrEqual(4);
		expect(CROWN.length).toBeLessThanOrEqual(5);
		for (const r of CROWN) expect(r).toHaveLength(5);
	});

	test("a short name sits right-aligned, the crown one pixel before it", () => {
		const l = headerLayout(who("claude", "nexel"))!;
		expect(l.name).toEqual({ agent: "claude", project: "nexel" });
		expect(l.nameX + l.nameW).toBe(BOARD.w - PAD);
		expect(l.nameW).toBe(textWidth("claude·nexel"));
		expect(l.crownX + 5 + 1).toBe(l.nameX);
	});

	test("a long name is cut so it never reaches DUELS", () => {
		const l = headerLayout(who("averyveryverylongagentname", "perl-fibia-nexel-model"))!;
		expect(l.nameW).toBeLessThanOrEqual(BOARD.w - PAD * 2 - textWidth("duels") - 3 - 5 - 1);
		expect(l.crownX).toBeGreaterThanOrEqual(PAD + textWidth("duels") + 3);
		expect(l.name.agent.length + 1 + l.name.project.length).toBeLessThanOrEqual(l.maxChars);
		expect(l.name.project.endsWith(".") || l.name.agent.endsWith(".")).toBe(true);
	});

	test("names are lower-cased and no champion means no layout", () => {
		expect(headerLayout(who("Claude", "NEXEL"))!.name).toEqual({ agent: "claude", project: "nexel" });
		expect(headerLayout(null)).toBeNull();
	});
});
