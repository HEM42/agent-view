import { arrive, returnToIdle, startDuelWalk, type CharState, type FsmChar } from "./characters/fsm";
import { LANES, type Vec2 } from "./scene/layout";
import type { SlotManager } from "./scene/slots";
import {
	ARENA_MAX_X,
	ARENA_MIN_X,
	CLASH_MS,
	GAP_MAX_MS,
	GAP_MIN_MS,
	IGNITE_MS,
	MARK_HALF,
	MAX_CLASHES,
	MIN_CLASHES,
	RESULT_MS,
	RETRACT_MS,
	STRIKE_MS,
	duelPhaseAt,
	duelTimes,
	type DuelInfo,
	type DuelPhaseInfo,
} from "../shared/duel-timeline";
import { CHARACTER, DUEL_GRIP, type Grip } from "./sprites/sheets/character";

export {
	ARENA_MAX_X,
	ARENA_MIN_X,
	CLASH_MS,
	GAP_MAX_MS,
	GAP_MIN_MS,
	IGNITE_MS,
	MARK_HALF,
	MAX_CLASHES,
	MIN_CLASHES,
	RESULT_MS,
	RETRACT_MS,
	STRIKE_MS,
};

export type DuelPose = "guard" | "swing" | "down" | "win";

/** What the director needs from a character; Character satisfies it. */
export interface Duelist extends FsmChar {
	accent: string;
	duelPose: DuelPose | null;
}

export type DuelPhase = "approach" | "ignite" | "clash" | "result" | "retract";

export interface Duel {
	a: string; // left mark, faces right
	b: string; // right mark, faces left
	centerX: number;
	phase: DuelPhase;
	phaseUntil: number; // approach: timeout deadline
	clashesLeft: number;
	attacker: string;
	strikeAt: number | null; // pending spark of the current clash
	winner: string | null;
	igniteAt: number | null;
	retractAt: number | null;
}

/** A finished duel, for the scoreboard (cancelled duels never report). */
export interface DuelResult {
	winner: string;
	loser: string;
}

/** A clash the scene should burst into sparks. */
export interface Spark {
	x: number;
	y: number;
	colors: string[];
}

export const DEMO_GAP_MS = 10_000;
export const APPROACH_TIMEOUT_MS = 15_000;
export const BLADE_RAMP_MS = 200;
export const BLADE_LEN = 10;
export const KNOCKBACK = 6;
const MAX_PENDING_SPARKS = 8; // nobody draining (paused renderer): don't grow
const SPARK_WHITE = "#F2EEFF";

const ELIGIBLE: ReadonlySet<CharState> = new Set<CharState>(["IDLE_STANDING", "WATCHING_TV", "AT_BAR", "SLEEPING"]);

export function isEligible(c: Duelist): boolean {
	return c.desiredStatus === "idle" && !c.gone && c.path.length === 0 && ELIGIBLE.has(c.state);
}

/** Still ours: on the mark, or walking to it. Anything else means the FSM took them back. */
function inDuel(c: Duelist | undefined): c is Duelist {
	return !!c && !c.gone && (c.state === "DUELING" || (c.path.length > 0 && c.pending?.state === "DUELING"));
}

/** Blade length in px: extends from igniteAt, retracts from retractAt. */
export function bladeLength(igniteAt: number | null, retractAt: number | null, now: number): number {
	if (igniteAt === null) return 0;
	const ramp = (t: number) => Math.min(1, Math.max(0, t / BLADE_RAMP_MS));
	let ext = ramp(now - igniteAt);
	if (retractAt !== null) ext *= 1 - ramp(now - retractAt);
	return Math.round(ext * BLADE_LEN);
}

/** Screen pixel of the sword hand, matching drawCharacter's anchoring and flip. */
export function gripPoint(pos: Vec2, facing: 1 | -1, grip: Grip): Vec2 {
	const x0 = Math.round(pos.x);
	const y0 = Math.round(pos.y);
	const { x: ax, y: ay } = CHARACTER.anchor;
	return {
		x: facing === 1 ? x0 - ax + grip.hand.x : x0 + ax - 1 - grip.hand.x,
		y: y0 - ay + grip.hand.y,
	};
}

export function bladeAngle(facing: 1 | -1, grip: Grip): number {
	return facing === 1 ? grip.angle : Math.PI - grip.angle;
}

export function bladeTip(pos: Vec2, facing: 1 | -1, grip: Grip, len: number): Vec2 {
	const h = gripPoint(pos, facing, grip);
	const a = bladeAngle(facing, grip);
	return { x: h.x + Math.cos(a) * len, y: h.y + Math.sin(a) * len };
}

/** Where sparks fly: midway between the striking and the guarding blade tip. */
export function clashPoint(attacker: Duelist, defender: Duelist): Vec2 {
	const t1 = bladeTip(attacker.pos, attacker.facing, DUEL_GRIP["duel.swing.1"]!, BLADE_LEN);
	const t2 = bladeTip(defender.pos, defender.facing, DUEL_GRIP["duel.guard.0"]!, BLADE_LEN);
	return { x: Math.round((t1.x + t2.x) / 2), y: Math.round((t1.y + t2.y) / 2) };
}

/**
 * Lightsaber duels between idle agents. Pure bookkeeping (no canvas), so every
 * rule is unit-testable; World ticks it and the scene draws blades and sparks
 * from it. The FSM stays the authority: a fighter whose status changes is
 * pulled out by applyStatus, and the director only notices and cancels.
 */
export class DuelDirector {
	/** screensaver demo: every gap is DEMO_GAP_MS, so each demo loop shows a duel */
	demo = false;
	private duel: Duel | null = null;
	private nextAt: number | null = null;
	private sparks: Spark[] = [];
	private results: DuelResult[] = [];
	/** room mode: the daemon's duel being animated */
	private followed: DuelInfo | null = null;
	/** room mode: a duel finished or abandoned here, never rejoined while the daemon still sends it */
	private doneId: string | null = null;
	private sparkedClash = -1;

	constructor(private rng: () => number = Math.random) {}

	active(): Readonly<Duel> | null {
		return this.duel;
	}

	bladeLen(charId: string, now: number): number {
		const d = this.duel;
		if (!d || (charId !== d.a && charId !== d.b)) return 0;
		return bladeLength(d.igniteAt, d.retractAt, now);
	}

	drainSparks(): Spark[] {
		const out = this.sparks;
		this.sparks = [];
		return out;
	}

	drainResults(): DuelResult[] {
		const out = this.results;
		this.results = [];
		return out;
	}

	/** Local mode: schedule and referee duels here. */
	update(chars: ReadonlyMap<string, Duelist>, slots: SlotManager, now: number): void {
		if (this.followed) this.stopFollowing(chars, slots, now); // back from room mode
		if (this.duel) {
			this.advance(this.duel, chars, slots, now);
			return;
		}
		const eligible = [...chars.values()].filter(isEligible);
		if (eligible.length < 2) {
			this.nextAt = null;
			return;
		}
		if (this.nextAt === null) {
			this.nextAt = now + this.gap();
			return;
		}
		if (now >= this.nextAt) this.start(eligible, slots, now);
	}

	/**
	 * Room mode: animate the daemon's duel instead of scheduling one. `now` is
	 * perf time for the animation, `epochNow` the shared clock the timeline is
	 * written in. The daemon keeps the score, so no results are reported here.
	 */
	follow(
		info: DuelInfo | null,
		chars: ReadonlyMap<string, Duelist>,
		slots: SlotManager,
		now: number,
		epochNow: number,
	): void {
		if (this.duel && !this.followed) {
			// a local duel from before the room appeared
			this.cancel([chars.get(this.duel.a), chars.get(this.duel.b)], slots, now);
		}
		if (this.followed && this.followed.id !== info?.id) this.stopFollowing(chars, slots, now);
		if (!info || info.id === this.doneId) return;
		const a = chars.get(info.a);
		const b = chars.get(info.b);
		const p = duelPhaseAt(info, epochNow);
		if (!this.followed) {
			if (p.phase === "over") return;
			if (!canJoin(a) || !canJoin(b)) return; // not spawned yet (or busy here): wait
			this.join(info, a, b, slots);
		} else if (!inDuel(a) || !inDuel(b)) {
			// a local status change took a fighter; the daemon cancels too
			this.stopFollowing(chars, slots, now);
			return;
		}
		if (p.phase === "over") {
			this.stopFollowing(chars, slots, now); // done: both back to idle
			return;
		}
		this.animate(info, a, b, p, now, epochNow);
	}

	private join(info: DuelInfo, a: Duelist, b: Duelist, slots: SlotManager): void {
		this.followed = info;
		this.sparkedClash = -1;
		startDuelWalk(a, slots, markA(info));
		startDuelWalk(b, slots, markB(info));
		this.duel = {
			a: info.a,
			b: info.b,
			centerX: info.centerX,
			phase: "approach",
			phaseUntil: 0,
			clashesLeft: info.clashes,
			attacker: info.a,
			strikeAt: null,
			winner: null,
			igniteAt: null,
			retractAt: null,
		};
	}

	/** Pose both fighters for the timeline's current phase; idempotent per tick. */
	private animate(
		info: DuelInfo,
		a: Duelist,
		b: Duelist,
		p: DuelPhaseInfo,
		now: number,
		epochNow: number,
	): void {
		const d = this.duel!;
		const t = duelTimes(info);
		const perf = (epochAt: number) => now + (epochAt - epochNow);
		d.phase = p.phase;
		d.phaseUntil = perf(t.endAt);
		if (p.phase === "approach") {
			// whoever arrives first waits in guard, blade off
			if (a.state === "DUELING" && a.path.length === 0) this.takeGuard(a, 1);
			if (b.state === "DUELING" && b.path.length === 0) this.takeGuard(b, -1);
			return;
		}
		// from ignite on both stand on their marks, even if the window missed the walk
		placeOnMark(a, markA(info));
		placeOnMark(b, markB(info));
		this.takeGuard(a, 1);
		this.takeGuard(b, -1);
		d.igniteAt = perf(t.igniteAt);
		d.retractAt = p.phase === "retract" ? perf(t.retractAt) : null;
		d.strikeAt = null;
		if (p.phase === "ignite") return;
		if (p.phase === "clash") {
			d.clashesLeft = info.clashes - p.clashIndex;
			d.attacker = p.attacker!;
			const [att, def] = d.attacker === a.id ? [a, b] : [b, a];
			att.duelPose = "swing";
			if (epochNow < p.strikeAt!) {
				d.strikeAt = perf(p.strikeAt!);
			} else if (p.clashIndex > this.sparkedClash) {
				this.sparkedClash = p.clashIndex;
				this.spark(att, def, a, b);
			}
			return;
		}
		// result and retract: the daemon picked the winner; the loser is knocked back
		d.clashesLeft = 0;
		d.winner = info.winner;
		const [win, lose] = info.winner === b.id ? [b, a] : [a, b];
		win.duelPose = "win";
		lose.duelPose = "down";
		lose.pos = { x: lose.pos.x + (lose === a ? -KNOCKBACK : KNOCKBACK), y: lose.pos.y };
	}

	/** Drop the followed duel: whoever is still ours walks back to idle, with no result pose. */
	private stopFollowing(chars: ReadonlyMap<string, Duelist>, slots: SlotManager, now: number): void {
		const f = this.followed!;
		this.doneId = f.id;
		this.cancel([chars.get(f.a), chars.get(f.b)], slots, now);
	}

	private spark(att: Duelist, def: Duelist, a: Duelist, b: Duelist): void {
		if (this.sparks.length < MAX_PENDING_SPARKS) {
			this.sparks.push({ ...clashPoint(att, def), colors: [a.accent, b.accent, SPARK_WHITE] });
		}
	}

	private gap(): number {
		if (this.demo) return DEMO_GAP_MS;
		return GAP_MIN_MS + this.rng() * (GAP_MAX_MS - GAP_MIN_MS);
	}

	private start(eligible: Duelist[], slots: SlotManager, now: number): void {
		const pool = [...eligible];
		const first = pool.splice(Math.floor(this.rng() * pool.length), 1)[0]!;
		const second = pool[Math.floor(this.rng() * pool.length)]!;
		const centerX = Math.round(ARENA_MIN_X + this.rng() * (ARENA_MAX_X - ARENA_MIN_X));
		const clashes = MIN_CLASHES + Math.floor(this.rng() * (MAX_CLASHES - MIN_CLASHES + 1));
		// whoever is further left takes the left mark: fewer crossed paths
		const [left, right] = first.pos.x <= second.pos.x ? [first, second] : [second, first];
		const y = LANES[2]!;
		startDuelWalk(left, slots, { x: centerX - MARK_HALF, y });
		startDuelWalk(right, slots, { x: centerX + MARK_HALF, y });
		this.duel = {
			a: left.id,
			b: right.id,
			centerX,
			phase: "approach",
			phaseUntil: now + APPROACH_TIMEOUT_MS,
			clashesLeft: clashes,
			attacker: left.id,
			strikeAt: null,
			winner: null,
			igniteAt: null,
			retractAt: null,
		};
	}

	private advance(d: Duel, chars: ReadonlyMap<string, Duelist>, slots: SlotManager, now: number): void {
		const a = chars.get(d.a);
		const b = chars.get(d.b);
		if (!inDuel(a) || !inDuel(b)) {
			this.cancel([a, b], slots, now);
			return;
		}
		switch (d.phase) {
			case "approach": {
				// first to arrive waits in guard, blade off
				if (a.state === "DUELING") this.takeGuard(a, 1);
				if (b.state === "DUELING") this.takeGuard(b, -1);
				if (a.state === "DUELING" && b.state === "DUELING") {
					d.phase = "ignite";
					d.igniteAt = now;
					d.phaseUntil = now + IGNITE_MS;
				} else if (now >= d.phaseUntil) {
					this.cancel([a, b], slots, now);
				}
				return;
			}
			case "ignite":
				if (now >= d.phaseUntil) {
					d.phase = "clash";
					this.beginClash(d, a, b, now);
				}
				return;
			case "clash": {
				if (d.strikeAt !== null && now >= d.strikeAt) {
					d.strikeAt = null;
					const [att, def] = d.attacker === a.id ? [a, b] : [b, a];
					this.spark(att, def, a, b);
				}
				if (now < d.phaseUntil) return;
				d.clashesLeft--;
				if (d.clashesLeft > 0) {
					d.attacker = d.attacker === a.id ? b.id : a.id;
					this.beginClash(d, a, b, now);
					return;
				}
				const [win, lose] = this.rng() < 0.5 ? [a, b] : [b, a];
				d.winner = win.id;
				this.results.push({ winner: win.id, loser: lose.id });
				win.duelPose = "win";
				lose.duelPose = "down";
				// knocked back, away from the centre
				lose.pos = { x: lose.pos.x + (lose === a ? -KNOCKBACK : KNOCKBACK), y: lose.pos.y };
				d.phase = "result";
				d.phaseUntil = now + RESULT_MS;
				return;
			}
			case "result":
				if (now >= d.phaseUntil) {
					d.phase = "retract";
					d.retractAt = now;
					d.phaseUntil = now + RETRACT_MS;
				}
				return;
			case "retract":
				if (now >= d.phaseUntil) this.release([a, b], slots, now);
				return;
		}
	}

	private takeGuard(c: Duelist, facing: 1 | -1): void {
		c.facing = facing;
		c.duelPose = "guard";
	}

	private beginClash(d: Duel, a: Duelist, b: Duelist, now: number): void {
		a.duelPose = d.attacker === a.id ? "swing" : "guard";
		b.duelPose = d.attacker === b.id ? "swing" : "guard";
		d.strikeAt = now + STRIKE_MS;
		d.phaseUntil = now + CLASH_MS;
	}

	/** Duel over: both back to idle spots. */
	private release(fighters: Duelist[], slots: SlotManager, now: number): void {
		for (const c of fighters) {
			c.duelPose = null;
			returnToIdle(c, slots, now);
		}
		this.end();
	}

	/** Someone dropped out: no winner, no daze; whoever is still ours goes back to idle. */
	private cancel(fighters: (Duelist | undefined)[], slots: SlotManager, now: number): void {
		for (const c of fighters) {
			if (!c) continue;
			c.duelPose = null;
			if (inDuel(c)) returnToIdle(c, slots, now);
		}
		this.end();
	}

	private end(): void {
		this.duel = null;
		this.nextAt = null;
		this.followed = null;
	}
}

const markA = (d: DuelInfo): Vec2 => ({ x: d.centerX - MARK_HALF, y: LANES[2]! });
const markB = (d: DuelInfo): Vec2 => ({ x: d.centerX + MARK_HALF, y: LANES[2]! });

/** Room mode: the daemon saw them idle; here they must at least be in the room and not busy. */
function canJoin(c: Duelist | undefined): c is Duelist {
	return !!c && !c.gone && c.desiredStatus === "idle" && c.state !== "LEAVING";
}

/** Late for ignite (window hidden, or joining mid-duel): stop walking and stand on the mark. */
function placeOnMark(c: Duelist, mark: Vec2): void {
	if (c.path.length > 0) {
		c.path = [];
		arrive(c); // pending is the duel: state becomes DUELING
	}
	c.pos = { ...mark };
}
