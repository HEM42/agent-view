import {
	ARENA_MAX_X,
	ARENA_MIN_X,
	ELIGIBLE_IDLE_MS,
	GAP_MAX_MS,
	GAP_MIN_MS,
	MAX_CLASHES,
	MIN_CLASHES,
	duelTimes,
	type DuelInfo,
	type DuelTimeline,
} from "../shared/duel-timeline";
import type { AgentView } from "../shared/types";

export interface DuelOutcome {
	winner: AgentView;
	loser: AgentView;
}

export interface DuelRefereeOptions {
	rng?: () => number;
	gapMin?: number;
	gapMax?: number;
	eligibleIdleMs?: number;
	/** Phase durations; override only to run fast tests. */
	timeline?: Partial<DuelTimeline>;
}

/**
 * Decides who duels, when and who wins. Pure bookkeeping (no I/O, no timers):
 * the daemon feeds it every snapshot and drains the results.
 */
export class DuelReferee {
	private readonly rng: () => number;
	private readonly gapMin: number;
	private readonly gapMax: number;
	private readonly eligibleIdleMs: number;
	private readonly timeline: Partial<DuelTimeline>;
	private idleSince = new Map<string, number>();
	private lastSeen = new Map<string, AgentView>();
	private duel: DuelInfo | null = null;
	private resultDone = false;
	private nextAt: number | null = null;
	private counter = 0;
	private results: DuelOutcome[] = [];

	constructor(opts: DuelRefereeOptions = {}) {
		this.rng = opts.rng ?? Math.random;
		this.gapMin = opts.gapMin ?? GAP_MIN_MS;
		this.gapMax = opts.gapMax ?? GAP_MAX_MS;
		this.eligibleIdleMs = opts.eligibleIdleMs ?? ELIGIBLE_IDLE_MS;
		this.timeline = opts.timeline ?? {};
	}

	current(): DuelInfo | null {
		return this.duel;
	}

	drainResults(): DuelOutcome[] {
		const out = this.results;
		this.results = [];
		return out;
	}

	update(agents: AgentView[], now: number): void {
		const byId = new Map(agents.map((a) => [a.id, a]));
		const idleSince = new Map<string, number>();
		for (const a of agents) {
			if (a.status === "idle") idleSince.set(a.id, this.idleSince.get(a.id) ?? now);
		}
		this.idleSince = idleSince;

		if (this.duel) {
			this.advance(this.duel, byId, now);
			if (this.duel) return;
		}
		const eligible = agents.filter((a) => now - (idleSince.get(a.id) ?? now) >= this.eligibleIdleMs && a.status === "idle");
		if (eligible.length < 2) {
			this.nextAt = null;
			return;
		}
		if (this.nextAt === null) {
			this.nextAt = now + this.gapMin + this.rng() * (this.gapMax - this.gapMin);
			return;
		}
		if (now >= this.nextAt) this.start(eligible, now);
	}

	private start(eligible: AgentView[], now: number): void {
		const pool = [...eligible];
		const a = pool.splice(Math.floor(this.rng() * pool.length), 1)[0]!;
		const b = pool[Math.floor(this.rng() * pool.length)]!;
		const centerX = Math.round(ARENA_MIN_X + this.rng() * (ARENA_MAX_X - ARENA_MIN_X));
		const clashes = MIN_CLASHES + Math.floor(this.rng() * (MAX_CLASHES - MIN_CLASHES + 1));
		const winner = this.rng() < 0.5 ? a.id : b.id;
		this.duel = { id: `d${++this.counter}-${now}`, a: a.id, b: b.id, centerX, clashes, winner, startAt: now };
		this.resultDone = false;
		this.nextAt = null;
		this.lastSeen = new Map([
			[a.id, a],
			[b.id, b],
		]);
	}

	private advance(d: DuelInfo, byId: Map<string, AgentView>, now: number): void {
		const t = duelTimes(d, this.timeline);
		if (!this.resultDone) {
			const a = byId.get(d.a);
			const b = byId.get(d.b);
			if (now < t.resultAt && (a?.status !== "idle" || b?.status !== "idle")) {
				this.duel = null; // cancelled: no result, a new gap starts
				this.nextAt = null;
				return;
			}
			if (a) this.lastSeen.set(d.a, a);
			if (b) this.lastSeen.set(d.b, b);
			if (now >= t.resultAt) {
				const loserId = d.winner === d.a ? d.b : d.a;
				this.results.push({ winner: this.lastSeen.get(d.winner)!, loser: this.lastSeen.get(loserId)! });
				this.resultDone = true;
			}
		}
		if (now >= t.endAt) {
			this.duel = null;
			this.nextAt = null;
		}
	}
}
