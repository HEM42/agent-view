import { describe, expect, test } from "bun:test";
import type { Snapshot } from "../shared/types";
import { plusPos, swarmPos } from "./characters/drone";
import { DESKS } from "./scene/layout";
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
