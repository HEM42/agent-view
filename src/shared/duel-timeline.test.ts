import { describe, expect, test } from "bun:test";
import { duelPhaseAt, duelTimes, type DuelInfo } from "./duel-timeline";

const d: DuelInfo = { id: "d1", a: "A", b: "B", centerX: 200, clashes: 5, winner: "B", startAt: 1000 };
// ignite 9000, clashes 9800..12800, result 12800, retract 15300, end 15600

describe("duelTimes", () => {
	test("derives every instant from startAt", () => {
		const t = duelTimes(d);
		expect(t.igniteAt).toBe(9000);
		expect(t.clashAt(0)).toBe(9800);
		expect(t.clashAt(3)).toBe(11600);
		expect(t.resultAt).toBe(12800);
		expect(t.retractAt).toBe(15300);
		expect(t.endAt).toBe(15600);
	});
	test("accepts a timeline override", () => {
		const t = duelTimes(d, { approachMs: 100, igniteMs: 10, clashMs: 20, resultMs: 30, retractMs: 5 });
		expect(t.igniteAt).toBe(1100);
		expect(t.resultAt).toBe(1110 + 100);
		expect(t.endAt).toBe(1210 + 30 + 5);
	});
});

describe("duelPhaseAt", () => {
	test("phase boundaries are start-inclusive", () => {
		expect(duelPhaseAt(d, 1000).phase).toBe("approach");
		expect(duelPhaseAt(d, 8999).phase).toBe("approach");
		expect(duelPhaseAt(d, 9000).phase).toBe("ignite");
		expect(duelPhaseAt(d, 9799).phase).toBe("ignite");
		expect(duelPhaseAt(d, 9800).phase).toBe("clash");
		expect(duelPhaseAt(d, 12799).phase).toBe("clash");
		expect(duelPhaseAt(d, 12800).phase).toBe("result");
		expect(duelPhaseAt(d, 15299).phase).toBe("result");
		expect(duelPhaseAt(d, 15300).phase).toBe("retract");
		expect(duelPhaseAt(d, 15599).phase).toBe("retract");
	});
	test("over at and after endAt", () => {
		expect(duelPhaseAt(d, 15600).phase).toBe("over");
		expect(duelPhaseAt(d, 99999).phase).toBe("over");
	});
	test("before startAt is still approach", () => {
		expect(duelPhaseAt(d, 0).phase).toBe("approach");
	});
	test("attacker alternates starting with a, with indexes and strike times", () => {
		const p0 = duelPhaseAt(d, 9800);
		expect(p0).toEqual({ phase: "clash", clashIndex: 0, attacker: "A", strikeAt: 10100 });
		expect(duelPhaseAt(d, 10399).clashIndex).toBe(0);
		const p1 = duelPhaseAt(d, 10400);
		expect(p1).toEqual({ phase: "clash", clashIndex: 1, attacker: "B", strikeAt: 10700 });
		expect(duelPhaseAt(d, 11000).attacker).toBe("A");
		expect(duelPhaseAt(d, 12799)).toMatchObject({ clashIndex: 4, attacker: "A" });
	});
	test("non-clash phases carry no attacker or strike", () => {
		expect(duelPhaseAt(d, 12800)).toEqual({ phase: "result", clashIndex: -1, attacker: null, strikeAt: null });
		expect(duelPhaseAt(d, 5000).attacker).toBeNull();
	});
	test("honours a timeline override", () => {
		const tl = { approachMs: 100, igniteMs: 10, clashMs: 20, strikeMs: 5, resultMs: 30, retractMs: 5 };
		expect(duelPhaseAt(d, 1100, tl).phase).toBe("ignite");
		expect(duelPhaseAt(d, 1110, tl)).toMatchObject({ phase: "clash", strikeAt: 1115 });
		expect(duelPhaseAt(d, 1210, tl).phase).toBe("result");
	});
});
