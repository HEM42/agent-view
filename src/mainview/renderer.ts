import { PAL } from "./sprites/palette";
import { VH, VW, type Vec2 } from "./scene/layout";

/**
 * Two-canvas integer-scaled pixel pipeline: everything draws into a 384x216
 * OffscreenCanvas, which is blitted to the window-sized display canvas at
 * floor(scale), letterboxed in ink.
 */
export class Renderer {
	readonly virtual: OffscreenCanvas;
	readonly vctx: OffscreenCanvasRenderingContext2D;
	readonly displayCtx: CanvasRenderingContext2D;
	private scale = 1;
	private ox = 0;
	private oy = 0;

	constructor(private canvas: HTMLCanvasElement) {
		this.virtual = new OffscreenCanvas(VW, VH);
		this.vctx = this.virtual.getContext("2d")!;
		this.vctx.imageSmoothingEnabled = false;
		this.displayCtx = canvas.getContext("2d")!;
		this.resize();
	}

	resize(): void {
		const dpr = window.devicePixelRatio || 1;
		const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
		const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width = w;
			this.canvas.height = h;
		}
		this.scale = Math.max(1, Math.floor(Math.min(w / VW, h / VH)));
		this.ox = Math.round((w - VW * this.scale) / 2);
		this.oy = Math.round((h - VH * this.scale) / 2);
	}

	/** blit the virtual canvas; jitter=true draws the chromatic split frame */
	present(jitter: boolean): void {
		const ctx = this.displayCtx;
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = PAL.ink;
		ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
		const w = VW * this.scale;
		const h = VH * this.scale;
		ctx.drawImage(this.virtual, this.ox, this.oy, w, h);
		if (jitter) {
			ctx.globalAlpha = 0.35;
			ctx.globalCompositeOperation = "screen";
			ctx.drawImage(this.virtual, this.ox + this.scale, this.oy, w, h);
			ctx.globalAlpha = 1;
			ctx.globalCompositeOperation = "source-over";
		}
	}

	/**
	 * HUD transform: tags render at a fixed, dpr-aware size — but never
	 * larger than the scene zoom, so they stay subordinate at tiny windows.
	 */
	transform(): {
		scale: number;
		ox: number;
		oy: number;
		hudScale: number;
		width: number;
		height: number;
	} {
		const dpr = window.devicePixelRatio || 1;
		return {
			scale: this.scale,
			ox: this.ox,
			oy: this.oy,
			hudScale: Math.max(1, Math.min(Math.round(1.5 * dpr), this.scale)),
			width: this.canvas.width,
			height: this.canvas.height,
		};
	}

	/** css pixel position -> virtual pixel position (or null outside) */
	toVirtual(cssX: number, cssY: number): Vec2 | null {
		const dpr = window.devicePixelRatio || 1;
		const x = (cssX * dpr - this.ox) / this.scale;
		const y = (cssY * dpr - this.oy) / this.scale;
		if (x < 0 || y < 0 || x >= VW || y >= VH) return null;
		return { x, y };
	}
}
