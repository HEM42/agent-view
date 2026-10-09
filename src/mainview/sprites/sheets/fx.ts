/**
 * FX sheet: status bubbles, sleep particles, glow stamps — and Daemon the cat.
 *
 * - BUBBLES: 10x10 speech-bubble plates with pulsing glyphs (anchor = tail tip
 *   region, bottom-center).
 * - ZGLYPH: 4x5 drifting "z" sleep particles, spawned procedurally.
 * - CAT: 14x10 ink-black cat "Daemon". All side-view frames FACE RIGHT
 *   (use the pre-flipped variant for left). stare.* faces the viewer.
 * - GLOWDOT: 6x6 pre-rendered LED glow stamp.
 * - DRONE: 5x3 subagent drone (2-frame rotor; 'a' = eye, swapped to the parent's project accent) and a 3x3 arrival spark.
 * - STARS: 7x3 dizzy stars circling a duel loser's head (never a status bubble).
 */

import type { SpriteSheet } from "../pixel";
import { PAL } from "../palette";

const FX_PALETTE = {
	k: PAL.ink,
	n: PAL.night,
	d: PAL.dusk,
	s: PAL.steel,
	l: PAL.lilac,
	w: PAL.white,
	c: PAL.neonCyan,
	C: PAL.deepCyan,
	y: PAL.neonYellow,
	g: PAL.neonGreen,
};

/** 10x10 status bubbles; tail points down-left toward the speaker. */
export const BUBBLES: SpriteSheet = {
	palette: FX_PALETTE,
	anchor: { x: 5, y: 9 },
	frames: {
		"bang.0": [
			".ssssssss.",
			"skkkyykkks",
			"skkkyykkks",
			"skkkyykkks",
			"skkkkkkkks",
			"skkkyykkks",
			"skkkkkkkks",
			".ssssssss.",
			"...s......",
			"..s.......",
		],
		"bang.1": [
			".ssssssss.",
			"skkkkkkkks",
			"skkkyykkks",
			"skkkyykkks",
			"skkkyykkks",
			"skkkkkkkks",
			"skkkyykkks",
			".ssssssss.",
			"...s......",
			"..s.......",
		],
		"question.0": [
			".ssssssss.",
			"skkccckkks",
			"skkkkckkks",
			"skkkckkkks",
			"skkkkkkkks",
			"skkkckkkks",
			"skkkkkkkks",
			".ssssssss.",
			"...s......",
			"..s.......",
		],
		"question.1": [
			".ssssssss.",
			"skkkkkkkks",
			"skkccckkks",
			"skkkkckkks",
			"skkkckkkks",
			"skkkkkkkks",
			"skkkckkkks",
			".ssssssss.",
			"...s......",
			"..s.......",
		],
	},
};

/** 4x5 lilac sleep particle; two frames give a 1px drift wobble. */
export const ZGLYPH: SpriteSheet = {
	palette: FX_PALETTE,
	anchor: { x: 2, y: 4 },
	frames: {
		"z.0": [
			"llll", //
			"..l.",
			".l..",
			"llll",
			"....",
		],
		"z.1": [
			"....", //
			"llll",
			"..l.",
			".l..",
			"llll",
		],
	},
};

/**
 * 14x10 "Daemon" — ink-black office cat. neonGreen eyes, one white chest
 * pixel. Side frames face RIGHT; stare.* faces the viewer.
 */
export const CAT: SpriteSheet = {
	palette: FX_PALETTE,
	anchor: { x: 7, y: 9 },
	frames: {
		// -- walk: 3-frame cycle, legs alternate, tail sways 1px --
		"cat.walk.0": [
			"..............",
			".k............",
			".k.......k..k.",
			".k.......kkkk.",
			"..k......kkgkk",
			"..ddddddkkkkk.",
			".kkkkkkkkkkwk.",
			"..kkkkkkkkkkk.",
			"...k.k...k.k..",
			"...k.......k..",
		],
		"cat.walk.1": [
			"..............",
			"..k...........",
			"..k......k..k.",
			"..k......kkkk.",
			"..k......kkgkk",
			"..ddddddkkkkk.",
			".kkkkkkkkkkwk.",
			"..kkkkkkkkkkk.",
			"....k.....k...",
			"....k.....k...",
		],
		"cat.walk.2": [
			"..............",
			".k............",
			".k.......k..k.",
			".k.......kkkk.",
			"..k......kkgkk",
			"..ddddddkkkkk.",
			".kkkkkkkkkkwk.",
			"..kkkkkkkkkkk.",
			"...k.k...k.k..",
			".....k...k....",
		],
		// -- sit: upright profile, tail flicks 1px --
		"cat.sit.0": [
			"..............",
			".........k..k.",
			".........kkkk.",
			".........kkgk.",
			".........kkkk.",
			"........dkkk..",
			".......dkkwk..",
			"......dkkkkk..",
			"...k.kkkkkkk..",
			"....kkk...kk..",
		],
		"cat.sit.1": [
			"..............",
			".........k..k.",
			".........kkkk.",
			".........kkgk.",
			".........kkkk.",
			"........dkkk..",
			".......dkkwk..",
			"......dkkkkk..",
			".....kkkkkkk..",
			"...kkkk...kk..",
		],
		// -- sleep: 12x7 curl, frame 1 inhales 1px --
		"cat.sleep.0": [
			"..............",
			"..............",
			"..............",
			"..........k...",
			"....kkkkkkk...",
			"..kkkkkkkkkkk.",
			".kkkkkkkkkkkk.",
			".kkkkkkkkkkkk.",
			".kkddddddkkkk.",
			"..kkkkkkkkkk..",
		],
		"cat.sleep.1": [
			"..............",
			"..............",
			"..........k...",
			"....kkkkkkk...",
			"...kkkkkkkkk..",
			"..kkkkkkkkkkk.",
			".kkkkkkkkkkkk.",
			".kkkkkkkkkkkk.",
			".kkddddddkkkk.",
			"..kkkkkkkkkk..",
		],
		// -- stare: faces the VIEWER; frame 1 = slow blink --
		"cat.stare.0": [
			"....k...k.....",
			"....kkkkk.....",
			"....kgkgk.....",
			"....kkkkk.....",
			".....kkk......",
			"....kkwkk.....",
			"...kkkkkkk....",
			"...kkkkkkk....",
			"...kkkkkkk....",
			"...kk..kk.kk..",
		],
		"cat.stare.1": [
			"....k...k.....",
			"....kkkkk.....",
			"....kdkdk.....",
			"....kkkkk.....",
			".....kkk......",
			"....kkwkk.....",
			"...kkkkkkk....",
			"...kkkkkkk....",
			"...kkkkkkk....",
			"...kk..kk.kk..",
		],
	},
};

/** 6x6 LED glow stamp: neonCyan 2x2 core, deepCyan 1px halo. */
export const GLOWDOT: SpriteSheet = {
	palette: FX_PALETTE,
	anchor: { x: 3, y: 5 },
	frames: {
		dot: [
			"......", //
			"..CC..",
			".CccC.",
			".CccC.",
			"..CC..",
			"......",
		],
	},
};

/** 5x3 subagent drone; anchor top-left. 'a' is swapped per parent. */
export const DRONE: SpriteSheet = {
	palette: { r: PAL.lilac, s: PAL.steel, a: PAL.neonCyan, w: PAL.white, c: PAL.neonCyan },
	anchor: { x: 0, y: 0 },
	frames: {
		"drone.0": ["r.r.r", "ssass", ".s.s."],
		"drone.1": [".r.r.", "ssass", ".s.s."],
		"spark.0": [".w.", "wcw", ".w."],
		"spark.1": ["w.w", ".c.", "w.w"],
	},
};

/** 7x3 dizzy stars over a knocked-down duelist; two frames alternate to twinkle. */
export const STARS: SpriteSheet = {
	palette: FX_PALETTE,
	anchor: { x: 3, y: 2 },
	frames: {
		"stars.0": ["y.....w", ".......", "...l..."],
		"stars.1": ["...w...", ".......", "l.....y"],
	},
};
