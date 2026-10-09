import { returnToIdle, startDuelWalk, type CharState, type FsmChar } from "./characters/fsm";
import { LANES, type Vec2 } from "./scene/layout";
import type { SlotManager } from "./scene/slots";
import { CHARACTER, DUEL_GRIP, type Grip } from "./sprites/sheets/character";

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

/** A clash the scene should burst into sparks. */
export interface Spark {
	x: number;
	y: number;
	colors: string[];
}

export const GAP_MIN_MS = 60_000;
export const GAP_MAX_MS = 180_000;
export const DEMO_GAP_MS = 10_000;
export const APPROACH_TIMEOUT_MS = 15_000;
export const IGNITE_MS = 800;
export const MIN_CLASHES = 5;
export const MAX_CLASHES = 10;
export const CLASH_MS = 600;
export const STRIKE_MS = 300; // duel.swing.1 starts here
export const RESULT_MS = 2500;
export const RETRACT_MS = 300;
export const BLADE_RAMP_MS = 200;
export const BLADE_LEN = 10;
export const ARENA_MIN_X = 150;
export const ARENA_MAX_X = 240;
export const MARK_HALF = 10;
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
	/** screensaver demo: the first duel comes after DEMO_GAP_MS */
	demo = false;
	private duel: Duel | null = null;
	private nextAt: number | null = null;
	private hadDuel = false;
	private sparks: Spark[] = [];

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

	update(chars: ReadonlyMap<string, Duelist>, slots: SlotManager, now: number): void {
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

	private gap(): number {
		if (this.demo && !this.hadDuel) return DEMO_GAP_MS;
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
		this.hadDuel = true;
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
					if (this.sparks.length < MAX_PENDING_SPARKS) {
						this.sparks.push({ ...clashPoint(att, def), colors: [a.accent, b.accent, SPARK_WHITE] });
					}
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
	}
}
