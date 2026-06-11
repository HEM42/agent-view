import { PAL } from "../sprites/palette";
import { makeLightPool, parseHex } from "../sprites/pixel";
import { TV, VH, VW, WINDOW_RECT } from "./layout";

type Ctx = OffscreenCanvasRenderingContext2D;

// ---- rain (clipped to the window) ----

interface Drop {
	x: number;
	y: number;
	speed: number;
	alpha: number;
}

const DROPS = 70;

// ---- neon sign flicker (per letter Markov machine) ----

interface LetterState {
	on: boolean;
	until: number; // when to reconsider
	sputtering: boolean;
}

export const SIGN_LETTERS = ["h", "e", "r", "d", "r2"] as const;

export class Effects {
	private drops: Drop[] = [];
	private motes: { x: number; y: number; phase: number }[] = [];
	private steam = new Map<string, { x: number; y: number; bornAt: number }[]>();
	private lightningAt = 0;
	private nextLightning = 30_000;
	private jitterAt = 0;
	private nextJitter = 8000;
	private letters = new Map<string, LetterState>();
	private scanlines: OffscreenCanvas;
	private vignette: OffscreenCanvas;
	private tvPool: OffscreenCanvas;
	private screenCone: OffscreenCanvas;

	constructor() {
		for (let i = 0; i < DROPS; i++) this.drops.push(this.newDrop(true));
		for (let i = 0; i < 12; i++) {
			this.motes.push({
				x: Math.random() * VW,
				y: 100 + Math.random() * 100,
				phase: Math.random() * Math.PI * 2,
			});
		}
		for (const l of SIGN_LETTERS) {
			this.letters.set(l, { on: true, until: 0, sputtering: false });
		}
		this.scanlines = this.makeScanlines();
		this.vignette = this.makeVignette();
		this.tvPool = makeLightPool(56, 14, PAL.holoBlue);
		this.screenCone = makeLightPool(18, 12, PAL.neonCyan);
	}

	private newDrop(anywhere = false): Drop {
		return {
			x: WINDOW_RECT.x + Math.random() * WINDOW_RECT.w,
			y: WINDOW_RECT.y + (anywhere ? Math.random() * WINDOW_RECT.h : 0),
			speed: 90 + Math.random() * 50,
			alpha: 0.5 + Math.random() * 0.3,
		};
	}

	update(dtMs: number, now: number): void {
		for (let i = 0; i < this.drops.length; i++) {
			const d = this.drops[i]!;
			d.y += (d.speed * dtMs) / 1000;
			d.x -= (d.speed * dtMs) / 3000; // slight diagonal
			if (d.y > WINDOW_RECT.y + WINDOW_RECT.h) this.drops[i] = this.newDrop();
		}
		if (now - this.lightningAt > this.nextLightning) {
			this.lightningAt = now;
			this.nextLightning = 25_000 + Math.random() * 25_000;
		}
		if (now - this.jitterAt > this.nextJitter) {
			this.jitterAt = now;
			this.nextJitter = 6000 + Math.random() * 4000;
		}
		this.updateLetters(now);
	}

	private updateLetters(now: number): void {
		for (const name of SIGN_LETTERS) {
			const s = this.letters.get(name)!;
			if (now < s.until) continue;
			if (s.sputtering) {
				// sputter step: rapid on/off, or settle back to steady-on
				if (Math.random() < 0.35) {
					s.sputtering = false;
					s.on = true;
					s.until = now;
				} else {
					s.on = !s.on;
					s.until = now + 40 + Math.random() * 80;
				}
			} else {
				const p = name === "r2" ? 0.012 : 0.004; // the second R buzzes
				if (Math.random() < p) {
					s.sputtering = true;
					s.on = false;
					s.until = now + 50;
				} else if (name === "r2" && Math.random() < 0.002) {
					// occasionally dies outright: the sign reads "HERD"
					s.on = false;
					s.until = now + 1000 + Math.random() * 1000;
				} else {
					s.until = now + 100;
				}
			}
		}
	}

	letterOn(name: string): boolean {
		return this.letters.get(name)?.on ?? true;
	}

	lightningPhase(now: number): number {
		const dt = now - this.lightningAt;
		return dt < 130 ? 1 : 0; // two-ish frames of brightened sky
	}

	jitterFrame(now: number): boolean {
		return now - this.jitterAt < 40;
	}

	drawRain(ctx: Ctx): void {
		const [lr, lg, lb] = parseHex(PAL.lilac);
		const [hr, hg, hb] = parseHex(PAL.holoBlue);
		for (let i = 0; i < this.drops.length; i++) {
			const d = this.drops[i]!;
			const [r, g, b] = i % 2 ? [lr, lg, lb] : [hr, hg, hb];
			ctx.fillStyle = `rgba(${r},${g},${b},${d.alpha})`;
			ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 3);
		}
	}

	drawMotes(ctx: Ctx, now: number): void {
		for (const m of this.motes) {
			const y = m.y + Math.sin(now / 2000 + m.phase) * 3;
			const x = (m.x + now / 500) % VW;
			ctx.fillStyle = `rgba(139,135,184,${0.12 + 0.1 * Math.sin(m.phase + now / 3000)})`;
			ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
		}
	}

	/** steam above an occupied desk's mug */
	emitSteam(deskId: string, x: number, y: number, now: number): void {
		let list = this.steam.get(deskId);
		if (!list) {
			list = [];
			this.steam.set(deskId, list);
		}
		const last = list[list.length - 1];
		if (!last || now - last.bornAt > 700) {
			list.push({ x, y, bornAt: now });
		}
	}

	drawSteam(ctx: Ctx, now: number): void {
		for (const [id, list] of this.steam) {
			const alive = list.filter((p) => now - p.bornAt < 1400);
			if (alive.length === 0) {
				this.steam.delete(id);
				continue;
			}
			this.steam.set(id, alive);
			for (const p of alive) {
				const t = (now - p.bornAt) / 1400;
				ctx.fillStyle = `rgba(242,238,255,${0.35 * (1 - t)})`;
				ctx.fillRect(
					Math.round(p.x + Math.sin(t * 6) * 1.5),
					Math.round(p.y - t * 6),
					1,
					1,
				);
			}
		}
	}

	drawTvPool(ctx: Ctx, now: number): void {
		ctx.globalCompositeOperation = "lighter";
		ctx.globalAlpha = 0.1 + 0.08 * Math.abs(Math.sin(now / 180));
		ctx.drawImage(this.tvPool, TV.lightPool.x - 28, TV.lightPool.y - 7);
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = "source-over";
	}

	drawScreenCone(ctx: Ctx, x: number, y: number, now: number): void {
		ctx.globalCompositeOperation = "lighter";
		ctx.globalAlpha = 0.1 + 0.05 * (Math.floor(now / 320) % 2);
		ctx.drawImage(this.screenCone, Math.round(x - 9), Math.round(y - 4));
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = "source-over";
	}

	drawOverlay(ctx: Ctx): void {
		ctx.drawImage(this.scanlines, 0, 0);
		ctx.drawImage(this.vignette, 0, 0);
	}

	private makeScanlines(): OffscreenCanvas {
		const out = new OffscreenCanvas(VW, VH);
		const ctx = out.getContext("2d")!;
		ctx.fillStyle = "rgba(0,0,0,0.10)";
		for (let y = 0; y < VH; y += 2) ctx.fillRect(0, y, VW, 1);
		return out;
	}

	private makeVignette(): OffscreenCanvas {
		const out = new OffscreenCanvas(VW, VH);
		const ctx = out.getContext("2d")!;
		const g = ctx.createRadialGradient(
			VW / 2,
			VH / 2,
			VH / 2,
			VW / 2,
			VH / 2,
			VW * 0.72,
		);
		g.addColorStop(0, "rgba(10,6,19,0)");
		g.addColorStop(1, "rgba(10,6,19,0.32)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, VW, VH);
		return out;
	}
}
