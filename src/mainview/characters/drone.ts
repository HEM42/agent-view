import type { Subagent } from "../../shared/types";
import { DESKS, type DeskSpot, type Vec2 } from "../scene/layout";
import { hashString } from "../sprites/palette";
import { textWidth } from "../ui/font3x5";

export const MAX_DRONES = 6;
export const LEAVE_MS = 400;
export const SPARK_MS = 240;
/** Only drones this fresh get the arrival spark: no spark storm after a reconnect. */
export const SPARK_IF_YOUNGER_MS = 2000;
const TOP_ROW_Y = 120; // desk row A baseY: the swarm box is authored against it

export interface Drone {
	id: string; // Claude agent_id
	parentId: string;
	deskId: string; // kept, so a drone can still fly off after its parent despawned
	accent: string; // parent's project color
	type: string;
	startedAt: number; // epoch ms
	description?: string;
	model?: string;
	seed: number;
	bornAt: number; // frame clock
	spark: boolean;
	leavingAt: number | null; // frame clock
}

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export function createDrone(
	s: Subagent,
	parent: { id: string; deskId: string; accent: string },
	now: number,
	wallNow: number,
): Drone {
	return {
		id: s.id,
		parentId: parent.id,
		deskId: parent.deskId,
		accent: parent.accent,
		type: s.type,
		startedAt: s.startedAt,
		...(s.description ? { description: s.description } : {}),
		...(s.model ? { model: s.model } : {}),
		seed: hashString(s.id),
		bornAt: now,
		spark: wallNow - s.startedAt < SPARK_IF_YOUNGER_MS,
		leavingAt: null,
	};
}

export function deskSpot(id: string): DeskSpot | undefined {
	return DESKS.find((d) => d.id === id);
}

/** Top-left of the 5x3 sprite: a per-drone Lissajous drift inside the desk's swarm box. */
export function swarmPos(d: Drone, desk: DeskSpot, now: number): Vec2 {
	const dy = desk.pos.y - TOP_ROW_Y;
	const a = now / (900 + (d.seed % 5) * 170) + d.seed;
	const b = now / (1300 + (d.seed % 7) * 110) + d.seed * 0.3;
	const x = desk.pos.x - 2 + Math.sin(a) * 11;
	let y = 90 + dy + Math.sin(b) * 4;
	if (d.leavingAt !== null) y -= Math.min(1, (now - d.leavingAt) / LEAVE_MS) * 12; // flies straight up
	return { x: Math.round(x), y: Math.round(y) };
}

export function droneAlpha(d: Drone, now: number): number {
	return d.leavingAt === null ? 1 : Math.max(0, 1 - (now - d.leavingAt) / LEAVE_MS);
}

/** Moving 5x3 sprites are hard to hit: pad to 7x5. */
export function droneHitBox(p: Vec2): Box {
	return { x: p.x - 1, y: p.y - 1, w: 7, h: 5 };
}

/** Top-left of the "+N" tag, right of the swarm box. */
export function plusPos(desk: DeskSpot): Vec2 {
	return { x: desk.pos.x + 14, y: 84 + desk.pos.y - TOP_ROW_Y };
}

export function plusHitBox(desk: DeskSpot, count: number): Box {
	const p = plusPos(desk);
	return { x: p.x - 1, y: p.y - 1, w: textWidth(`+${count}`) + 2, h: 7 };
}
