import { decodeSheet, type DecodedSheet } from "../sprites/pixel";
import { BUBBLES, STARS, ZGLYPH } from "../sprites/sheets/fx";
import type { Character } from "../characters/character";
import { bubbleFor, hopOffset } from "../characters/character";

interface ZParticle {
	x: number;
	y: number;
	bornAt: number;
}

const Z_LIFE_MS = 2000;
const Z_SPAWN_MS = 1200;
const Z_CAP = 3;

/**
 * Status bubbles above heads: '!' pulses (blocked), '?' bobs (unknown),
 * zZz particles drift up from sleepers. Drawn in the FX pass, above all
 * entities, so a raised hand is never hidden.
 */
export class BubbleLayer {
	private bubbles: DecodedSheet = decodeSheet(BUBBLES);
	private zglyph: DecodedSheet = decodeSheet(ZGLYPH);
	private stars: DecodedSheet = decodeSheet(STARS);
	private zs = new Map<string, { particles: ZParticle[]; lastSpawn: number }>();

	draw(
		ctx: OffscreenCanvasRenderingContext2D,
		chars: Character[],
		now: number,
	): void {
		const liveSleepers = new Set<string>();

		for (const c of chars) {
			if (c.state === "DUELING" && c.duelPose === "down") {
				// duel loser: dizzy stars, deliberately unlike any status bubble
				const f = this.stars.get(`stars.${Math.floor(now / 250) % 2}`);
				if (f) ctx.drawImage(f.canvas, Math.round(c.pos.x - c.facing * 2) - f.anchorX, Math.round(c.pos.y - 14) - f.anchorY);
				continue;
			}
			const kind = bubbleFor(c);
			if (kind === "bang" || kind === "question") {
				const phase = Math.floor(now / 400) % 2;
				const frame = this.bubbles.get(`${kind}.${phase}`);
				if (!frame) continue;
				const bobY = Math.round(Math.sin(now / 500) * 1);
				const headY = c.pos.y + hopOffset(c, now) - 24;
				ctx.drawImage(
					frame.canvas,
					Math.round(c.pos.x + 4),
					Math.round(headY - frame.h + bobY),
				);
			} else if (kind === "zzz") {
				liveSleepers.add(c.id);
				this.drawZs(ctx, c, now);
			}
		}

		for (const id of this.zs.keys()) {
			if (!liveSleepers.has(id)) this.zs.delete(id);
		}
	}

	private drawZs(
		ctx: OffscreenCanvasRenderingContext2D,
		c: Character,
		now: number,
	): void {
		let state = this.zs.get(c.id);
		if (!state) {
			state = { particles: [], lastSpawn: 0 };
			this.zs.set(c.id, state);
		}
		if (
			now - state.lastSpawn >= Z_SPAWN_MS &&
			state.particles.length < Z_CAP
		) {
			state.particles.push({ x: c.pos.x + 8, y: c.pos.y - 14, bornAt: now });
			state.lastSpawn = now;
		}
		state.particles = state.particles.filter(
			(p) => now - p.bornAt < Z_LIFE_MS,
		);
		for (const p of state.particles) {
			const t = (now - p.bornAt) / Z_LIFE_MS;
			const frame = this.zglyph.get(`z.${Math.floor(now / 600) % 2}`);
			if (!frame) continue;
			ctx.globalAlpha = 1 - t;
			ctx.drawImage(
				frame.canvas,
				Math.round(p.x + t * 8),
				Math.round(p.y - t * 8),
			);
			ctx.globalAlpha = 1;
		}
	}
}
