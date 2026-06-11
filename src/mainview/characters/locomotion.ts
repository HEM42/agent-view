import {
	CORRIDORS,
	LANES,
	nearestLane,
	type Vec2,
} from "../scene/layout";

export const WALK_SPEED = 40; // virtual px/s

/**
 * Lane-based routing: vertical to your lane, corridor-hop between adjacent
 * lanes, horizontal to the target column, vertical approach to the spot.
 * Furniture never intersects lanes or corridors, so no pathfinding needed.
 */
export function buildPath(from: Vec2, to: Vec2, toLane: number): Vec2[] {
	const path: Vec2[] = [];
	let lane = nearestLane(from.y);
	let x = from.x;

	// step onto own lane first (e.g. stand up from a seat)
	push(path, { x, y: LANES[lane]! });

	while (lane !== toLane) {
		const next = lane < toLane ? lane + 1 : lane - 1;
		const pair = Math.min(lane, next); // corridor set between lane pair
		const corridor = pickCorridor(CORRIDORS[pair]!, x, to.x);
		push(path, { x: corridor, y: LANES[lane]! });
		push(path, { x: corridor, y: LANES[next]! });
		lane = next;
		x = corridor;
	}

	push(path, { x: to.x, y: LANES[toLane]! });
	push(path, to);
	return dedupe(path, from);
}

/** Corridor nearest the midpoint of travel — minimizes the detour. */
function pickCorridor(corridors: readonly number[], fromX: number, toX: number): number {
	const mid = (fromX + toX) / 2;
	let best = corridors[0]!;
	let bestD = Infinity;
	for (const c of corridors) {
		const d = Math.abs(c - mid);
		if (d < bestD) {
			bestD = d;
			best = c;
		}
	}
	return best;
}

function push(path: Vec2[], p: Vec2): void {
	const last = path[path.length - 1];
	if (last && Math.abs(last.x - p.x) < 1 && Math.abs(last.y - p.y) < 1) return;
	path.push(p);
}

function dedupe(path: Vec2[], from: Vec2): Vec2[] {
	while (
		path.length > 0 &&
		Math.abs(path[0]!.x - from.x) < 1 &&
		Math.abs(path[0]!.y - from.y) < 1
	) {
		path.shift();
	}
	return path;
}

export interface Mover {
	pos: Vec2;
	facing: 1 | -1;
	path: Vec2[];
}

/** Advance along the path. Returns true when the path is exhausted. */
export function step(m: Mover, dtMs: number, speed = WALK_SPEED): boolean {
	let budget = (speed * dtMs) / 1000;
	while (budget > 0 && m.path.length > 0) {
		const target = m.path[0]!;
		const dx = target.x - m.pos.x;
		const dy = target.y - m.pos.y;
		const dist = Math.hypot(dx, dy);
		if (dx > 0.1) m.facing = 1;
		else if (dx < -0.1) m.facing = -1;
		if (dist <= budget) {
			m.pos = { x: target.x, y: target.y };
			m.path.shift();
			budget -= dist;
		} else {
			m.pos = {
				x: m.pos.x + (dx / dist) * budget,
				y: m.pos.y + (dy / dist) * budget,
			};
			budget = 0;
		}
	}
	return m.path.length === 0;
}
