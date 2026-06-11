/**
 * Code-as-assets pixel art: every sprite is string rows keyed into a palette
 * map ('.' = transparent, one char = one pixel). Sheets are baked once at
 * boot into OffscreenCanvases (including pre-flipped variants), so the frame
 * loop is pure drawImage.
 *
 * NOTE: sheet *data* modules must stay browser-free (pure objects) so the
 * tools/preview.ts harness can render them to PNG under plain Bun.
 */

export type Palette = Record<string, string>; // char -> #rrggbb | #rrggbbaa

export interface SpriteSheet {
	palette: Palette;
	/** foot/base point in frame pixels; bottom-center for characters */
	anchor: { x: number; y: number };
	/** per-frame anchor override (e.g. 24x16 lying frames) */
	anchors?: Record<string, { x: number; y: number }>;
	frames: Record<string, string[]>; // frameName -> rows of palette chars
}

export interface DecodedFrame {
	canvas: OffscreenCanvas;
	flipped: OffscreenCanvas;
	w: number;
	h: number;
	anchorX: number;
	anchorY: number;
}

export type DecodedSheet = Map<string, DecodedFrame>;

/** Per-character palette swap, e.g. outfit/hair/accent recolors. */
export type PaletteSwap = Record<string, string>;

export function parseHex(hex: string): [number, number, number, number] {
	const h = hex.replace("#", "");
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
	return [r, g, b, a];
}

/** Rasterize rows into RGBA pixels. Shared with the preview harness. */
export function rasterize(
	rows: string[],
	palette: Palette,
): { data: Uint8ClampedArray; w: number; h: number } {
	const h = rows.length;
	const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
	const data = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++) {
		const row = rows[y]!;
		for (let x = 0; x < row.length; x++) {
			const ch = row[x]!;
			if (ch === ".") continue;
			const hex = palette[ch];
			if (!hex) continue; // unknown key: leave transparent
			const [r, g, b, a] = parseHex(hex);
			const i = (y * w + x) * 4;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = a;
		}
	}
	return { data, w, h };
}

function bake(rows: string[], palette: Palette): OffscreenCanvas {
	const { data, w, h } = rasterize(rows, palette);
	const canvas = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
	const ctx = canvas.getContext("2d")!;
	ctx.putImageData(
		new ImageData(
			data as Uint8ClampedArray<ArrayBuffer>,
			Math.max(1, w),
			Math.max(1, h),
		),
		0,
		0,
	);
	return canvas;
}

function flipCanvas(src: OffscreenCanvas): OffscreenCanvas {
	const out = new OffscreenCanvas(src.width, src.height);
	const ctx = out.getContext("2d")!;
	ctx.imageSmoothingEnabled = false;
	ctx.translate(src.width, 0);
	ctx.scale(-1, 1);
	ctx.drawImage(src, 0, 0);
	return out;
}

export function decodeSheet(
	sheet: SpriteSheet,
	swap?: PaletteSwap,
): DecodedSheet {
	const palette = swap ? { ...sheet.palette, ...swap } : sheet.palette;
	const out: DecodedSheet = new Map();
	for (const [name, rows] of Object.entries(sheet.frames)) {
		const canvas = bake(rows, palette);
		const anchor = sheet.anchors?.[name] ?? sheet.anchor;
		out.set(name, {
			canvas,
			flipped: flipCanvas(canvas),
			w: canvas.width,
			h: canvas.height,
			anchorX: anchor.x,
			anchorY: anchor.y,
		});
	}
	return out;
}

/**
 * Pre-rendered soft glow blob: draw → downscale 4x → upscale with smoothing.
 * Stamped with globalCompositeOperation="lighter" at runtime; never use
 * shadowBlur/ctx.filter in the frame loop.
 */
export function makeGlowBlob(
	src: OffscreenCanvas,
	spread = 1.6,
): OffscreenCanvas {
	const w = Math.max(2, Math.round(src.width / 4));
	const h = Math.max(2, Math.round(src.height / 4));
	const small = new OffscreenCanvas(w, h);
	const sctx = small.getContext("2d")!;
	sctx.imageSmoothingEnabled = true;
	sctx.drawImage(src, 0, 0, w, h);

	const out = new OffscreenCanvas(
		Math.round(src.width * spread),
		Math.round(src.height * spread),
	);
	const octx = out.getContext("2d")!;
	octx.imageSmoothingEnabled = true;
	octx.drawImage(small, 0, 0, out.width, out.height);
	return out;
}

/** Solid one-color glow ellipse (light pools, screen cones). */
export function makeLightPool(
	w: number,
	h: number,
	hex: string,
): OffscreenCanvas {
	const out = new OffscreenCanvas(w, h);
	const ctx = out.getContext("2d")!;
	const [r, g, b] = parseHex(hex);
	const grad = ctx.createRadialGradient(
		w / 2,
		h / 2,
		1,
		w / 2,
		h / 2,
		Math.max(w, h) / 2,
	);
	grad.addColorStop(0, `rgba(${r},${g},${b},0.8)`);
	grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, h);
	return out;
}
