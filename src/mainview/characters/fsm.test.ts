import { describe, expect, test } from "bun:test";
import { BED, COUCH, LANES, LOITER_SPOTS } from "../scene/layout";
import { SlotManager } from "../scene/slots";
import { stateMatchesStatus } from "./character";
import { IDLE_LONG_MS, applyStatus, returnToIdle, startDuelWalk, updateLongIdle, type FsmChar } from "./fsm";

const char = (over: Partial<FsmChar> = {}): FsmChar => ({
	id: "c1",
	pos: { x: 200, y: LANES[2] },
	facing: 1,
	path: [],
	state: "IDLE_STANDING",
	pending: null,
	slot: null,
	desiredStatus: "idle",
	idleSince: 0,
	gone: false,
	...over,
});

/** Put c in its seat of `kind`, the way arrive() leaves a seated character. */
function seat(c: FsmChar, slots: SlotManager, kind: "couch" | "bar" | "bed"): void {
	const s = slots.claimNearest(kind, c.id, c.pos)!;
	c.slot = s;
	c.pos = { ...s.usePos };
	c.state = kind === "couch" ? "WATCHING_TV" : kind === "bar" ? "AT_BAR" : "SLEEPING";
}

describe("DUELING counts as idle", () => {
	test("stateMatchesStatus is true only for idle", () => {
		expect(stateMatchesStatus("DUELING", "idle")).toBe(true);
		expect(stateMatchesStatus("DUELING", "working")).toBe(false);
		expect(stateMatchesStatus("DUELING", "blocked")).toBe(false);
		expect(stateMatchesStatus("DUELING", "unknown")).toBe(false);
	});

	test("applyStatus(idle) leaves a duelist alone", () => {
		const slots = new SlotManager();
		const c = char({ state: "DUELING" });
		applyStatus(c, "idle", slots, 1000);
		expect(c.state).toBe("DUELING");
		expect(c.path).toEqual([]);
	});

	test("applyStatus(working) sends a duelist straight to a desk", () => {
		const slots = new SlotManager();
		const c = char({ state: "DUELING" });
		applyStatus(c, "working", slots, 1000);
		expect(c.state).toBe("WALKING");
		expect(c.pending?.state).toBe("WORKING");
		expect(c.pending?.slot?.kind).toBe("desk");
	});

	test("updateLongIdle never sends a duelist to bed", () => {
		const slots = new SlotManager();
		const c = char({ state: "DUELING" });
		updateLongIdle(c, slots, IDLE_LONG_MS + 1);
		expect(c.state).toBe("DUELING");
		expect(c.path).toEqual([]);
	});
});

describe("startDuelWalk", () => {
	const mark = { x: 180, y: LANES[2] };

	test("from the couch: stands up first, frees the seat, keeps the desk", () => {
		const slots = new SlotManager();
		const c = char({ pos: { x: 60, y: LANES[2] } });
		const desk = slots.claimDesk(c.id)!;
		seat(c, slots, "couch");
		const standPos = c.slot!.standPos;
		startDuelWalk(c, slots, mark);
		expect(c.path[0]).toEqual(standPos);
		expect(c.path[c.path.length - 1]).toEqual(mark);
		expect(c.state).toBe("WALKING");
		expect(c.pending).toEqual({ state: "DUELING", slot: null });
		expect(c.slot).toBeNull();
		expect(slots.held(c.id)).toBeNull();
		expect(slots.ownedDesk(c.id)).toBe(desk.id);
	});

	test("from the bunk: climbs down the ladder before walking", () => {
		const slots = new SlotManager();
		const c = char({ pos: { x: BED.ladderX, y: LANES[0] } });
		seat(c, slots, "bed");
		const lying = { ...c.pos };
		startDuelWalk(c, slots, mark);
		expect(c.path[0]).toEqual({ x: BED.ladderX, y: lying.y });
		expect(c.path[1]).toEqual({ x: BED.ladderX, y: LANES[0] });
		expect(c.path[c.path.length - 1]).toEqual(mark);
	});

	test("already on the mark: arrives immediately", () => {
		const slots = new SlotManager();
		const c = char({ pos: { ...mark } });
		startDuelWalk(c, slots, mark);
		expect(c.path).toEqual([]);
		expect(c.state).toBe("DUELING");
	});
});

describe("returnToIdle", () => {
	test("a short idler goes to the couch", () => {
		const slots = new SlotManager();
		const c = char({ state: "DUELING", idleSince: 0 });
		returnToIdle(c, slots, 1000);
		expect(c.pending?.state).toBe("WATCHING_TV");
		expect(c.pending?.slot?.kind).toBe("couch");
		expect(slots.held(c.id)?.kind).toBe("couch");
	});

	test("a long idler goes back to the bunk", () => {
		const slots = new SlotManager();
		const c = char({ state: "DUELING", idleSince: 0 });
		returnToIdle(c, slots, IDLE_LONG_MS + 1);
		expect(c.pending?.state).toBe("SLEEPING");
		expect(c.pending?.slot?.kind).toBe("bed");
	});

	test("mid-walk: drops the old path and goal", () => {
		const slots = new SlotManager();
		const c = char({ state: "WALKING", path: [{ x: 10, y: 10 }], pending: { state: "DUELING", slot: null } });
		returnToIdle(c, slots, 1000);
		expect(c.pending?.state).not.toBe("DUELING");
		expect(c.path).not.toContainEqual({ x: 10, y: 10 });
	});

	test("falls back when seats are full", () => {
		const slots = new SlotManager();
		for (let i = 0; i < COUCH.seats.length; i++) slots.claimNearest("couch", `couch${i}`, { x: 60, y: 206 });
		for (let i = 0; i < 4; i++) slots.claimNearest("bar", `bar${i}`, { x: 330, y: 206 });
		const c = char({ state: "DUELING" });
		returnToIdle(c, slots, 1000);
		expect(c.pending?.slot?.kind).toBe("loiter");
		expect(LOITER_SPOTS).toContainEqual(c.pending!.slot!.usePos);
	});
});
