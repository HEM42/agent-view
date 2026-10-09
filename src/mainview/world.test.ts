import { describe, expect, test } from "bun:test";
import type { DuelInfo } from "../shared/duel-timeline";
import type { AgentView, RoomState, ScoreRow, Snapshot } from "../shared/types";
import type { Character } from "./characters/character";
import { GAP_MAX_MS, GAP_MIN_MS } from "./duels";
import { plusPos, swarmPos } from "./characters/drone";
import { DESKS, LANES } from "./scene/layout";
import { World } from "./world";

const SNAP: Snapshot = { herdrOnline: true, agents: [], ts: 0 };

describe("World.forgetLink", () => {
	test("without forgetLink, a stale lastMessageAt reports link-lost", () => {
		const w = new World();
		w.reconcile(SNAP, 1000);
		expect(w.linkLost(1000 + 6000)).toBe(true);
	});

	test("forgetLink makes a resumed game behave like a cold start", () => {
		const w = new World();
		w.reconcile(SNAP, 1000);
		w.forgetLink();
		expect(w.linkLost(1000 + 6000)).toBe(false);
	});
});

describe("World.pickDrone", () => {
	test("hits a drone at its current position and the +N tag", () => {
		const w = new World();
		const desk = DESKS[0]!;
		const subagents = Array.from({ length: 7 }, (_, i) => ({
			id: `s${i}`,
			type: "Explore",
			startedAt: Date.now() - 10_000 + i,
		}));
		w.fleet.sync([{ id: "p1", deskId: desk.id, accent: "#FF2E88", subagents }], 0, Date.now());
		const d = w.fleet.drones()[0]!;
		const pos = swarmPos(d, desk, 1234);
		const hit = w.pickDrone({ x: pos.x + 2, y: pos.y + 1 }, 1234);
		expect(hit?.kind).toBe("drone");
		expect(hit?.parentId).toBe("p1");
		const plus = plusPos(desk);
		// x+5 lies past every drone hit box (they end at desk x+15), so this can only hit the tag
		const more = w.pickDrone({ x: plus.x + 5, y: plus.y + 2 }, 1234);
		expect(more?.kind === "more" && more.overflow.hidden.length).toBe(1);
		expect(w.pickDrone({ x: 380, y: 210 }, 1234)).toBeNull();
	});
});

/** A Character without sprites: World.update only needs anim.play/update. */
function fakeChar(id: string, x: number): Character {
	return {
		id,
		agent: "claude",
		project: `p-${id}`,
		label: id,
		accent: id === "a" ? "#FF2E88" : "#2DE2E6",
		outfitBase: "#E8825A",
		focused: false,
		pos: { x, y: LANES[2] },
		facing: 1,
		path: [],
		state: "IDLE_STANDING",
		pending: null,
		slot: null,
		desiredStatus: "idle",
		idleSince: 0,
		statusSince: 0,
		gone: false,
		duelPose: null,
		walkJitter: 0,
		retryAt: 0,
		anim: { play() {}, update() {} },
	} as unknown as Character;
}

const view = (id: string, status: AgentView["status"]): AgentView => ({
	id,
	agent: "claude",
	project: `p-${id}`,
	status,
	focused: false,
	subagents: [],
});

function duelWorld(): World {
	const w = new World(() => 0);
	w.chars.set("a", fakeChar("a", 130));
	w.chars.set("b", fakeChar("b", 260));
	w.reconcile({ herdrOnline: true, agents: [view("a", "idle"), view("b", "idle")], ts: 0 }, 0);
	return w;
}

function runUntil(w: World, from: number, pred: () => boolean): number {
	let now = from;
	while (!pred()) {
		if (now > from + 400_000) throw new Error("timed out");
		now += 1000 / 60;
		w.update(1000 / 60, now);
	}
	return now;
}

describe("World duels", () => {
	test("the self-healing rule does not fight a long duel", () => {
		const w = duelWorld();
		let now = runUntil(w, 0, () => w.duels.active()?.phase === "ignite");
		expect(now).toBeGreaterThanOrEqual(GAP_MIN_MS);
		const ignitedAt = now;
		now = runUntil(w, now, () => w.duels.active()?.phase === "result");
		// longer than RETRY_MS (1.5 s): the self-heal rule ran and left them alone
		expect(now - ignitedAt).toBeGreaterThan(1500);
		expect(w.chars.get("a")!.state).toBe("DUELING");
		expect(w.chars.get("b")!.state).toBe("DUELING");
	});

	test("a status flip mid-duel reaches the FSM in the same update", () => {
		const w = duelWorld();
		let now = runUntil(w, 0, () => w.duels.active()?.phase === "clash");
		w.reconcile({ herdrOnline: true, agents: [view("a", "working"), view("b", "idle")], ts: now }, now);
		now += 1000 / 60;
		w.update(1000 / 60, now);
		expect(w.chars.get("a")!.pending?.state).toBe("WORKING");
		expect(w.duels.active()).toBeNull();
		expect(w.chars.get("b")!.duelPose).toBeNull();
	});
});

describe("World scoreboard", () => {
	test("a finished duel lands on the board under agent·project", () => {
		const w = duelWorld();
		runUntil(w, 0, () => w.duels.active()?.phase === "result");
		const top = w.scoreboard.top(5);
		expect(top.map((s) => `${s.key} ${s.wins}-${s.losses}`)).toEqual(["claude·p-a 1-0", "claude·p-b 0-1"]);
		expect(top[0]!.accent).toBe("#FF2E88");
		expect(top[0]!.agentColor).toBe("#E8825A");
	});

	test("a cancelled duel leaves the board empty", () => {
		const w = duelWorld();
		let now = runUntil(w, 0, () => w.duels.active()?.phase === "clash");
		w.reconcile({ herdrOnline: true, agents: [view("a", "working"), view("b", "idle")], ts: now }, now);
		now += 1000 / 60;
		w.update(1000 / 60, now);
		expect(w.scoreboard.top(5)).toEqual([]);
	});
});

describe("World room mode", () => {
	const EPOCH0 = 1_760_000_000_000;
	const DT = 1000 / 60;
	const agents = [view("a", "idle"), view("b", "idle")];
	const row: ScoreRow = { key: "claude·p-a", agent: "claude", project: "p-a", wins: 4, losses: 1 };
	const duel = (startAt: number): DuelInfo => ({
		id: "d1",
		a: "a",
		b: "b",
		centerX: 180,
		clashes: 5,
		winner: "b",
		startAt,
	});
	const snap = (now: number, room?: RoomState): Snapshot => ({ herdrOnline: true, agents, ts: now, room });
	/** tick with the shared clock a fixed offset from perf time */
	function run(w: World, from: number, pred: () => boolean): number {
		let now = from;
		while (!pred()) {
			if (now > from + 400_000) throw new Error("timed out");
			now += DT;
			w.update(DT, now, EPOCH0 + now);
		}
		return now;
	}
	const board = (w: World) => w.scoreboard.top(5).map((s) => `${s.key} ${s.wins}-${s.losses}`);

	test("follows the daemon's duel and shows its scoreboard, recording nothing itself", () => {
		const w = duelWorld();
		w.reconcile(snap(0, { duel: duel(EPOCH0), scores: [row] }), 0);
		w.update(DT, DT, EPOCH0 + DT);
		expect(w.duels.active()).toMatchObject({ a: "a", b: "b", centerX: 180, phase: "approach" });
		expect(board(w)).toEqual(["claude·p-a 4-1"]);
		run(w, DT, () => w.duels.active() === null); // through result and retract to the end
		expect(w.chars.get("b")!.duelPose).toBeNull();
		expect(board(w)).toEqual(["claude·p-a 4-1"]);
	});

	test("a room without a duel never schedules a local one", () => {
		const w = duelWorld();
		w.reconcile(snap(0, { duel: null, scores: [] }), 0);
		const end = GAP_MAX_MS + 5000;
		let now = 0;
		while (now < end) {
			now += DT;
			w.update(DT, now, EPOCH0 + now);
			expect(w.duels.active()).toBeNull();
		}
	});

	test("entering room mode cancels the local duel and adopts the room's board", () => {
		const w = duelWorld();
		let now = runUntil(w, 0, () => w.duels.active()?.phase === "clash");
		w.reconcile(snap(now, { duel: null, scores: [row] }), now);
		now += DT;
		w.update(DT, now, EPOCH0 + now);
		expect(w.duels.active()).toBeNull();
		for (const c of w.chars.values()) {
			expect(c.duelPose).toBeNull();
			expect(c.pending?.state).not.toBe("DUELING");
		}
		expect(board(w)).toEqual(["claude·p-a 4-1"]);
	});

	test("entering local mode clears the board and lets the local director schedule", () => {
		const w = duelWorld();
		w.reconcile(snap(0, { duel: duel(EPOCH0), scores: [row] }), 0);
		let now = run(w, 0, () => w.duels.active()?.phase === "clash");
		const v = w.scoreboard.version;
		w.reconcile(snap(now), now);
		now += DT;
		w.update(DT, now, EPOCH0 + now);
		expect(w.duels.active()).toBeNull(); // the followed duel is dropped
		expect(w.scoreboard.top(5)).toEqual([]);
		expect(w.scoreboard.version).not.toBe(v);
		const localFrom = now;
		now = runUntil(w, now, () => w.duels.active() !== null);
		expect(now - localFrom).toBeGreaterThanOrEqual(GAP_MIN_MS);
	});
});
