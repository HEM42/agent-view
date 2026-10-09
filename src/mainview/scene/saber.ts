import { bladeAngle, gripPoint } from "../duels";
import type { Character } from "../characters/character";
import { makeLightPool, parseHex } from "../sprites/pixel";
import { PAL } from "../sprites/palette";
import { DUEL_GRIP } from "../sprites/sheets/character";

type Ctx = OffscreenCanvasRenderingContext2D;

const glowPools = new Map<string, OffscreenCanvas>(); // per accent
const floorPools = new Map<string, OffscreenCanvas>(); // per accent

function cached(map: Map<string, OffscreenCanvas>, accent: string, w: number, h: number): OffscreenCanvas {
	let pool = map.get(accent);
	if (!pool) {
		pool = makeLightPool(w, h, accent);
		map.set(accent, pool);
	}
	return pool;
}

/** accent pushed toward white: the hot core of the blade */
function core(accent: string): string {
	const [r, g, b] = parseHex(accent);
	const mix = (v: number) => Math.round(v + (255 - v) * 0.6);
	return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/**
 * Lit lightsaber in the agent's project accent: grey hilt at the sword hand,
 * a 1px hot core with accent edges, a soft glow over the blade and a pool on
 * the floor. Nothing unless duelling, holding a grip frame and lit.
 */
export function drawSaber(ctx: Ctx, c: Character, len: number): void {
	if (c.state !== "DUELING" || len <= 0) return;
	const grip = DUEL_GRIP[c.anim.frameName()];
	if (!grip) return;
	const hand = gripPoint(c.pos, c.facing, grip);
	const angle = bladeAngle(c.facing, grip);
	const dx = Math.cos(angle);
	const dy = Math.sin(angle);
	// edges sit across the blade: above/below a flat blade, left/right of a steep one
	const [ex, ey] = Math.abs(dx) > Math.abs(dy) ? [0, 1] : [1, 0];
	const pts: { x: number; y: number }[] = [];
	for (let i = 1; i <= len; i++) {
		pts.push({ x: Math.round(hand.x + dx * (i + 1)), y: Math.round(hand.y + dy * (i + 1)) });
	}

	ctx.fillStyle = PAL.steel;
	ctx.fillRect(hand.x, hand.y, 1, 1);
	ctx.fillRect(Math.round(hand.x + dx), Math.round(hand.y + dy), 1, 1);

	ctx.globalCompositeOperation = "lighter";
	const floor = cached(floorPools, c.accent, 20, 6);
	ctx.globalAlpha = 0.18;
	ctx.drawImage(floor, Math.round(c.pos.x - 10), Math.round(c.pos.y - 3));
	const glow = cached(glowPools, c.accent, 16, 16);
	const mid = pts[Math.floor(pts.length / 2)]!;
	ctx.globalAlpha = 0.25;
	ctx.drawImage(glow, mid.x - 8, mid.y - 8);
	ctx.globalAlpha = 0.9;
	ctx.fillStyle = c.accent;
	for (const p of pts) {
		ctx.fillRect(p.x - ex, p.y - ey, 1, 1);
		ctx.fillRect(p.x + ex, p.y + ey, 1, 1);
	}
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = "source-over";

	ctx.fillStyle = core(c.accent);
	for (const p of pts) ctx.fillRect(p.x, p.y, 1, 1);
}
