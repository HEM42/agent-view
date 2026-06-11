/**
 * Furniture sheets for the cyberpunk pixel office (side-view dollhouse).
 * Anchors sit at bottom-center of each sprite unless noted otherwise.
 */

import type { SpriteSheet } from "../pixel";
import { PAL } from "../palette";

/** Shared char -> color mapping for every furniture sheet. */
const P = {
	k: PAL.ink,
	n: PAL.night,
	u: PAL.dusk,
	s: PAL.slate,
	t: PAL.steel,
	l: PAL.lilac,
	w: PAL.white,
	c: PAL.neonCyan,
	C: PAL.deepCyan,
	b: PAL.holoBlue,
	m: PAL.neonMagenta,
	M: PAL.deepMagenta,
	g: PAL.neonGreen,
};

const d = (n: number) => ".".repeat(n);

// ---------------------------------------------------------------- DESK 28x20
// Workstation: slate/steel top on 2px legs, stool on the LEFT (character sits
// facing right), 1px neonCyan keyboard strip on the desk surface.

export const DESK: SpriteSheet = {
	palette: P,
	anchor: { x: 14, y: 19 },
	anchors: { stool: { x: 3, y: 8 } },
	frames: {
		// stool is a separate frame so it can draw BEHIND the seated
		// character while the desk body draws in front: stool→char→desk
		desk: [
			d(28),
			d(28),
			d(28),
			d(28),
			"..........ccccccc...........",
			"........kkkkkkkkkkkkkkkkkkkk",
			"........kttttttttttttttttttk",
			"........kssssssssssssssssssk",
			"........kkkkkkkkkkkkkkkkkkkk",
			".........tk..............tk.",
			".........tk..............tk.",
			".........tk..............tk.",
			".........tk..............tk.",
			".........tk..............tk.",
			".........tk..............tk.",
			".........tk..............tk.",
			".........tk..............tk.",
			".........tk..............tk.",
			".........tk..............tk.",
			"........kkkk............kkkk",
		],
		stool: [
			"kkkkkk",
			"kssssk",
			"kkkkkk",
			"..tk..",
			"..tk..",
			"..tk..",
			"..tk..",
			"..tk..",
			".kkkk.",
		],
	},
};

// -------------------------------------------------------------- SCREEN 11x12
// Floating holo-screen, ANGLED to face the seated character on the LEFT:
// foreshortened width, slight trapezoid corners and a steel back-edge ('t')
// on the right read as depth. Lit frames cycle a neonCyan scanline stepping
// down; white cursor (Φ marker) blinks on frames 0/2.

const SCR_W = 9;
const SCR_H = 10;

/** Vertical face span per column — the up-right shear is the rotation. */
function scrSpan(x: number): [number, number] | null {
	if (x === 1 || x === 2) return [3, 8];
	if (x === 3 || x === 4) return [2, 7];
	if (x === 5 || x === 6) return [1, 6];
	return null;
}

/**
 * scanK: scanline offset within the face (follows the panel's slant);
 * -1 = no scan. lit=false renders the dim/off panel.
 */
function scrFrame(scanK: number, cursor: boolean, lit = true): string[] {
	const grid: string[][] = Array.from({ length: SCR_H }, () =>
		Array.from({ length: SCR_W }, () => "."),
	);
	for (let x = 0; x < SCR_W; x++) {
		const span = scrSpan(x);
		if (!span) continue;
		const [top, bottom] = span;
		for (let y = top; y <= bottom; y++) {
			const k = y - top;
			let ch = lit ? "b" : "k";
			// two darker "code line" gaps that follow the panel's slant
			if (lit && k === 2 && x <= 4) ch = "n";
			if (lit && k === 4 && x >= 3) ch = "n";
			if (lit && k === scanK) ch = "c"; // slanted scanline sweep
			grid[y]![x] = ch;
		}
		// bezel above/below each column
		grid[top - 1]![x] = "C";
		if (bottom + 1 < SCR_H) grid[bottom + 1]![x] = "C";
	}
	// side bezels + steel back edge on the right (depth)
	for (let y = 0; y < SCR_H; y++) {
		const s1 = scrSpan(1)!;
		const s6 = scrSpan(6)!;
		if (y >= s1[0] - 1 && y <= s1[1] + 1) grid[y]![0] = "C";
		if (y >= s6[0] - 1 && y <= Math.min(s6[1] + 1, SCR_H - 1)) {
			grid[y]![7] = "C";
			if (y >= s6[0] && y <= s6[1]) grid[y]![8] = "t";
		}
	}
	if (lit && cursor) grid[7]![2] = "w"; // blinking cursor, lower-left of face
	return grid.map((row) => row.join(""));
}

export const SCREEN: SpriteSheet = {
	palette: P,
	anchor: { x: 4, y: 9 },
	frames: {
		"screen.dim": scrFrame(-1, false, false),
		"screen.0": scrFrame(1, true),
		"screen.1": scrFrame(3, false),
		"screen.2": scrFrame(5, true),
	},
};

// --------------------------------------------------------------- COUCH 56x22
// Three dusk cushions on a slate body, neonMagenta piping on the backrest
// top, 2px steel legs. Faces LEFT (toward the TV).

const CUSH = (f: string) =>
	`kssssk${f.repeat(14)}k${f.repeat(14)}k${f.repeat(14)}kssssk`;

export const COUCH: SpriteSheet = {
	palette: P,
	anchor: { x: 28, y: 21 },
	frames: {
		couch: [
			`..k${"m".repeat(50)}k..`,
			`..k${"s".repeat(50)}k..`,
			`..k${"s".repeat(50)}k..`,
			`..k${"s".repeat(50)}k..`,
			`..k${"s".repeat(50)}k..`,
			`.kkkk.${"s".repeat(44)}.kkkk.`,
			`kttttk${"s".repeat(44)}kttttk`,
			`kssssk${"s".repeat(44)}kssssk`,
			`kssssk${"s".repeat(44)}kssssk`,
			`kssss${"k".repeat(46)}ssssk`,
			CUSH("u"),
			CUSH("u"),
			CUSH("u"),
			CUSH("n"),
			`kssss${"k".repeat(46)}ssssk`,
			`kssssk${"s".repeat(44)}kssssk`,
			`kssssk${"s".repeat(44)}kssssk`,
			`kssssk${"s".repeat(44)}kssssk`,
			"k".repeat(56),
			`...tt${d(46)}tt...`,
			`...tt${d(46)}tt...`,
			`...kk${d(46)}kk...`,
		],
	},
};

// ------------------------------------------------------------------ TV 30x28
// Retro CRT on a stand, screen facing RIGHT (toward the couch). The deep
// tube back on the left + thin right bezel sell the facing.

const TV_N = "n".repeat(15);
// Right bezel is lit steel (screen faces right); left side is the tube back.
const TV_TUBE = (mid: string) => `..k${mid}kss${TV_N}ttk.`;
const TV_BASE: string[] = [
	`........${"k".repeat(21)}.`,
	`........k${"s".repeat(19)}k.`,
	`........kss${"k".repeat(15)}ttk.`,
	`..kkkkkkkss${TV_N}ttk.`,
	TV_TUBE("uuuuu"),
	TV_TUBE("uuuuu"),
	TV_TUBE("ukkku"),
	TV_TUBE("uuuuu"),
	TV_TUBE("uuuuu"),
	TV_TUBE("ukkku"),
	TV_TUBE("uuuuu"),
	TV_TUBE("uuuuu"),
	TV_TUBE("ukkku"),
	TV_TUBE("uuuuu"),
	TV_TUBE("uuuuu"),
	TV_TUBE("uuuuu"),
	`..kkkkkkkss${TV_N}ttk.`,
	`........kss${"k".repeat(15)}ttk.`,
	`........k${"s".repeat(17)}Mtk.`,
	`........${"k".repeat(21)}.`,
	`${d(12)}kuuuuuk${d(11)}`,
	`${d(12)}kuuuuuk${d(11)}`,
	`${d(12)}kuuuuuk${d(11)}`,
	`${d(12)}kuuuuuk${d(11)}`,
	`${d(8)}${"k".repeat(15)}${d(7)}`,
	`${d(8)}k${"s".repeat(13)}k${d(7)}`,
	`${d(8)}k${"u".repeat(13)}k${d(7)}`,
	`${d(8)}${"k".repeat(15)}${d(7)}`,
];

/** Stamp 2x2 noise blocks onto a copy of the base frame. */
function stamp(
	base: string[],
	blocks: Array<[x: number, y: number, ch: string]>,
): string[] {
	const rows = base.map((r) => r.split(""));
	for (const [bx, by, ch] of blocks) {
		for (let dy = 0; dy < 2; dy++) {
			for (let dx = 0; dx < 2; dx++) {
				rows[by + dy]![bx + dx] = ch;
			}
		}
	}
	return rows.map((r) => r.join(""));
}

// Screen interior is x 11..25, y 3..16 — blocks stay within x<=24, y<=15.
export const TV: SpriteSheet = {
	palette: P,
	anchor: { x: 15, y: 27 },
	frames: {
		"tv.off": TV_BASE,
		"tv.0": stamp(TV_BASE, [
			[11, 3, "C"],
			[17, 5, "b"],
			[23, 4, "C"],
			[13, 8, "w"],
			[20, 9, "C"],
			[15, 12, "b"],
			[23, 13, "C"],
		]),
		"tv.1": stamp(TV_BASE, [
			[14, 4, "b"],
			[21, 3, "w"],
			[11, 7, "C"],
			[18, 8, "b"],
			[24, 11, "C"],
			[12, 12, "C"],
			[17, 14, "b"],
		]),
		"tv.2": stamp(TV_BASE, [
			[12, 5, "C"],
			[19, 4, "C"],
			[24, 7, "b"],
			[15, 6, "w"],
			[11, 10, "b"],
			[21, 12, "C"],
			[14, 14, "C"],
		]),
		"tv.3": stamp(TV_BASE, [
			[16, 3, "C"],
			[11, 5, "b"],
			[22, 5, "C"],
			[13, 10, "C"],
			[18, 11, "w"],
			[24, 14, "b"],
			[15, 15, "C"],
		]),
	},
};

// ----------------------------------------------------------------- BED 44x60
// 3-level bunk: 2px steel posts, three 36x6 slate mattresses (tops at y=10,
// 28, 46), white 6x4 pillows on the LEFT end, ladder rungs on the right.

const POSTS = `ts${d(40)}st`;
const RUNG = `ts${d(36)}ttttst`;
const RAIL = `ts${"t".repeat(40)}st`;
const MAT = (f: string, rung: boolean) =>
	`tsk${f.repeat(34)}k${rung ? "tttt" : "...."}st`;
const MAT_EDGE = (rung: boolean) =>
	`ts${"k".repeat(36)}${rung ? "tttt" : "...."}st`;
const PIL_TOP = (rung: boolean) =>
	`ts..kkkk${d(30)}${rung ? "tttt" : "...."}st`;
const PIL_A = (rung: boolean) =>
	`ts.kwwwwk${d(29)}${rung ? "tttt" : "...."}st`;
const PIL_B = (rung: boolean) =>
	`ts.kwwwlk${d(29)}${rung ? "tttt" : "...."}st`;
const PIL_BOT = `ts..kkkk${d(34)}st`;

export const BED: SpriteSheet = {
	palette: P,
	anchor: { x: 22, y: 59 },
	frames: {
		bed: [
			`kk${d(40)}kk`, // 0 post caps
			POSTS, // 1
			RAIL, // 2 top guard rail
			POSTS, // 3
			POSTS, // 4
			POSTS, // 5
			PIL_TOP(true), // 6
			PIL_A(false), // 7
			PIL_B(false), // 8
			PIL_BOT, // 9
			MAT_EDGE(true), // 10 mattress 1
			MAT("t", false), // 11
			MAT("s", false), // 12
			MAT("s", false), // 13
			MAT("u", true), // 14
			MAT_EDGE(false), // 15
			RAIL, // 16
			POSTS, // 17
			RUNG, // 18
			POSTS, // 19
			POSTS, // 20
			POSTS, // 21
			RUNG, // 22
			POSTS, // 23
			PIL_TOP(false), // 24
			PIL_A(false), // 25
			PIL_B(true), // 26
			PIL_BOT, // 27
			MAT_EDGE(false), // 28 mattress 2
			MAT("t", false), // 29
			MAT("s", true), // 30
			MAT("s", false), // 31
			MAT("u", false), // 32
			MAT_EDGE(false), // 33
			RAIL, // 34 (rail + rung row)
			POSTS, // 35
			POSTS, // 36
			POSTS, // 37
			RUNG, // 38
			POSTS, // 39
			POSTS, // 40
			POSTS, // 41
			PIL_TOP(true), // 42
			PIL_A(false), // 43
			PIL_B(false), // 44
			PIL_BOT, // 45
			MAT_EDGE(true), // 46 mattress 3
			MAT("t", false), // 47
			MAT("s", false), // 48
			MAT("s", false), // 49
			MAT("u", true), // 50
			MAT_EDGE(false), // 51
			RAIL, // 52
			POSTS, // 53
			RUNG, // 54
			POSTS, // 55
			POSTS, // 56
			POSTS, // 57
			RUNG, // 58
			`kk${d(40)}kk`, // 59 post feet
		],
	},
};

// ---------------------------------------------------------------- DOOR 24x44
// Sliding door: steel frame, dusk panel with a vertical neonCyan light
// strip, 3x4 keypad on the right frame with a 1px LED. The panel slides
// LEFT into the wall (doorway opening is x 2..20, panel is 19px wide).

function doorRows(slide: number, led: string): string[] {
	const W = 24;
	const H = 44;
	const g: string[][] = Array.from({ length: H }, () =>
		new Array<string>(W).fill("."),
	);
	// dark doorway
	for (let y = 3; y < H; y++) {
		for (let x = 2; x <= 20; x++) g[y]![x] = "k";
	}
	// panel (19 cols), visible part shifted left by `slide`
	for (let col = slide; col < 19; col++) {
		const x = 2 + col - slide;
		if (x < 2 || x > 20) continue;
		for (let y = 3; y < H; y++) {
			let ch = "u";
			if (col === 18) ch = "t"; // leading edge
			else if (col === 17) ch = "n"; // edge shadow
			else if (col === 9 && y >= 6 && y <= 40) ch = "c"; // light strip
			if (y === H - 1) ch = "k"; // floor shadow
			g[y]![x] = ch;
		}
	}
	// frame: sides + header
	for (let y = 0; y < H; y++) {
		g[y]![0] = "k";
		g[y]![1] = "t";
		g[y]![21] = "t";
		g[y]![22] = "t";
		g[y]![23] = "k";
	}
	for (let x = 0; x < W; x++) g[0]![x] = "k";
	for (let x = 1; x <= 22; x++) g[1]![x] = "t";
	g[1]![0] = "k";
	g[1]![23] = "k";
	for (let x = 2; x <= 20; x++) g[2]![x] = "k";
	// keypad on right frame (x 21..23, y 17..20); outer column stays ink so
	// the door silhouette keeps its outline
	const pad = ["nnk", `n${led}k`, "nlk", "nnk"];
	for (let r = 0; r < 4; r++) {
		for (let cIdx = 0; cIdx < 3; cIdx++) g[17 + r]![21 + cIdx] = pad[r]![cIdx]!;
	}
	return g.map((row) => row.join(""));
}

export const DOOR: SpriteSheet = {
	palette: P,
	anchor: { x: 12, y: 43 },
	frames: {
		"door.0": doorRows(0, "M"),
		"door.1": doorRows(7, "g"),
		"door.2": doorRows(13, "g"),
		"door.3": doorRows(19, "g"),
	},
};

// ----------------------------------------------------------------- BAR 64x30
// Ramen stall, bottom-right idle corner: striped canopy with neonMagenta
// trim, hanging banner, long counter hiding the guests' legs. Guests sit
// BEHIND the counter (draw order: character → bar), faces in the gap under
// the canopy. Bowls + steam are drawn by the scene per occupied seat.

const BAR_W = 64;

function barStripeRow(): string {
	let row = "k";
	for (let x = 1; x < BAR_W - 1; x++) {
		row += Math.floor(x / 4) % 2 === 0 ? "m" : "u"; // neon awning stripes
	}
	return `${row}k`;
}

function barScallopRow(): string {
	let row = "";
	for (let x = 0; x < BAR_W; x++) row += x % 2 === 0 ? "k" : ".";
	return row;
}

function barPanelRow(): string {
	let row = "k";
	for (let x = 1; x < BAR_W - 1; x++) row += x % 8 === 0 ? "k" : "u";
	return `${row}k`;
}

function barGapRow(banner: string): string {
	// support poles at both ends + the hanging banner on the left
	const cells = Array.from({ length: BAR_W }, () => ".");
	cells[2] = cells[3] = "t";
	cells[60] = cells[61] = "t";
	banner.split("").forEach((ch, i) => {
		if (ch !== ".") cells[1 + i] = ch;
	});
	return cells.join("");
}

export const BAR_SHEET: SpriteSheet = {
	palette: P,
	anchor: { x: 32, y: 29 },
	frames: {
		bar: [
			"k".repeat(BAR_W),
			barStripeRow(),
			barStripeRow(),
			barStripeRow(),
			barStripeRow(),
			barStripeRow(),
			barStripeRow(),
			`k${"m".repeat(BAR_W - 2)}k`,
			barScallopRow(),
			barGapRow("CCCCCCC"),
			barGapRow("CnwwnnC"),
			barGapRow("CnnwnnC"),
			barGapRow("CnwwwnC"),
			barGapRow("CnnnwnC"),
			barGapRow("CCCCCCC"),
			"k".repeat(BAR_W),
			`k${"t".repeat(BAR_W - 2)}k`,
			`k${"s".repeat(BAR_W - 2)}k`,
			`k${"m".repeat(BAR_W - 2)}k`,
			barPanelRow(),
			barPanelRow(),
			barPanelRow(),
			barPanelRow(),
			barPanelRow(),
			barPanelRow(),
			barPanelRow(),
			barPanelRow(),
			`k${"u".repeat(BAR_W - 2)}k`,
			"k".repeat(BAR_W),
			"......tt" + ".".repeat(48) + "tt......",
		],
	},
};
