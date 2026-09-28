import { describe, expect, test } from "bun:test";
import type { Subagent } from "../shared/types";
import { LEAVE_MS, MAX_DRONES, SPARK_IF_YOUNGER_MS, deskSpot, swarmPos, type Drone } from "./characters/drone";
import { DroneFleet, type DroneParent } from "./drones";
import { DESKS } from "./scene/layout";

const WALL = 1_800_000_000_000;
const subs = (n: number, from = 0): Subagent[] =>
	Array.from({ length: n }, (_, i) => ({
		id: `s${from + i}`,
		type: i % 2 ? "Explore" : "general-purpose",
		startedAt: WALL - 60_000 + from + i,
	}));
const parent = (over: Partial<DroneParent> = {}): DroneParent => ({
	id: "p1",
	deskId: DESKS[0]!.id,
	accent: "#FF2E88",
	subagents: subs(2),
	...over,
});
const live = (f: DroneFleet) => f.drones().filter((d) => d.leavingAt === null);

describe("DroneFleet", () => {
	test("one drone per subagent at the parent's desk, in its accent", () => {
		const f = new DroneFleet();
		f.sync([parent()], 0, WALL);
		expect(live(f).map((d) => [d.id, d.deskId, d.accent])).toEqual([
			["s0", DESKS[0]!.id, "#FF2E88"],
			["s1", DESKS[0]!.id, "#FF2E88"],
		]);
		expect(f.deskBusy(DESKS[0]!.id)).toBe(true);
		expect(f.deskBusy(DESKS[1]!.id)).toBe(false);
	});

	test("cap: the 6 oldest fly, the rest are counted", () => {
		const f = new DroneFleet();
		f.sync([parent({ subagents: subs(9) })], 0, WALL);
		expect(live(f).map((d) => d.id)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5"]);
		expect(f.overflows()).toHaveLength(1);
		expect(f.overflows()[0]!.hidden.map((s) => s.id)).toEqual(["s6", "s7", "s8"]);
		expect(MAX_DRONES).toBe(6);
	});

	test("a new subagent never displaces a flying drone; a finished one frees its slot", () => {
		const f = new DroneFleet();
		f.sync([parent({ subagents: subs(6) })], 0, WALL);
		const before = live(f).map((d) => d.id);
		f.sync([parent({ subagents: subs(7) })], 10, WALL);
		expect(live(f).map((d) => d.id)).toEqual(before);
		f.sync([parent({ subagents: subs(7).slice(1) })], 20, WALL); // s0 finished
		expect(live(f).map((d) => d.id)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
		expect(f.overflows()).toEqual([]);
	});

	test("a finished subagent's drone leaves, then is removed after LEAVE_MS", () => {
		const f = new DroneFleet();
		f.sync([parent()], 0, WALL);
		f.sync([parent({ subagents: subs(1) })], 100, WALL);
		const leaving = f.drones().find((d) => d.id === "s1")!;
		expect(leaving.leavingAt).toBe(100);
		f.sync([parent({ subagents: subs(1) })], 100 + LEAVE_MS, WALL);
		expect(f.drones().map((d) => d.id)).toEqual(["s0"]);
	});

	test("a parent that leaves the room takes its drones with it", () => {
		const f = new DroneFleet();
		f.sync([parent({ subagents: subs(8) })], 0, WALL);
		f.sync([], 50, WALL);
		expect(live(f)).toEqual([]);
		expect(f.overflows()).toEqual([]);
		expect(f.deskBusy(DESKS[0]!.id)).toBe(false);
	});

	test("no desk (all 15 owned): no drones until one frees up", () => {
		const f = new DroneFleet();
		f.sync([parent({ deskId: null })], 0, WALL);
		expect(f.drones()).toEqual([]);
		expect(f.overflows()).toEqual([]);
		f.sync([parent({ deskId: DESKS[3]!.id })], 10, WALL);
		expect(live(f).map((d) => d.deskId)).toEqual([DESKS[3]!.id, DESKS[3]!.id]);
	});

	test("only fresh subagents get the arrival spark (no storm after a reconnect)", () => {
		const f = new DroneFleet();
		const fresh = { id: "new", type: "Explore", startedAt: WALL - 100 };
		const old = { id: "old", type: "Explore", startedAt: WALL - SPARK_IF_YOUNGER_MS - 1 };
		f.sync([parent({ subagents: [old, fresh] })], 0, WALL);
		expect(Object.fromEntries(f.drones().map((d) => [d.id, d.spark]))).toEqual({ old: false, new: true });
	});
});

describe("swarmPos", () => {
	const drone = (id: string): Drone => ({
		id,
		parentId: "p",
		deskId: "",
		accent: "",
		type: "x",
		startedAt: 0,
		seed: [...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) >>> 0,
		bornAt: 0,
		spark: false,
		leavingAt: null,
	});

	test("stays inside the desk's swarm box on every row", () => {
		for (const desk of DESKS) {
			const dy = desk.pos.y - 120;
			for (const id of ["a", "bb", "afb6f25f3daf9db10", "zz9"]) {
				for (let t = 0; t < 60_000; t += 97) {
					const p = swarmPos(drone(id), desk, t);
					expect(p.x).toBeGreaterThanOrEqual(desk.pos.x - 13);
					expect(p.x).toBeLessThanOrEqual(desk.pos.x + 9);
					expect(p.y).toBeGreaterThanOrEqual(86 + dy);
					expect(p.y).toBeLessThanOrEqual(94 + dy);
				}
			}
		}
	});

	test("deskSpot finds desks by id", () => {
		expect(deskSpot(DESKS[4]!.id)).toBe(DESKS[4]);
		expect(deskSpot("nope")).toBeUndefined();
	});
});
