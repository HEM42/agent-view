import type { Character } from "../characters/character";
import { bubbleFor } from "../characters/character";
import { PAL } from "../sprites/palette";
import { VH, VW } from "../scene/layout";
import { renderText } from "./font3x5";

type Ctx = OffscreenCanvasRenderingContext2D;

export interface ViewTransform {
	scale: number; // virtual px -> device px (scene zoom)
	ox: number;
	oy: number;
	hudScale: number; // fixed tag scale, independent of scene zoom
	width: number;
	height: number;
}

function spriteTopOffset(c: Character): number {
	const seated =
		c.state === "WORKING" ||
		c.state === "WATCHING_TV" ||
		c.state === "AT_BAR" ||
		c.state === "SLEEPING";
	const base = c.state === "SLEEPING" ? 14 : seated ? 18 : 24;
	// keep the tag clear of status bubbles — and of the blocked hop (+3)
	const bubble = bubbleFor(c);
	const clearance =
		bubble === "bang" ? 16 : bubble === "question" ? 13 : bubble === "zzz" ? 10 : 0;
	return base + clearance;
}

/**
 * Nametags live on the HUD layer: drawn on the DISPLAY canvas at a fixed
 * size, so the scene zoom never blows the text up. Positions still track
 * the characters in world space.
 */
export function drawNametagsHud(
	ctx: CanvasRenderingContext2D,
	chars: Character[],
	t: ViewTransform,
	now: number,
): void {
	ctx.imageSmoothingEnabled = false;
	const placed: { x: number; y: number; w: number; h: number }[] = [];

	for (const c of chars) {
		const tag = c.nametag;
		const w = tag.width * t.hudScale;
		const h = tag.height * t.hudScale;
		const anchorX = t.ox + c.pos.x * t.scale;
		const topY = t.oy + (c.pos.y - spriteTopOffset(c)) * t.scale;

		const x = Math.round(
			Math.min(Math.max(anchorX - w / 2, 2), t.width - w - 2),
		);
		let y = Math.round(Math.max(topY - h - 3 * t.hudScale, 2));
		const collides = () =>
			placed.some(
				(r) =>
					x < r.x + r.w + 2 &&
					x + w + 2 > r.x &&
					y < r.y + r.h + 2 &&
					y + h + 2 > r.y,
			);
		let guard = 0;
		while (collides() && y > 2 && guard++ < 8) y -= h + 2;
		placed.push({ x, y, w, h });
		ctx.drawImage(tag, x, y, w, h);

		if (c.focused) {
			// herdr-focused pane: yellow caret diamond bobbing above the tag
			const bob = Math.round(Math.sin(now / 300) * t.hudScale);
			ctx.fillStyle = PAL.neonYellow;
			const cx = Math.round(x + w / 2);
			const cy = y - 3 * t.hudScale + bob;
			const s = t.hudScale;
			ctx.fillRect(cx - s, cy, s * 3, s);
			ctx.fillRect(cx, cy - s, s, s * 3);
		}
	}
}

const REASON_TEXT: Record<string, string> = {
	"not-installed": "herdr not found in path",
	"server-down": "herdr server is down",
	"protocol-error": "herdr speaks in tongues",
	"link-lost": "no data from bun process",
	"no-daemon": "daemon not running · bun run install:daemon",
	"daemon-starting": "starting daemon",
	"daemon-down": "daemon not running · see daemon.log",
};

/** Room blackout + neon OFFLINE banner. The UI never shows stale data. */
export function drawOffline(ctx: Ctx, reason: string, now: number): void {
	ctx.fillStyle = "rgba(10,6,19,0.62)";
	ctx.fillRect(0, 0, VW, VH);

	const flicker = Math.sin(now / 90) > -0.85 ? 1 : 0.4; // neon buzz
	const title = renderText("offline", PAL.neonMagenta);
	const scale = 4;
	ctx.globalAlpha = flicker;
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(
		title,
		Math.round(VW / 2 - (title.width * scale) / 2),
		Math.round(VH / 2 - 18),
		title.width * scale,
		title.height * scale,
	);
	ctx.globalAlpha = 1;

	const sub = renderText(REASON_TEXT[reason] ?? reason, PAL.steel);
	ctx.drawImage(
		sub,
		Math.round(VW / 2 - sub.width / 2),
		Math.round(VH / 2 + 12),
	);
}

/** Screensaver only: marks the scripted demo so fake agents never pass as real. */
export function drawDemoTag(ctx: Ctx): void {
	const tag = renderText("demo", PAL.neonMagenta);
	ctx.globalAlpha = 0.55;
	ctx.drawImage(tag, VW - tag.width - 4, VH - tag.height - 4);
	ctx.globalAlpha = 1;
}
