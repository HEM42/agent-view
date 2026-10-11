import { PAL } from "../sprites/palette";
import type { Champion, Standing } from "../scoreboard";
import { ADVANCE, GLYPH_H, renderText, textWidth } from "./font3x5";

/** Wall panel under the HERDR sign, clear of the bunk bed and the floor skirting. */
export const BOARD = { x: 216, y: 50, w: 110, h: 43 };
export const BOARD_ROWS = 5;

const PAD = 3;
const ROW_PITCH = GLYPH_H + 1;
const HEADER_Y = PAD;
const FIRST_ROW_Y = HEADER_Y + GLYPH_H + 5; // header, gap, divider, gap

/** How many characters of "agent·project" fit beside a score. */
export function nameRoom(score: string): number {
	const room = BOARD.w - PAD * 2 - textWidth(score) - ADVANCE;
	return Math.floor((room + 1) / ADVANCE);
}

/** The champion's crown, one string per pixel row; drawn as filled rects. */
export const CROWN = ["x.x.x", "xxxxx", "xxxxx", "xxxxx"];
const CROWN_W = 5;
const CROWN_GAP = 1; // crown to name
const TITLE_GAP = 3; // DUELS to the crown, at the least

export interface HeaderLayout {
	name: { agent: string; project: string };
	maxChars: number;
	nameX: number;
	nameW: number;
	crownX: number;
}

/**
 * Where the champion goes in the header: name right-aligned to the board's
 * padding, the crown just left of it, the name cut to leave DUELS clear.
 * Null without a champion (the header is then just a centred DUELS).
 */
export function headerLayout(c: { agent: string; project: string } | null): HeaderLayout | null {
	if (!c) return null;
	const room = BOARD.w - PAD * 2 - textWidth("duels") - TITLE_GAP - CROWN_W - CROWN_GAP;
	const maxChars = Math.floor((room + 1) / ADVANCE);
	const name = fitName(c.agent.toLowerCase(), c.project.toLowerCase(), maxChars);
	const nameW = textWidth(`${name.agent}·${name.project}`);
	const nameX = BOARD.w - PAD - nameW;
	return { name, maxChars, nameX, nameW, crownX: nameX - CROWN_GAP - CROWN_W };
}

/** Cut agent·project to maxChars, project first, marking the cut with a dot like the nametag labels. */
export function fitName(agent: string, project: string, maxChars: number): { agent: string; project: string } {
	if (agent.length + 1 + project.length <= maxChars) return { agent, project };
	const a = agent.length + 2 > maxChars ? `${agent.slice(0, Math.max(1, maxChars - 3))}.` : agent;
	const left = maxChars - a.length - 1;
	const p = project.length <= left ? project : `${project.slice(0, Math.max(0, left - 1))}.`;
	return { agent: a, project: p };
}

/**
 * The duel standings as a wall panel: magenta header like the sign, plus yesterday's champion
 * (crown and name) on the right when there is one, then up
 * to five rows of two-tone agent·project names (nametag colours) with
 * right-aligned W-L. Rendered once per standings change; the scene blits it.
 */
export function renderScoreboard(rows: Standing[], champion: Champion | null = null): OffscreenCanvas {
	const out = new OffscreenCanvas(BOARD.w, BOARD.h);
	const ctx = out.getContext("2d")!;
	ctx.fillStyle = "rgba(10,6,19,0.92)";
	ctx.fillRect(0, 0, BOARD.w, BOARD.h);
	ctx.strokeStyle = "rgba(76,74,130,0.8)";
	ctx.lineWidth = 1;
	ctx.strokeRect(0.5, 0.5, BOARD.w - 1, BOARD.h - 1);

	const header = renderText("duels", PAL.neonMagenta);
	const lay = headerLayout(champion);
	if (lay && champion) {
		ctx.drawImage(header, PAD, HEADER_Y);
		ctx.fillStyle = PAL.neonYellow;
		CROWN.forEach((line, y) => {
			for (let x = 0; x < CROWN_W; x++) if (line[x] === "x") ctx.fillRect(lay.crownX + x, HEADER_Y + 1 + y, 1, 1);
		});
		let x = lay.nameX;
		for (const [text, color] of [
			[lay.name.agent, champion.agentColor],
			["·", PAL.steel],
			[lay.name.project, champion.accent],
		] as const) {
			ctx.drawImage(renderText(text, color), x, HEADER_Y);
			x += textWidth(text) + 1;
		}
	} else {
		ctx.drawImage(header, Math.round((BOARD.w - header.width) / 2), HEADER_Y);
	}
	ctx.fillStyle = PAL.dusk;
	ctx.fillRect(PAD, HEADER_Y + GLYPH_H + 2, BOARD.w - PAD * 2, 1);

	if (rows.length === 0) {
		const empty = renderText("no duels yet", PAL.steel);
		ctx.drawImage(empty, Math.round((BOARD.w - empty.width) / 2), FIRST_ROW_Y + ROW_PITCH);
		return out;
	}

	rows.slice(0, BOARD_ROWS).forEach((s, i) => {
		const y = FIRST_ROW_Y + i * ROW_PITCH;
		const score = `${s.wins}-${s.losses}`;
		const name = fitName(s.agent.toLowerCase(), s.project.toLowerCase(), nameRoom(score));
		let x = PAD;
		for (const [text, color] of [
			[name.agent, s.agentColor],
			["·", PAL.steel],
			[name.project, s.accent],
		] as const) {
			ctx.drawImage(renderText(text, color), x, y);
			x += textWidth(text) + 1;
		}
		const scoreImg = renderText(score, PAL.white);
		ctx.drawImage(scoreImg, BOARD.w - PAD - scoreImg.width, y);
	});
	return out;
}
