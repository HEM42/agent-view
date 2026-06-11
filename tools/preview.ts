/**
 * Render code-encoded sprite sheets to PNG for visual inspection.
 *
 *   bun tools/preview.ts src/mainview/sprites/sheets/character.ts /tmp/character.png [scale]
 *
 * Works on any module exporting SpriteSheet-shaped objects ({palette, frames})
 * or a GLYPHS record (the 3x5 font). Runs under plain Bun — no browser APIs.
 */

import { deflateSync } from "node:zlib";
import { rasterize, type Palette, type SpriteSheet } from "../src/mainview/sprites/pixel";

// ---- minimal PNG encoder (RGBA8, no interlace) ----

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(...parts: Uint8Array[]): number {
	let c = 0xffffffff;
	for (const p of parts) {
		for (let i = 0; i < p.length; i++) {
			c = CRC_TABLE[(c ^ p[i]!) & 0xff]! ^ (c >>> 8);
		}
	}
	return (c ^ 0xffffffff) >>> 0;
}

function be32(n: number): Uint8Array {
	return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const typeBytes = new TextEncoder().encode(type);
	const out = new Uint8Array(12 + data.length);
	out.set(be32(data.length), 0);
	out.set(typeBytes, 4);
	out.set(data, 8);
	out.set(be32(crc32(typeBytes, data)), 8 + data.length);
	return out;
}

export function encodePNG(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
	const raw = new Uint8Array(h * (w * 4 + 1));
	for (let y = 0; y < h; y++) {
		raw[y * (w * 4 + 1)] = 0; // filter: none
		raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
	}
	const ihdr = new Uint8Array(13);
	ihdr.set(be32(w), 0);
	ihdr.set(be32(h), 4);
	ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
	const idat = new Uint8Array(deflateSync(raw));
	const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

// ---- sheet -> grid image ----

const BG: [number, number, number, number] = [24, 18, 48, 255]; // night
const GRID: [number, number, number, number] = [76, 74, 130, 255]; // steel

interface Cell {
	name: string;
	data: Uint8ClampedArray;
	w: number;
	h: number;
}

function renderGrid(cells: Cell[], scale: number): { rgba: Uint8ClampedArray; w: number; h: number } {
	const cellW = Math.max(...cells.map((c) => c.w)) + 2;
	const cellH = Math.max(...cells.map((c) => c.h)) + 2;
	const cols = Math.min(cells.length, Math.max(4, Math.ceil(Math.sqrt(cells.length))));
	const rows = Math.ceil(cells.length / cols);
	const w = cols * cellW + 1;
	const h = rows * cellH + 1;
	const img = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < w * h; i++) img.set(BG, i * 4);
	// grid lines
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (x % cellW === 0 || y % cellH === 0) img.set(GRID, (y * w + x) * 4);
		}
	}
	cells.forEach((cell, i) => {
		const cx = (i % cols) * cellW + 1 + Math.floor((cellW - 2 - cell.w) / 2);
		const cy = Math.floor(i / cols) * cellH + 1 + (cellH - 2 - cell.h);
		for (let y = 0; y < cell.h; y++) {
			for (let x = 0; x < cell.w; x++) {
				const a = cell.data[(y * cell.w + x) * 4 + 3]!;
				if (a === 0) continue;
				img.set(cell.data.subarray((y * cell.w + x) * 4, (y * cell.w + x) * 4 + 4), ((cy + y) * w + cx + x) * 4);
			}
		}
	});
	// nearest-neighbor upscale
	const W = w * scale;
	const H = h * scale;
	const big = new Uint8ClampedArray(W * H * 4);
	for (let y = 0; y < H; y++) {
		const sy = Math.floor(y / scale);
		for (let x = 0; x < W; x++) {
			const sx = Math.floor(x / scale);
			big.set(img.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * W + x) * 4);
		}
	}
	return { rgba: big, w: W, h: H };
}

function isSheet(v: unknown): v is SpriteSheet {
	return (
		typeof v === "object" &&
		v !== null &&
		"frames" in v &&
		"palette" in v &&
		typeof (v as SpriteSheet).frames === "object"
	);
}

// ---- main ----

if (!import.meta.main) {
	// imported for encodePNG/renderGrid only
} else {
	await main();
}

async function main(): Promise<void> {
const [modPath, outPath, scaleArg] = process.argv.slice(2);
if (!modPath || !outPath) {
	console.error("usage: bun tools/preview.ts <sheet-module.ts> <out.png> [scale=8]");
	process.exit(1);
}
const scale = Number(scaleArg ?? 8);

const mod = await import(`${process.cwd()}/${modPath}`);
const cells: Cell[] = [];

for (const [exportName, value] of Object.entries(mod)) {
	if (isSheet(value)) {
		for (const [frameName, rows] of Object.entries(value.frames)) {
			const { data, w, h } = rasterize(rows, value.palette);
			cells.push({ name: `${exportName}.${frameName}`, data, w, h });
		}
	} else if (exportName === "GLYPHS") {
		const palette: Palette = { "1": "#F2EEFF" };
		for (const [glyph, rows] of Object.entries(value as Record<string, string[]>)) {
			const { data, w, h } = rasterize(rows, palette);
			cells.push({ name: `glyph:${glyph}`, data, w, h });
		}
	}
}

if (cells.length === 0) {
	console.error(`no SpriteSheet exports found in ${modPath}`);
	process.exit(1);
}

const { rgba, w, h } = renderGrid(cells, scale);
await Bun.write(outPath, encodePNG(rgba, w, h));
console.log(`${outPath}: ${cells.length} frames at ${scale}x (${w}x${h})`);
console.log(cells.map((c, i) => `${i}: ${c.name} (${c.w}x${c.h})`).join("\n"));
}
