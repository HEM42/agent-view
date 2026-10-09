import { PAL } from "../sprites/palette";
import { decodeSheet, makeGlowBlob, type DecodedSheet } from "../sprites/pixel";
import { BAR_SHEET, BED as BED_SHEET, COUCH as COUCH_SHEET, DESK as DESK_SHEET, DOOR as DOOR_SHEET, SCREEN as SCREEN_SHEET, TV as TV_SHEET } from "../sprites/sheets/furniture";
import { POSTERS as POSTERS_SHEET, SIGN as SIGN_SHEET, SKYLINE, VENT as VENT_SHEET, WINDOW_FRAME } from "../sprites/sheets/room";
import { DRONE } from "../sprites/sheets/fx";
import type { World } from "../world";
import { hopOffset, type Character } from "../characters/character";
import { accentFor } from "../sprites/palette";
import { Effects, SIGN_LETTERS } from "./effects";
import { drawSaber } from "./saber";
import { renderText } from "../ui/font3x5";
import { BOARD, BOARD_ROWS, renderScoreboard } from "../ui/scoreboard";
import { SPARK_MS, deskSpot, droneAlpha, plusPos, swarmPos } from "../characters/drone";
import {
	BAR,
	BED,
	CLOCK,
	COUCH,
	DESKS,
	DOOR,
	POSTERS,
	SIGN,
	TV,
	VENT,
	VH,
	VW,
	WALL_Y,
	WINDOW_RECT,
} from "./layout";

type Ctx = OffscreenCanvasRenderingContext2D;

const DOOR_CYCLE_MS = 1200;

export interface Entity {
	sortY: number;
	tie: string;
	draw: (ctx: Ctx) => void;
}

export class Scene {
	readonly effects = new Effects();
	private furniture: DecodedSheet;
	private room: DecodedSheet;
	private background: OffscreenCanvas;
	private signGlow = new Map<string, OffscreenCanvas>();
	private droneSheets = new Map<string, DecodedSheet>(); // per accent
	private plusTags = new Map<string, OffscreenCanvas>(); // per accent + text

	constructor() {
		this.furniture = decodeSheet(DESK_SHEET);
		for (const sheet of [SCREEN_SHEET, COUCH_SHEET, TV_SHEET, BED_SHEET, DOOR_SHEET, BAR_SHEET]) {
			for (const [k, v] of decodeSheet(sheet)) this.furniture.set(k, v);
		}
		this.room = decodeSheet(WINDOW_FRAME);
		for (const sheet of [SKYLINE, POSTERS_SHEET, SIGN_SHEET, VENT_SHEET]) {
			for (const [k, v] of decodeSheet(sheet)) this.room.set(k, v);
		}
		this.background = this.renderBackground();
		for (const l of SIGN_LETTERS) {
			const frame = this.room.get(`${l}.on`);
			if (frame) this.signGlow.set(l, makeGlowBlob(frame.canvas, 2));
		}
	}

	update(dtMs: number, now: number): void {
		this.effects.update(dtMs, now);
	}

	draw(ctx: Ctx, world: World, now: number, extra: Entity[] = []): void {
		// 1. pre-rendered wall/floor/decor
		ctx.drawImage(this.background, 0, 0);

		// 2. the window: sky bands, parallax skyline, rain — clipped
		this.drawWindow(ctx, now);

		// 3. animated wall props: sign letters + door + wall clock
		this.drawSign(ctx, world, now);
		this.drawDoor(ctx, now, world.doorPulseAt);
		this.drawClock(ctx);
		this.drawScoreboard(ctx, world);

		// 4. floor entities, y-sorted
		const entities = [...this.buildEntities(world, now), ...extra];
		entities.sort((a, b) => a.sortY - b.sortY || (a.tie < b.tie ? -1 : 1));
		for (const e of entities) e.draw(ctx);

		// 5. light pools and ambient particles
		if (world.tvOn()) this.effects.drawTvPool(ctx, now);
		this.drawDeskLight(ctx, world, now);
		this.effects.drawMotes(ctx, now);
		this.effects.drawSteam(ctx, now);
		for (const s of world.duels.drainSparks()) this.effects.emitSparks(s.x, s.y, s.colors, now);
		this.effects.drawSparks(ctx, now);
	}

	overlay(ctx: Ctx): void {
		this.effects.drawOverlay(ctx);
	}

	// ---- background ----

	private renderBackground(): OffscreenCanvas {
		const out = new OffscreenCanvas(VW, VH);
		const ctx = out.getContext("2d")!;

		// wall
		ctx.fillStyle = PAL.night;
		ctx.fillRect(0, 0, VW, WALL_Y);
		// ceiling strip with pipes
		ctx.fillStyle = PAL.dusk;
		ctx.fillRect(0, 0, VW, 14);
		ctx.fillStyle = PAL.steel;
		ctx.fillRect(0, 14, VW, 1);
		ctx.fillStyle = PAL.slate;
		for (let x = 6; x < VW; x += 48) ctx.fillRect(x, 4, 2, 10); // pipe drops
		ctx.fillRect(0, 6, VW, 2); // long pipe
		// wall panel seams
		ctx.fillStyle = PAL.dusk;
		for (let x = 0; x < VW; x += 64) ctx.fillRect(x, 16, 1, WALL_Y - 16);
		// skirting at the seam
		ctx.fillStyle = PAL.dusk;
		ctx.fillRect(0, WALL_Y - 3, VW, 3);

		// floor with receding grid
		ctx.fillStyle = PAL.slate;
		ctx.fillRect(0, WALL_Y, VW, VH - WALL_Y);
		ctx.fillStyle = PAL.steel;
		for (let y = WALL_Y + 12; y < VH; y += 24) {
			ctx.globalAlpha = 0.35;
			ctx.fillRect(0, y, VW, 1);
		}
		for (let x = 0; x < VW; x += 32) {
			ctx.globalAlpha = 0.18;
			ctx.fillRect(x, WALL_Y, 1, VH - WALL_Y);
		}
		ctx.globalAlpha = 1;

		// sky inside the window rect (the skyline/rain are drawn live)
		const bands = [PAL.ink, PAL.night, PAL.dusk, PAL.night];
		const bandH = Math.ceil(WINDOW_RECT.h / bands.length);
		bands.forEach((c, i) => {
			ctx.fillStyle = c;
			ctx.fillRect(
				WINDOW_RECT.x,
				WINDOW_RECT.y + i * bandH,
				WINDOW_RECT.w,
				bandH,
			);
		});

		// static wall decor
		const poster0 = this.room.get("poster.0");
		const poster1 = this.room.get("poster.1");
		if (poster0) ctx.drawImage(poster0.canvas, POSTERS[0]!.x, POSTERS[0]!.y);
		if (poster1) ctx.drawImage(poster1.canvas, POSTERS[1]!.x, POSTERS[1]!.y);
		const vent = this.room.get("vent");
		if (vent) ctx.drawImage(vent.canvas, VENT.x, VENT.y);
		const panel = this.room.get("panel");
		if (panel) ctx.drawImage(panel.canvas, SIGN.x, SIGN.y);
		const swoosh = this.room.get("swoosh");
		if (swoosh) ctx.drawImage(swoosh.canvas, SIGN.x + 4, SIGN.y + 16);

		return out;
	}

	private drawWindow(ctx: Ctx, now: number): void {
		ctx.save();
		ctx.beginPath();
		ctx.rect(WINDOW_RECT.x + 2, WINDOW_RECT.y + 2, WINDOW_RECT.w - 4, WINDOW_RECT.h - 4);
		ctx.clip();

		const baseY = WINDOW_RECT.y + WINDOW_RECT.h;
		const layers: [string, number, number][] = [
			["far", 60_000, 2],
			["mid", 45_000, 3],
			["near", 30_000, 4],
		];
		for (const [name, period, amp] of layers) {
			const frame = this.room.get(name);
			if (!frame) continue;
			const drift = Math.sin((now / period) * Math.PI * 2) * amp;
			ctx.drawImage(
				frame.canvas,
				Math.round(WINDOW_RECT.x + 3 + drift),
				baseY - frame.h - 2,
			);
		}

		if (this.effects.lightningPhase(now) > 0) {
			ctx.fillStyle = "rgba(242,238,255,0.18)";
			ctx.fillRect(WINDOW_RECT.x, WINDOW_RECT.y, WINDOW_RECT.w, WINDOW_RECT.h);
		}
		this.effects.drawRain(ctx);
		ctx.restore();

		const frame = this.room.get("frame");
		if (frame) ctx.drawImage(frame.canvas, WINDOW_RECT.x, WINDOW_RECT.y);
	}

	private drawSign(ctx: Ctx, world: World, now: number): void {
		const crunch = world.chars.size > 0 && world.workingCount() === world.chars.size;
		SIGN_LETTERS.forEach((l, i) => {
			const on = this.effects.letterOn(l);
			const frame = this.room.get(`${l}.${on ? "on" : "off"}`);
			if (!frame) return;
			const x = SIGN.letterX0 + i * SIGN.letterPitch;
			ctx.drawImage(frame.canvas, x, SIGN.letterY);
			if (on) {
				const glow = this.signGlow.get(l);
				if (glow) {
					ctx.globalCompositeOperation = "lighter";
					ctx.globalAlpha = (crunch ? 0.55 : 0.4) + 0.05 * Math.sin(now / 700 + i);
					ctx.drawImage(
						glow,
						Math.round(x - (glow.width - frame.w) / 2),
						Math.round(SIGN.letterY - (glow.height - frame.h) / 2),
					);
					ctx.globalAlpha = 1;
					ctx.globalCompositeOperation = "source-over";
				}
			}
		});
	}

	private clockText = "";
	private clockDigits: OffscreenCanvas | null = null;
	private board: OffscreenCanvas | null = null;
	private boardVersion = -1;

	/** duel standings on the wall; re-rendered only when a result comes in */
	private drawScoreboard(ctx: Ctx, world: World): void {
		if (!this.board || this.boardVersion !== world.scoreboard.version) {
			this.board = renderScoreboard(world.scoreboard.top(BOARD_ROWS));
			this.boardVersion = world.scoreboard.version;
		}
		ctx.drawImage(this.board, BOARD.x, BOARD.y);
	}

	/** 24h wall clock, top right. Digits re-bake at most once per second. */
	private drawClock(ctx: Ctx): void {
		const d = new Date();
		const hh = String(d.getHours()).padStart(2, "0");
		const mm = String(d.getMinutes()).padStart(2, "0");
		const colon = d.getSeconds() % 2 === 0 ? ":" : " ";
		const text = `${hh}${colon}${mm}`;
		if (text !== this.clockText) {
			this.clockText = text;
			this.clockDigits = renderText(text, PAL.neonCyan);
		}
		ctx.fillStyle = "rgba(10,6,19,0.92)";
		ctx.fillRect(CLOCK.x, CLOCK.y, CLOCK.w, CLOCK.h);
		ctx.strokeStyle = "rgba(76,74,130,0.8)";
		ctx.lineWidth = 1;
		ctx.strokeRect(CLOCK.x + 0.5, CLOCK.y + 0.5, CLOCK.w - 1, CLOCK.h - 1);
		if (this.clockDigits) {
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(
				this.clockDigits,
				CLOCK.x + Math.round((CLOCK.w - this.clockDigits.width * 2) / 2),
				CLOCK.y + 3,
				this.clockDigits.width * 2,
				this.clockDigits.height * 2,
			);
		}
	}

	private drawDoor(ctx: Ctx, now: number, pulseAt: number): void {
		const dt = now - pulseAt;
		let idx = 0;
		if (pulseAt > 0 && dt < DOOR_CYCLE_MS) {
			if (dt < 300) idx = Math.min(3, Math.floor(dt / 100));
			else if (dt < 900) idx = 3;
			else idx = Math.max(0, 3 - Math.floor((dt - 900) / 100));
		}
		const frame = this.furniture.get(`door.${idx}`);
		if (frame) {
			ctx.drawImage(
				frame.canvas,
				DOOR.pos.x - frame.anchorX,
				DOOR.pos.y - frame.anchorY,
			);
		}
	}

	private droneSheet(accent: string): DecodedSheet {
		let s = this.droneSheets.get(accent);
		if (!s) {
			s = decodeSheet(DRONE, { a: accent });
			this.droneSheets.set(accent, s);
		}
		return s;
	}

	private plusTag(text: string, accent: string): OffscreenCanvas {
		const key = `${accent}${text}`;
		let t = this.plusTags.get(key);
		if (!t) {
			t = renderText(text, accent);
			this.plusTags.set(key, t);
		}
		return t;
	}

	// ---- floor entities ----

	private buildEntities(world: World, now: number): Entity[] {
		const out: Entity[] = [];
		const deskCount = Math.max(world.slots.desksInUse(), Math.min(world.chars.size, DESKS.length));

		DESKS.forEach((spot, i) => {
			if (i >= deskCount) return;
			const slot = world.slots.byId(spot.id);
			const occupied = !!slot?.occupiedBy;
			const owner = slot?.occupiedBy
				? world.chars.get(slot.occupiedBy)
				: undefined;
			// stool draws behind the seated character (stool → char → desk)
			out.push({
				sortY: spot.pos.y - 3,
				tie: `${spot.id}-stool`,
				draw: (ctx) => {
					const stool = this.furniture.get("stool");
					if (stool) {
						ctx.drawImage(
							stool.canvas,
							spot.stoolPos.x - stool.anchorX,
							spot.stoolPos.y - stool.anchorY,
						);
					}
				},
			});
			out.push({
				sortY: spot.pos.y,
				tie: spot.id,
				draw: (ctx) => {
					const desk = this.furniture.get("desk");
					if (desk) {
						ctx.drawImage(
							desk.canvas,
							spot.pos.x - desk.anchorX,
							spot.pos.y - desk.anchorY,
						);
					}
					const busy = occupied || world.fleet.deskBusy(spot.id);
					const screenName = busy ? `screen.${(Math.floor(now / 180) + i) % 3}` : "screen.dim";
					const screen = this.furniture.get(screenName);
					if (screen) {
						ctx.drawImage(
							screen.canvas,
							spot.screenPos.x - screen.anchorX,
							spot.screenPos.y - screen.anchorY,
						);
					}
					// mug in the owner's project accent + steam when occupied
					if (owner) {
						ctx.fillStyle = accentFor(owner.project);
						ctx.fillRect(spot.pos.x + 8, spot.pos.y - 14, 2, 3);
						this.effects.emitSteam(
							spot.id,
							spot.pos.x + 9,
							spot.pos.y - 16,
							now,
						);
					}
				},
			});
		});

		for (const d of world.fleet.drones()) {
			const spot = deskSpot(d.deskId);
			if (!spot) continue;
			out.push({
				sortY: spot.pos.y + 0.5,
				tie: `drone-${d.id}`,
				draw: (ctx) => {
					const p = swarmPos(d, spot, now);
					const age = now - d.bornAt;
					const sparking = d.spark && age < SPARK_MS;
					const f = this.droneSheet(d.accent).get(
						sparking ? `spark.${Math.floor(age / (SPARK_MS / 2)) % 2}` : `drone.${Math.floor(now / 90) % 2}`,
					);
					if (!f) return;
					ctx.globalAlpha = droneAlpha(d, now);
					ctx.drawImage(f.canvas, p.x + (sparking ? 1 : 0), p.y);
					ctx.globalAlpha = 1;
				},
			});
		}
		for (const o of world.fleet.overflows()) {
			const spot = deskSpot(o.deskId);
			if (!spot) continue;
			out.push({
				sortY: spot.pos.y + 0.5,
				tie: `more-${o.parentId}`,
				draw: (ctx) => {
					const p = plusPos(spot);
					ctx.drawImage(this.plusTag(`+${o.hidden.length}`, o.accent), p.x, p.y);
				},
			});
		}

		out.push(this.still("couch", COUCH.pos.x, COUCH.pos.y));
		out.push({
			sortY: TV.pos.y,
			tie: "tv",
			draw: (ctx) => {
				const name = world.tvOn() ? `tv.${Math.floor(now / 100) % 4}` : "tv.off";
				const f = this.furniture.get(name);
				if (f) {
					ctx.drawImage(f.canvas, TV.pos.x - f.anchorX, TV.pos.y - f.anchorY);
				}
			},
		});
		out.push(this.still("bed", BED.pos.x, BED.pos.y));

		// ramen bar: counter draws over the guests' legs; a bowl in each
		// guest's project accent steams on the counter top
		out.push({
			sortY: BAR.pos.y,
			tie: "bar",
			draw: (ctx) => {
				const bar = this.furniture.get("bar");
				if (bar) {
					ctx.drawImage(
						bar.canvas,
						BAR.pos.x - bar.anchorX,
						BAR.pos.y - bar.anchorY,
					);
				}
				BAR.seats.forEach((seat, i) => {
					const slot = world.slots.byId(`bar-${i}`);
					const guest = slot?.occupiedBy
						? world.chars.get(slot.occupiedBy)
						: undefined;
					if (!guest) return;
					ctx.fillStyle = PAL.ink;
					ctx.fillRect(seat.x - 3, BAR.bowlY - 1, 6, 3);
					ctx.fillStyle = accentFor(guest.project);
					ctx.fillRect(seat.x - 2, BAR.bowlY, 4, 1);
					this.effects.emitSteam(`bar-${i}`, seat.x, BAR.steamY, now);
				});
			},
		});

		for (const c of world.sorted()) {
			// seated/lying characters draw just in front of their furniture
			const sortY =
				c.state === "SLEEPING"
					? BED.pos.y + 1
					: c.state === "WATCHING_TV"
						? COUCH.pos.y + 1
						: c.pos.y;
			out.push({
				sortY,
				tie: c.id,
				draw: (ctx) => {
					drawCharacter(ctx, c, now);
					drawSaber(ctx, c, world.duels.bladeLen(c.id, now));
				},
			});
		}

		return out;
	}

	private still(frameName: string, x: number, y: number): Entity {
		return {
			sortY: y,
			tie: frameName,
			draw: (ctx) => {
				const f = this.furniture.get(frameName);
				if (f) ctx.drawImage(f.canvas, x - f.anchorX, y - f.anchorY);
			},
		};
	}

	private drawDeskLight(ctx: Ctx, world: World, now: number): void {
		const deskCount = world.slots.desksInUse();
		DESKS.forEach((spot, i) => {
			if (i >= deskCount) return;
			const slot = world.slots.byId(spot.id);
			if (!slot?.occupiedBy && !world.fleet.deskBusy(spot.id)) return;
			this.effects.drawScreenCone(ctx, spot.seatPos.x + 4, spot.seatPos.y - 12, now);
		});
	}
}

export function drawCharacter(ctx: Ctx, c: Character, now: number): void {
	const frame = c.anim.frame();
	if (!frame) return;
	const img = c.facing === -1 ? frame.flipped : frame.canvas;
	const anchorX = c.facing === -1 ? frame.w - frame.anchorX : frame.anchorX;
	ctx.drawImage(
		img,
		Math.round(c.pos.x) - anchorX,
		Math.round(c.pos.y) + hopOffset(c, now) - frame.anchorY,
	);
}
