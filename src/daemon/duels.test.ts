import { describe, expect, test } from "bun:test";
import { duelTimes } from "../shared/duel-timeline";
import type { AgentView } from "../shared/types";
import { DuelReferee } from "./duels";

const agent = (id: string, over: Partial<AgentView> = {}): AgentView => ({
	id,
	agent: "claude",
	status: "idle",
	project: "proj",
	focused: false,
	subagents: [],
	...over,
});

const GAP = 20_000;
const IDLE = 10_000;
// rng() === 0: first gap is gapMin, first agent picked, clashes 5, winner a
const mk = (rng: () => number = () => 0) => new DuelReferee({ rng, gapMin: GAP, gapMax: 60_000, eligibleIdleMs: IDLE });

/** Two agents idle since t=0, referee has seen them become eligible at t=IDLE. */
function ready(r: DuelReferee, agents = [agent("A"), agent("B")]) {
	r.update(agents, 0);
	r.update(agents, IDLE); // eligible now: gap clock starts here
	return { agents, startAt: IDLE + GAP };
}

describe("DuelReferee start rules", () => {
	test("no duel with fewer than 2 eligible agents", () => {
		const r = mk();
		const one = [agent("A")];
		for (let t = 0; t <= 200_000; t += 5000) r.update(one, t);
		expect(r.current()).toBeNull();
	});
	test("no duel before the gap", () => {
		const r = mk();
		const { agents, startAt } = ready(r);
		r.update(agents, startAt - 1);
		expect(r.current()).toBeNull();
	});
	test("no duel before 10 s of idle", () => {
		const r = mk();
		const agents = [agent("A"), agent("B")];
		r.update(agents, 0);
		r.update(agents, IDLE - 1);
		// the gap clock starts only once both are eligible, not at the first sighting
		r.update(agents, 100_000);
		expect(r.current()).toBeNull();
		r.update(agents, 100_000 + GAP - 1);
		expect(r.current()).toBeNull();
		r.update(agents, 100_000 + GAP);
		expect(r.current()).not.toBeNull();
	});
	test("an agent that was working only counts from when it went idle", () => {
		const r = mk();
		r.update([agent("A", { status: "working" }), agent("B")], 0);
		r.update([agent("A"), agent("B")], 5000); // A idle since 5000, eligible at 15000
		r.update([agent("A"), agent("B")], 14_999);
		r.update([agent("A"), agent("B")], 30_000); // gap clock starts here
		r.update([agent("A"), agent("B")], 30_000 + GAP - 1);
		expect(r.current()).toBeNull();
		r.update([agent("A"), agent("B")], 30_000 + GAP);
		expect(r.current()).not.toBeNull();
	});
	test("a duel starts with valid fields", () => {
		const r = mk();
		const { agents, startAt } = ready(r, [agent("A"), agent("B"), agent("C")]);
		r.update(agents, startAt);
		const d = r.current()!;
		expect(d).not.toBeNull();
		expect(d.a).not.toBe(d.b);
		expect(["A", "B", "C"]).toContain(d.a);
		expect(["A", "B", "C"]).toContain(d.b);
		expect(d.centerX).toBeGreaterThanOrEqual(150);
		expect(d.centerX).toBeLessThanOrEqual(240);
		expect(d.clashes).toBe(5);
		expect([d.a, d.b]).toContain(d.winner);
		expect(d.startAt).toBe(startAt);
		expect(d.id).toBeTruthy();
	});
	test("clashes and centerX follow rng", () => {
		const r = mk(() => 0.999);
		const { agents, startAt } = ready(r);
		r.update(agents, startAt + 60_000);
		const d = r.current()!;
		expect(d.clashes).toBe(10);
		expect(d.centerX).toBe(240);
	});
	test("only one duel at a time", () => {
		const r = mk();
		const { agents, startAt } = ready(r, [agent("A"), agent("B"), agent("C"), agent("D")]);
		r.update(agents, startAt);
		const first = r.current()!;
		r.update(agents, startAt + 1000);
		r.update(agents, startAt + 100_000 - 90_000);
		expect(r.current()).toBe(first);
		expect(r.current()!.id).toBe(first.id);
	});
});

describe("DuelReferee cancel and result", () => {
	function running() {
		const r = mk();
		const { agents, startAt } = ready(r);
		r.update(agents, startAt);
		const d = r.current()!;
		return { r, agents, d, times: duelTimes(d) };
	}
	test("a status change before the result cancels without a result", () => {
		const { r, d, times } = running();
		r.update([agent(d.a, { status: "working" }), agent(d.b)], d.startAt + 1000);
		expect(r.current()).toBeNull();
		r.update([agent(d.a), agent(d.b)], times.resultAt + 1);
		expect(r.drainResults()).toEqual([]);
	});
	test("a missing fighter cancels", () => {
		const { r, d } = running();
		r.update([agent(d.a)], d.startAt + 1000);
		expect(r.current()).toBeNull();
		expect(r.drainResults()).toEqual([]);
	});
	test("a status change right after the result still gives one result, with the current identity", () => {
		const { r, d, times } = running();
		const loser = d.winner === d.a ? d.b : d.a;
		r.update([agent(d.a), agent(d.b)], times.resultAt - 1);
		r.update(
			[agent(d.winner, { project: "new" }), agent(loser, { status: "working" })],
			times.resultAt,
		);
		const out = r.drainResults();
		expect(out).toHaveLength(1);
		expect(out[0]!.winner.id).toBe(d.winner);
		expect(out[0]!.winner.project).toBe("new");
		expect(out[0]!.loser.id).toBe(loser);
		expect(r.current()).not.toBeNull(); // stays until endAt
	});
	test("a status change after the result does not cancel", () => {
		const { r, d, times } = running();
		r.update([agent(d.a), agent(d.b)], times.resultAt);
		r.drainResults();
		r.update([agent(d.a, { status: "working" }), agent(d.b)], times.resultAt + 500);
		expect(r.current()).not.toBeNull();
		expect(r.drainResults()).toEqual([]);
	});
	test("the result fires once and drains empty", () => {
		const { r, d, times } = running();
		const ag = [agent(d.a), agent(d.b)];
		r.update(ag, times.resultAt);
		r.update(ag, times.resultAt + 100);
		r.update(ag, times.resultAt + 200);
		expect(r.drainResults()).toHaveLength(1);
		expect(r.drainResults()).toEqual([]);
	});
	test("no result before resultAt", () => {
		const { r, d, times } = running();
		r.update([agent(d.a), agent(d.b)], times.resultAt - 1);
		expect(r.drainResults()).toEqual([]);
	});
	test("the duel clears at endAt and the next one needs a new gap", () => {
		const { r, d, times } = running();
		const ag = [agent(d.a), agent(d.b)];
		r.update(ag, times.endAt - 1);
		expect(r.current()).not.toBeNull();
		r.update(ag, times.endAt);
		expect(r.current()).toBeNull();
		r.update(ag, times.endAt + GAP - 1);
		expect(r.current()).toBeNull();
		r.update(ag, times.endAt + GAP);
		const next = r.current()!;
		expect(next).not.toBeNull();
		expect(next.id).not.toBe(d.id);
	});
	test("a timeline override shortens the duel", () => {
		const timeline = { approachMs: 10, igniteMs: 10, clashMs: 10, strikeMs: 5, resultMs: 10, retractMs: 10 };
		const r = new DuelReferee({ rng: () => 0, gapMin: 0, gapMax: 0, eligibleIdleMs: 0, timeline });
		const ag = [agent("A"), agent("B")];
		r.update(ag, 0);
		r.update(ag, 1);
		const d = r.current()!;
		expect(d).not.toBeNull();
		const t = duelTimes(d, timeline);
		expect(t.endAt - d.startAt).toBe(10 + 10 + 50 + 10 + 10);
		r.update(ag, t.resultAt);
		expect(r.drainResults()).toHaveLength(1);
	});
});
