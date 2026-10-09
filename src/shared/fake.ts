import type { AgentStatus } from "./types";
import { HerdrError, type AgentSource, type RawAgent } from "./herdr-core";

/**
 * HERDR_FAKE=1     deterministic 90s looping scenario exercising every
 *                  renderer path: all statuses, flicker suppression, blocked
 *                  latency, walk-in/out, crowd test, offline window,
 *                  subagent drones (background + burst).
 * HERDR_FAKE=chaos randomized soak test.
 */

const LOOP_MS = 90_000;

class FakeWorld {
	private agents: (RawAgent & { alive: boolean })[] = [];
	offline = false;
	loopStart = 0; // epoch ms of the current loop's t=0 (subagent startedAt)
	private chaosSeq = 0;

	add(agent: string, project: string, status: AgentStatus): void {
		const n = this.agents.length;
		this.agents.push({
			terminal_id: `fake_term_${n}`,
			pane_id: `fake_pane_${n}`,
			agent,
			status,
			cwd: `/Users/john/Projects/${project}`,
			focused: n === 0,
			subagents: [],
			alive: true,
		});
	}

	addMany(count: number, status: AgentStatus): void {
		for (let i = 0; i < count; i++) {
			this.add(i % 2 ? "pi" : "claude", `crowd-${i}`, status);
		}
	}

	set(index: number, status: AgentStatus): void {
		const a = this.agents[index];
		if (a) a.status = status;
	}

	remove(index: number): void {
		const a = this.agents[index];
		if (a) a.alive = false;
	}

	removeLast(count: number): void {
		const alive = this.agents.filter((a) => a.alive);
		for (const a of alive.slice(-count)) a.alive = false;
	}

	/** A scripted subagent on agents[index], started `atSec` into the loop. */
	sub(index: number, id: string, type: string, atSec: number, description?: string): void {
		const a = this.agents[index];
		if (a) a.subagents.push({ id, type, startedAt: this.loopStart + atSec * 1000, ...(description ? { description } : {}) });
	}

	/** chaos: start a subagent on agents[index], or finish its oldest one */
	chaosSub(index: number, now: number): void {
		const a = this.agents[index];
		if (!a || a.agent !== "claude") return;
		if (a.subagents.length < 9 && Math.random() < 0.6) {
			a.subagents.push({ id: `chaos_sub_${this.chaosSeq++}`, type: Math.random() < 0.5 ? "Explore" : "general-purpose", startedAt: now });
		} else {
			a.subagents.shift();
		}
	}

	list(): RawAgent[] {
		return this.agents
			.filter((a) => a.alive)
			.map(({ alive, ...raw }) => ({ ...raw, subagents: [...raw.subagents] }));
	}
}

interface Step {
	at: number; // seconds into the loop
	until?: number; // if set, the effect only holds for [at, until)
	apply: (w: FakeWorld) => void;
}

const SCRIPT: Step[] = [
	{
		at: 0,
		apply: (w) => {
			w.add("claude", "nordlink", "working");
			w.add("pi", "nordlink", "idle");
			w.add("claude", "myMem", "working");
		},
	},
	{ at: 5, apply: (w) => w.set(0, "idle") }, // working → idle: walk to couch
	{ at: 8, until: 9, apply: (w) => w.set(2, "idle") }, // 1s blip: debounced away
	{ at: 12, apply: (w) => w.set(1, "blocked") }, // hand up — must be instant
	{ at: 18, apply: (w) => w.set(1, "working") },
	{ at: 24, until: 55, apply: (w) => w.set(1, "idle") }, // two idlers long enough for the demo's early lightsaber duel
	{ at: 20, apply: (w) => w.add("claude", "agent-view", "working") }, // walk-in
	{ at: 30, apply: (w) => w.set(3, "unknown") }, // confused state
	{ at: 40, apply: (w) => w.remove(3) }, // walk-out
	{ at: 50, apply: (w) => w.addMany(8, "idle") }, // crowd test: couch fills, ramen bar takes the rest
	{ at: 60, until: 64, apply: (w) => void (w.offline = true) }, // 4s outage
	{ at: 70, apply: (w) => w.removeLast(8) },
	{ at: 80, apply: (w) => w.set(0, "working") }, // back to start; loop at 90
	// subagents: two background helpers keep agent 0's desk busy after it heads for the couch at 5s
	{ at: 2, until: 20, apply: (w) => w.sub(0, "fake_sub_bg0", "general-purpose", 2, "Check the daemon socket") },
	{ at: 3, until: 17, apply: (w) => w.sub(0, "fake_sub_bg1", "Explore", 3, "Find where drones are drawn") },
	// burst: 8 subagents on agent 2 (6 drones + "+2"), finishing one by one
	...Array.from(
		{ length: 8 },
		(_, i): Step => ({
			at: 20.5 + i * 0.3,
			until: 30 + i * 2.5,
			apply: (w) => w.sub(2, `fake_sub_burst${i}`, i % 3 ? "general-purpose" : "Explore", 20.5 + i * 0.3, `Burst task ${i + 1}`),
		}),
	),
];

/** Rebuild the world as a pure function of loop time — deterministic ids. */
function worldAt(tMs: number, loopStart: number): FakeWorld {
	const t = tMs / 1000;
	const w = new FakeWorld();
	w.loopStart = loopStart;
	for (const step of SCRIPT) {
		if (step.at <= t && (step.until === undefined || t < step.until)) {
			step.apply(w);
		}
	}
	return w;
}

const CHAOS_STATUSES: AgentStatus[] = ["working", "idle", "blocked", "unknown"];

export class FakeSource implements AgentSource {
	private t0 = Date.now();
	private chaos: FakeWorld | null = null;
	private nextChaosEvent = 0;
	private outage: boolean;

	constructor(mode: string, opts: { outage?: boolean } = {}) {
		this.outage = opts.outage ?? true; // the screensaver never wants the OFFLINE window
		if (mode === "chaos") {
			this.chaos = new FakeWorld();
			this.chaos.add("claude", "nordlink", "working");
			this.chaos.add("pi", "myMem", "idle");
		}
	}

	async list(): Promise<RawAgent[]> {
		if (this.chaos) return this.chaosList();
		const elapsed = Date.now() - this.t0;
		const w = worldAt(elapsed % LOOP_MS, Date.now() - (elapsed % LOOP_MS));
		if (w.offline && this.outage) throw new HerdrError("server-down", "fake outage");
		return w.list();
	}

	private chaosList(): RawAgent[] {
		const w = this.chaos!;
		if (Date.now() >= this.nextChaosEvent) {
			this.nextChaosEvent = Date.now() + 3000 + Math.random() * 7000;
			const alive = w.list();
			const roll = Math.random();
			if (roll < 0.2 && alive.length < 12) {
				w.add(
					Math.random() < 0.5 ? "claude" : "pi",
					`proj-${Math.floor(Math.random() * 100)}`,
					"working",
				);
			} else if (roll < 0.3 && alive.length > 2) {
				w.removeLast(1);
			} else if (roll < 0.45 && alive.length > 0) {
				const id = alive[Math.floor(Math.random() * alive.length)]!.terminal_id;
				w.chaosSub(Number(id.replace("fake_term_", "")), Date.now());
			} else if (alive.length > 0) {
				const target = Math.floor(Math.random() * alive.length);
				const status =
					CHAOS_STATUSES[Math.floor(Math.random() * CHAOS_STATUSES.length)]!;
				// indexes into the full agent array via id of the alive entry
				const id = alive[target]!.terminal_id;
				const idx = Number(id.replace("fake_term_", ""));
				w.set(idx, status);
			}
		}
		return w.list();
	}

	async focus(id: string): Promise<void> {
		console.log(`[fake] focus ${id}`);
	}
}
