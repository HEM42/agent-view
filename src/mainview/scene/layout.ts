/**
 * Room geometry for the 384x216 "dollhouse" side view. All coordinates are
 * virtual pixels. The wall/floor seam is at y=96; characters live on three
 * horizontal walk lanes and change lanes only at furniture-free corridors.
 */

export interface Vec2 {
	x: number;
	y: number;
}

export const VW = 384;
export const VH = 216;
export const WALL_Y = 96;

/** Walk lanes, top to bottom. Index is the canonical lane id. */
export const LANES = [136, 172, 206] as const;

export function nearestLane(y: number): number {
	let best = 0;
	let bestD = Infinity;
	LANES.forEach((ly, i) => {
		const d = Math.abs(ly - y);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	});
	return best;
}

/**
 * x-columns free of furniture where a character may move vertically between
 * adjacent lanes. CORRIDORS[0] connects lane 0<->1, CORRIDORS[1] lane 1<->2.
 */
export const CORRIDORS: readonly (readonly number[])[] = [
	[42, 83, 125, 167, 209, 251, 294, 352],
	[110, 250, 292],
];

// ---- furniture placement ----

/** Desk anchor x-origins (sprite is 28 wide, anchored bottom-center +14). */
const DESK_XS_AB = [48, 90, 132, 174, 216, 258];
const DESK_XS_C = [124, 166, 208]; // shifted left so the ramen bar owns the right corner

export interface DeskSpot {
	id: string;
	/** bottom-center anchor of the DESK sprite */
	pos: Vec2;
	/** lane used to approach this desk */
	lane: number;
	seatPos: Vec2; // character anchor while seated (stool, left of desk)
	standPos: Vec2; // on-lane point below the desk
	screenPos: Vec2; // bottom-center anchor of the floating holo-screen
	stoolPos: Vec2; // bottom-center anchor of the stool (draws behind char)
}

function desk(id: string, originX: number, baseY: number, lane: number): DeskSpot {
	const cx = originX + 14;
	return {
		id,
		pos: { x: cx, y: baseY },
		lane,
		seatPos: { x: originX + 5, y: baseY - 1 },
		standPos: { x: cx, y: LANES[lane]! },
		screenPos: { x: cx - 1, y: baseY - 10 }, // hovers at the desk edge, a small gap from the face
		stoolPos: { x: originX + 4, y: baseY },
	};
}

/** Fill order A1..A6, B1..B6, C1..C3 — desk n is only drawn when needed. */
export const DESKS: DeskSpot[] = [
	...DESK_XS_AB.map((x, i) => desk(`desk-a${i}`, x, 120, 0)),
	...DESK_XS_AB.map((x, i) => desk(`desk-b${i}`, x, 156, 1)),
	...DESK_XS_C.map((x, i) => desk(`desk-c${i}`, x, 192, 2)),
];

export const COUCH = {
	pos: { x: 68, y: 196 }, // bottom-center anchor (56 wide: x 40..96)
	// cushion tops are 10px below the couch sprite top (175) => butt at 186
	seats: [
		{ x: 50, y: 186 },
		{ x: 66, y: 186 },
		{ x: 82, y: 186 },
	] as Vec2[],
	lane: 2,
	armRest: { x: 44, y: 176 }, // cat nap spot
};

export const TV = {
	pos: { x: 23, y: 196 }, // 30 wide: x 8..38, faces right
	lightPool: { x: 62, y: 200 },
};

export const BED = {
	pos: { x: 354, y: 120 }, // 44x60: x 332..376, y 61..120
	lane: 0,
	ladderX: 370,
	/** character anchor while lying, top bunk first (filled top-down) */
	levels: [
		{ x: 352, y: 76 },
		{ x: 352, y: 94 },
		{ x: 352, y: 112 },
	] as Vec2[],
};

export const DOOR = {
	pos: { x: 20, y: 96 }, // 24x44: x 8..32, y 53..96
	spawn: { x: 20, y: 110 },
	lane: 0,
};

export const LOITER_SPOTS: Vec2[] = [
	{ x: 200, y: 140 },
	{ x: 310, y: 140 },
	{ x: 130, y: 205 },
	{ x: 260, y: 205 },
];

/** Ramen bar, bottom right: 4 stools behind the counter, canopy on top. */
export const BAR = {
	pos: { x: 336, y: 204 }, // 64x30 sprite: x 304..368, y 175..204
	lane: 2,
	/** character anchor while seated (behind the counter, torso in the gap) */
	seats: [
		{ x: 316, y: 196 },
		{ x: 330, y: 196 },
		{ x: 344, y: 196 },
		{ x: 358, y: 196 },
	] as Vec2[],
	bowlY: 190, // counter top, where each guest's bowl sits
	steamY: 187,
};

// ---- wall decor (static, pre-rendered into the background) ----

export const WINDOW_RECT = { x: 88, y: 24, w: 104, h: 56 };
export const SIGN = { x: 216, y: 26, letterY: 30, letterX0: 220, letterPitch: 12 };
export const POSTERS: Vec2[] = [
	{ x: 48, y: 32 },
	{ x: 48, y: 60 },
];
export const VENT = { x: 198, y: 62 };
export const CLOCK = { x: 336, y: 24, w: 44, h: 16 };
