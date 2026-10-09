import { describe, expect, test } from "bun:test";
import { animFor, stateMatchesStatus, type Character } from "./characters/character";
import { applyStatus, arrive, IDLE_LONG_MS } from "./characters/fsm";
import { step } from "./characters/locomotion";
import {
	APPROACH_TIMEOUT_MS,
	BLADE_LEN,
	BLADE_RAMP_MS,
	DEMO_GAP_MS,
	DuelDirector,
	GAP_MAX_MS,
	GAP_MIN_MS,
	KNOCKBACK,
	MAX_CLASHES,
	MIN_CLASHES,
	bladeLength,
	bladeTip,
	clashPoint,
	gripPoint,
	isEligible,
	type DuelPose,
	type Duelist,
} from "./duels";
import { LANES } from "./scene/layout";
import { SlotManager } from "./scene/slots";
import { DUEL_GRIP } from "./sprites/sheets/character";

const TICK = 1000 / 60;

const mk = (id: string, over: Partial<Duelist> = {}): Duelist => ({
	id,
	pos: { x: 200, y: LANES[2] },
	facing: 1,
	path: [],
	state: "IDLE_STANDING",
	pending: null,
	slot: null,
	desiredStatus: "idle",
	idleSince: 0,
	gone: false,
	accent: id === "a" ? "#FF2E88" : "#2DE2E6",
	duelPose: null,
	...over,
});

/** A miniature World: walking, arrival, the self-healing rule, then the director. */
class Sim {
	slots = new SlotManager();
	chars = new Map<string, Duelist>();
	retryAt = new Map<string, number>();
	poses = new Map<string, DuelPose[]>();
	now = 0;
	constructor(
		public director: DuelDirector,
		cs: Duelist[],
	) {
		for (const c of cs) this.chars.set(c.id, c);
	}
	/** Mirror World.reconcile: a new status reacts this tick. */
	setStatus(id: string, status: Duelist["desiredStatus"]): void {
		this.chars.get(id)!.desiredStatus = status;
		this.retryAt.set(id, 0);
	}
	tick(): void {
		this.now += TICK;
		for (const c of this.chars.values()) {
			if (c.path.length > 0) {
				if (
					c.pending &&
					(this.retryAt.get(c.id) ?? 0) === 0 &&
					!stateMatchesStatus(c.pending.state, c.desiredStatus)
				) {
					this.retryAt.set(c.id, this.now + 1500);
					applyStatus(c, c.desiredStatus, this.slots, this.now);
				}
				if (step(c, TICK)) arrive(c);
			} else if (!stateMatchesStatus(c.state, c.desiredStatus) && this.now >= (this.retryAt.get(c.id) ?? 0)) {
				this.retryAt.set(c.id, this.now + 1500);
				applyStatus(c, c.desiredStatus, this.slots, this.now);
			}
		}
		this.director.update(this.chars, this.slots, this.now);
		for (const c of this.chars.values()) {
			const seen = this.poses.get(c.id) ?? [];
			if (c.duelPose && seen[seen.length - 1] !== c.duelPose) seen.push(c.duelPose);
			this.poses.set(c.id, seen);
		}
	}
	runFor(ms: number): void {
		const end = this.now + ms;
		while (this.now < end) this.tick();
	}
	runUntil(pred: () => boolean, maxMs = 400_000): void {
		const end = this.now + maxMs;
		while (!pred()) {
			if (this.now > end) throw new Error("runUntil timed out");
			this.tick();
		}
	}
}

const pair = (rng = () => 0) =>
	new Sim(new DuelDirector(rng), [mk("a", { pos: { x: 130, y: LANES[2] } }), mk("b", { pos: { x: 260, y: LANES[2] } })]);

describe("eligibility", () => {
	test("awake and sleeping idlers qualify; busy, leaving and walking agents do not", () => {
		expect(isEligible(mk("x"))).toBe(true);
		expect(isEligible(mk("x", { state: "WATCHING_TV" }))).toBe(true);
		expect(isEligible(mk("x", { state: "AT_BAR" }))).toBe(true);
		expect(isEligible(mk("x", { state: "SLEEPING" }))).toBe(true);
		expect(isEligible(mk("x", { desiredStatus: "working" }))).toBe(false);
		expect(isEligible(mk("x", { desiredStatus: "blocked" }))).toBe(false);
		expect(isEligible(mk("x", { desiredStatus: "unknown" }))).toBe(false);
		expect(isEligible(mk("x", { gone: true }))).toBe(false);
		expect(isEligible(mk("x", { state: "WALKING", path: [{ x: 1, y: 1 }] }))).toBe(false);
		expect(isEligible(mk("x", { state: "ENTERING" }))).toBe(false);
		expect(isEligible(mk("x", { state: "DUELING" }))).toBe(false);
	});
});

describe("scheduling", () => {
	test("no duel with a single idler", () => {
		const sim = new Sim(new DuelDirector(() => 0), [mk("a")]);
		sim.runFor(GAP_MIN_MS * 4);
		expect(sim.director.active()).toBeNull();
	});

	test("the first duel waits for the gap", () => {
		const sim = pair();
		sim.runFor(GAP_MIN_MS - 100);
		expect(sim.director.active()).toBeNull();
		sim.runFor(200);
		expect(sim.director.active()?.phase).toBe("approach");
	});

	test("one duel at a time", () => {
		const sim = new Sim(new DuelDirector(() => 0), [
			mk("a", { pos: { x: 130, y: LANES[2] } }),
			mk("b", { pos: { x: 260, y: LANES[2] } }),
			mk("c", { pos: { x: 200, y: LANES[0] } }),
			mk("d", { pos: { x: 310, y: LANES[0] } }),
		]);
		sim.runUntil(() => sim.director.active() !== null);
		const first = sim.director.active()!;
		sim.runUntil(() => sim.director.active()?.phase === "result");
		expect(sim.director.active()!.a).toBe(first.a);
		const fighting = [...sim.chars.values()].filter((c) => c.state === "DUELING");
		expect(fighting.map((c) => c.id).sort()).toEqual([first.a, first.b].sort());
	});

	test("gap disarms when eligibility drops, and a fresh gap runs after", () => {
		const sim = pair();
		sim.runFor(GAP_MIN_MS / 2);
		sim.setStatus("b", "working");
		sim.runFor(GAP_MIN_MS); // the old deadline passes while b works
		expect(sim.director.active()).toBeNull();
		sim.setStatus("b", "idle");
		const idleAgainAt = sim.now;
		sim.runUntil(() => sim.director.active() !== null);
		// a fresh gap from when b sat down again, not the stale deadline
		expect(sim.now - idleAgainAt).toBeGreaterThanOrEqual(GAP_MIN_MS);
	});

	test("screensaver demo: every gap is short, so each demo loop gets a duel", () => {
		const director = new DuelDirector(() => 0);
		director.demo = true;
		const sim = new Sim(director, [
			mk("a", { pos: { x: 130, y: LANES[2] } }),
			mk("b", { pos: { x: 260, y: LANES[2] } }),
		]);
		sim.runFor(DEMO_GAP_MS + 100);
		expect(director.active()).not.toBeNull();
		sim.runUntil(() => director.active() === null);
		const endedAt = sim.now;
		sim.runUntil(() => director.active() !== null);
		expect(sim.now - endedAt).toBeLessThan(DEMO_GAP_MS + 5000); // walk back to the couch + DEMO_GAP_MS
	});
});

describe("a full duel", () => {
	test("walks both to lane-2 marks 20px apart, facing each other", () => {
		const sim = pair();
		sim.runUntil(() => sim.director.active()?.phase === "ignite");
		const d = sim.director.active()!;
		const a = sim.chars.get(d.a)!;
		const b = sim.chars.get(d.b)!;
		expect(d.centerX).toBe(150);
		expect(a.pos).toEqual({ x: 140, y: LANES[2] });
		expect(b.pos).toEqual({ x: 160, y: LANES[2] });
		expect([a.facing, b.facing]).toEqual([1, -1]);
		expect([a.duelPose, b.duelPose]).toEqual(["guard", "guard"]);
	});

	test("guard → swing → result → back to idle; one winner; sparks per clash", () => {
		const sim = pair(() => 0);
		let sparks = 0;
		sim.runUntil(() => sim.director.active()?.phase === "clash");
		sim.runUntil(() => {
			sparks += sim.director.drainSparks().length;
			return sim.director.active()?.phase === "result";
		});
		expect(sparks).toBe(MIN_CLASHES); // rng 0 → fewest clashes
		const d = sim.director.active()!;
		expect(d.winner).toBe("a");
		expect(sim.chars.get("a")!.duelPose).toBe("win");
		expect(sim.chars.get("b")!.duelPose).toBe("down");
		expect(sim.chars.get("b")!.pos.x).toBe(160 + KNOCKBACK);
		expect(sim.poses.get("a")).toEqual(["guard", "swing", "guard", "swing", "guard", "swing", "win"]);
		expect(sim.poses.get("b")).toEqual(["guard", "swing", "guard", "swing", "guard", "down"]);
		sim.runUntil(() => sim.director.active() === null);
		for (const c of sim.chars.values()) {
			expect(c.duelPose).toBeNull();
			expect(c.state).toBe("WALKING");
			expect(c.pending?.slot).not.toBeNull();
		}
	});

	test("rng high: most clashes and the right fighter wins", () => {
		const sim = pair(() => 0.999);
		let sparks = 0;
		sim.runUntil(() => {
			sparks += sim.director.drainSparks().length;
			return sim.director.active()?.phase === "result";
		});
		expect(sparks).toBe(MAX_CLASHES);
		expect(sim.director.active()!.winner).toBe("b");
		expect(sim.director.active()!.centerX).toBe(240);
	});

	test("couch sitter and bunk sleeper both get up, fight and go back", () => {
		const sim = new Sim(new DuelDirector(() => 0), []);
		const a = mk("a", { pos: { x: 60, y: LANES[2] } });
		const b = mk("b", { pos: { x: 370, y: LANES[0] } });
		const couch = sim.slots.claimNearest("couch", "a", a.pos)!;
		Object.assign(a, { slot: couch, pos: { ...couch.usePos }, state: "WATCHING_TV" });
		const bed = sim.slots.claimNearest("bed", "b", b.pos)!;
		Object.assign(b, { slot: bed, pos: { ...bed.usePos }, state: "SLEEPING", idleSince: -IDLE_LONG_MS });
		sim.chars.set("a", a);
		sim.chars.set("b", b);
		sim.runUntil(() => sim.director.active()?.phase === "ignite");
		expect(sim.slots.held("a")).toBeNull();
		expect(sim.slots.held("b")).toBeNull();
		sim.runUntil(() => sim.director.active() === null);
		expect(b.pending?.state).toBe("SLEEPING"); // long idler climbs back into the bunk
		expect(a.pending?.state).toBe("WATCHING_TV");
	});
});

describe("status always wins", () => {
	test("cancel during approach: partner walks back to idle the same tick", () => {
		const sim = pair();
		sim.runUntil(() => sim.director.active() !== null);
		sim.tick();
		sim.setStatus("a", "working");
		sim.tick();
		expect(sim.chars.get("a")!.pending?.state).toBe("WORKING");
		expect(sim.director.active()).toBeNull();
		const b = sim.chars.get("b")!;
		expect(b.pending?.state).not.toBe("DUELING");
		expect(b.duelPose).toBeNull();
	});

	test("cancel mid-clash: no winner, no daze, blades off", () => {
		const sim = pair();
		sim.runUntil(() => sim.director.active()?.phase === "clash");
		sim.setStatus("b", "blocked");
		sim.tick();
		expect(sim.director.active()).toBeNull();
		expect(sim.chars.get("b")!.pending?.state).toBe("RAISING_HAND");
		const a = sim.chars.get("a")!;
		expect(a.duelPose).toBeNull();
		expect(a.state).toBe("WALKING");
		expect(sim.director.bladeLen("a", sim.now)).toBe(0);
		expect(sim.poses.get("a")).not.toContain("win");
		expect(sim.poses.get("b")).not.toContain("down");
	});

	test("fighter deleted from the room: cancel without throwing", () => {
		const sim = pair();
		sim.runUntil(() => sim.director.active()?.phase === "clash");
		sim.chars.delete("a");
		expect(() => sim.tick()).not.toThrow();
		expect(sim.director.active()).toBeNull();
		expect(sim.chars.get("b")!.pending?.state).not.toBe("DUELING");
	});

	test("fighter gone: cancel, the leaver is left to the FSM", () => {
		const sim = pair();
		sim.runUntil(() => sim.director.active()?.phase === "clash");
		sim.chars.get("a")!.gone = true;
		sim.tick();
		expect(sim.director.active()).toBeNull();
		expect(sim.chars.get("b")!.state).toBe("WALKING");
	});

	test("approach timeout cancels", () => {
		const sim = pair();
		sim.runUntil(() => sim.director.active() !== null);
		sim.chars.get("b")!.path = [{ x: 5000, y: LANES[2] }]; // still walking, never there in time
		sim.runFor(APPROACH_TIMEOUT_MS + 100);
		expect(sim.director.active()).toBeNull();
	});

	test("no slot stays claimed by a finished duel", () => {
		const sim = pair();
		sim.runUntil(() => sim.director.active() !== null);
		sim.runUntil(() => sim.director.active() === null);
		const holders = sim.slots.all().filter((s) => s.occupiedBy !== null).map((s) => s.occupiedBy);
		expect(holders.sort()).toEqual(["a", "b"]); // each holds exactly its new idle seat
	});
});

describe("geometry", () => {
	test("blade ramps 0 → full → 0", () => {
		expect(bladeLength(null, null, 1000)).toBe(0);
		expect(bladeLength(1000, null, 1000)).toBe(0);
		expect(bladeLength(1000, null, 1000 + BLADE_RAMP_MS / 2)).toBe(BLADE_LEN / 2);
		expect(bladeLength(1000, null, 1000 + BLADE_RAMP_MS)).toBe(BLADE_LEN);
		expect(bladeLength(1000, 5000, 5000 + BLADE_RAMP_MS / 2)).toBe(BLADE_LEN / 2);
		expect(bladeLength(1000, 5000, 5000 + BLADE_RAMP_MS)).toBe(0);
	});

	test("grip mirrors around the anchor when facing left", () => {
		const grip = DUEL_GRIP["duel.guard.0"]!;
		expect(gripPoint({ x: 100, y: 200 }, 1, grip)).toEqual({ x: 105, y: 191 });
		expect(gripPoint({ x: 100, y: 200 }, -1, grip)).toEqual({ x: 94, y: 191 });
	});

	test("two guards 20px apart cross blades between them", () => {
		const grip = DUEL_GRIP["duel.guard.0"]!;
		const left = bladeTip({ x: 140, y: 206 }, 1, grip, BLADE_LEN);
		const right = bladeTip({ x: 160, y: 206 }, -1, grip, BLADE_LEN);
		expect(left.x).toBeGreaterThan(right.x); // tips overlap
		const p = clashPoint(mk("a", { pos: { x: 140, y: 206 }, facing: 1 }), mk("b", { pos: { x: 160, y: 206 }, facing: -1 }));
		expect(p.x).toBeGreaterThanOrEqual(145);
		expect(p.x).toBeLessThanOrEqual(155);
		expect(p.y).toBeLessThan(206 - 8);
	});
});

describe("animation", () => {
	test("a duelist plays its pose; outside a duel the state decides", () => {
		const as = (over: Partial<Character>) => ({ state: "DUELING", duelPose: null, ...over }) as Character;
		expect(animFor(as({ duelPose: "guard" }))).toBe("duelGuard");
		expect(animFor(as({ duelPose: "swing" }))).toBe("duelSwing");
		expect(animFor(as({ duelPose: "down" }))).toBe("duelDown");
		expect(animFor(as({ duelPose: "win" }))).toBe("duelWin");
		expect(animFor(as({ duelPose: null }))).toBe("duelGuard");
		expect(animFor(as({ state: "WALKING", duelPose: "win" }))).toBe("walk");
	});
});

describe("duel length", () => {
	test("5 to 10 clashes", () => {
		expect([MIN_CLASHES, MAX_CLASHES]).toEqual([5, 10]);
	});

	test("20 to 60 s between duels", () => {
		expect([GAP_MIN_MS, GAP_MAX_MS]).toEqual([20_000, 60_000]);
	});
});
