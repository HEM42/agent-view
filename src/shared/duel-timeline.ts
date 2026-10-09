/** The lightsaber duel timeline, shared by the daemon (referee) and the windows (animation). */

export const APPROACH_MS = 8000;
export const IGNITE_MS = 800;
export const CLASH_MS = 600;
export const STRIKE_MS = 300; // the strike lands this far into each clash
export const RESULT_MS = 2500;
export const RETRACT_MS = 300;
export const MIN_CLASHES = 5;
export const MAX_CLASHES = 10;
export const GAP_MIN_MS = 20_000;
export const GAP_MAX_MS = 60_000;
export const ELIGIBLE_IDLE_MS = 10_000;
export const ARENA_MIN_X = 150;
export const ARENA_MAX_X = 240;
export const MARK_HALF = 10;

export interface DuelInfo {
	id: string;
	a: string; // left mark, faces right, attacks first
	b: string; // right mark, faces left
	centerX: number;
	clashes: number;
	winner: string;
	startAt: number; // epoch ms
}

/** Phase durations; override only to run fast tests. */
export interface DuelTimeline {
	approachMs: number;
	igniteMs: number;
	clashMs: number;
	strikeMs: number;
	resultMs: number;
	retractMs: number;
}

export const DEFAULT_TIMELINE: DuelTimeline = {
	approachMs: APPROACH_MS,
	igniteMs: IGNITE_MS,
	clashMs: CLASH_MS,
	strikeMs: STRIKE_MS,
	resultMs: RESULT_MS,
	retractMs: RETRACT_MS,
};

export interface DuelTimes {
	igniteAt: number;
	clashAt(i: number): number;
	resultAt: number;
	retractAt: number;
	endAt: number;
}

export function duelTimes(d: Pick<DuelInfo, "startAt" | "clashes">, tl: Partial<DuelTimeline> = {}): DuelTimes {
	const t = { ...DEFAULT_TIMELINE, ...tl };
	const igniteAt = d.startAt + t.approachMs;
	const clashesStart = igniteAt + t.igniteMs;
	const resultAt = clashesStart + d.clashes * t.clashMs;
	const retractAt = resultAt + t.resultMs;
	return {
		igniteAt,
		clashAt: (i) => clashesStart + i * t.clashMs,
		resultAt,
		retractAt,
		endAt: retractAt + t.retractMs,
	};
}

export type DuelPhaseName = "approach" | "ignite" | "clash" | "result" | "retract" | "over";

export interface DuelPhaseInfo {
	phase: DuelPhaseName;
	clashIndex: number; // current clash during "clash", else -1
	attacker: string | null; // during "clash" only; alternates, starting with a
	strikeAt: number | null; // epoch ms the current clash's strike lands, during "clash" only
}

/** Phases start inclusive: now === igniteAt is already "ignite"; now === endAt is "over". */
export function duelPhaseAt(d: DuelInfo, now: number, tl: Partial<DuelTimeline> = {}): DuelPhaseInfo {
	const t = { ...DEFAULT_TIMELINE, ...tl };
	const times = duelTimes(d, t);
	const none = { clashIndex: -1, attacker: null, strikeAt: null };
	if (now < times.igniteAt) return { phase: "approach", ...none };
	if (now < times.clashAt(0)) return { phase: "ignite", ...none };
	if (now < times.resultAt) {
		const clashIndex = Math.floor((now - times.clashAt(0)) / t.clashMs);
		return {
			phase: "clash",
			clashIndex,
			attacker: clashIndex % 2 === 0 ? d.a : d.b,
			strikeAt: times.clashAt(clashIndex) + t.strikeMs,
		};
	}
	if (now < times.retractAt) return { phase: "result", ...none };
	if (now < times.endAt) return { phase: "retract", ...none };
	return { phase: "over", ...none };
}
