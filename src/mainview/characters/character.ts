import type { AgentStatus, AgentView } from "../../shared/types";
import { AnimationPlayer, type AnimName } from "../animation";
import { decodeSheet, type DecodedSheet } from "../sprites/pixel";
import { accentFor, outfitFor, skinFor } from "../sprites/palette";
import { CHARACTER, SLEEP } from "../sprites/sheets/character";
import { DOOR } from "../scene/layout";
import { makeNametag } from "../ui/nametag";
import type { CharState } from "./fsm";
import type { DuelPose, Duelist } from "../duels";
import type { Slot } from "../scene/slots";
import type { Vec2 } from "../scene/layout";

export type BubbleKind = "bang" | "question" | "zzz" | null;

export interface Character extends Duelist {
	agent: string;
	project: string;
	label: string;
	accent: string;
	outfitBase: string;
	focused: boolean;
	statusSince: number; // confirmed status change time (tooltip)
	anim: AnimationPlayer;
	sheet: DecodedSheet;
	nametag: OffscreenCanvas;
	walkJitter: number;
	retryAt: number;
}

function decodeFor(view: AgentView): DecodedSheet {
	const outfit = outfitFor(view.agent);
	const swap = {
		s: skinFor(view.id),
		h: outfit.hair,
		b: outfit.base,
		d: outfit.dark,
		a: accentFor(view.project),
	};
	const sheet = decodeSheet(CHARACTER, swap);
	for (const [name, frame] of decodeSheet(SLEEP, swap)) {
		sheet.set(name, frame);
	}
	return sheet;
}

function hashJitter(id: string): number {
	let h = 0;
	for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
	return (Math.abs(h) % 7) - 3;
}

export function makeLabel(view: AgentView): string {
	const text = `${view.agent}·${view.project}`;
	return text.length > 18 ? `${text.slice(0, 17)}.` : text;
}

export function createCharacter(view: AgentView, now: number): Character {
	const sheet = decodeFor(view);
	const outfit = outfitFor(view.agent);
	return {
		id: view.id,
		agent: view.agent,
		project: view.project,
		label: makeLabel(view),
		accent: accentFor(view.project),
		outfitBase: outfit.base,
		focused: view.focused,
		pos: { ...DOOR.spawn },
		facing: 1,
		path: [],
		state: "ENTERING",
		pending: null,
		slot: null,
		desiredStatus: view.status,
		idleSince: now,
		statusSince: now,
		gone: false,
		anim: new AnimationPlayer(sheet),
		sheet,
		nametag: makeNametag(
			view.agent,
			view.project,
			outfit.base,
			accentFor(view.project),
		),
		walkJitter: hashJitter(view.id),
		retryAt: 0,
		duelPose: null,
	};
}

/** Re-derive label/art when the pane's cwd (project) changes. */
export function refreshView(c: Character, view: AgentView): void {
	c.focused = view.focused;
	if (view.project !== c.project || view.agent !== c.agent) {
		c.project = view.project;
		c.agent = view.agent;
		c.label = makeLabel(view);
		c.accent = accentFor(view.project);
		c.outfitBase = outfitFor(view.agent).base;
		c.sheet = decodeFor(view);
		c.anim = new AnimationPlayer(c.sheet);
		c.nametag = makeNametag(c.agent, c.project, c.outfitBase, c.accent);
	}
}

const STATE_ANIM: Record<CharState, AnimName> = {
	ENTERING: "walk",
	WALKING: "walk",
	WORKING: "sitType",
	RAISING_HAND: "raiseHand",
	WATCHING_TV: "sitCouch",
	AT_BAR: "sitType", // arms forward = chopsticks over a noodle bowl
	SLEEPING: "sleep",
	IDLE_STANDING: "idle",
	CONFUSED: "confused",
	DUELING: "duelGuard",
	LEAVING: "walk",
};

const DUEL_ANIM: Record<DuelPose, AnimName> = {
	guard: "duelGuard",
	swing: "duelSwing",
	down: "duelDown",
	win: "duelWin",
};

export function animFor(c: Character): AnimName {
	if (c.state === "DUELING" && c.duelPose) return DUEL_ANIM[c.duelPose];
	return STATE_ANIM[c.state];
}

export function bubbleFor(c: Character): BubbleKind {
	switch (c.state) {
		case "RAISING_HAND":
			return "bang";
		case "CONFUSED":
			return "question";
		case "SLEEPING":
			return "zzz";
		default:
			return null;
	}
}

/** Does the current scene state satisfy the desired agent status? */
export function stateMatchesStatus(
	state: CharState,
	status: AgentStatus,
): boolean {
	switch (status) {
		case "working":
			return state === "WORKING";
		case "blocked":
			return state === "RAISING_HAND";
		case "idle":
			return (
				state === "WATCHING_TV" ||
				state === "AT_BAR" ||
				state === "SLEEPING" ||
				state === "IDLE_STANDING" ||
				state === "DUELING"
			);
		case "unknown":
			return state === "CONFUSED";
	}
}

/**
 * Blocked agents jump while waving: a visual-only vertical hop applied at
 * draw time (and to the '!' bubble) so paths/slots stay untouched.
 */
export function hopOffset(c: Character, now: number): number {
	if (c.state !== "RAISING_HAND") return 0;
	return -Math.round(Math.abs(Math.sin(now / 220)) * 3);
}

/** Sort key and hitbox for picking. */
export function hitBox(c: Character): { x: number; y: number; w: number; h: number } {
	const lying = c.state === "SLEEPING";
	const w = lying ? 24 : 16;
	const h = lying ? 16 : 24;
	return { x: c.pos.x - w / 2, y: c.pos.y - h + 1, w, h };
}

export function isSeated(c: Character, slot: Slot | null): slot is Slot {
	return slot !== null && (c.state === "WORKING" || c.state === "WATCHING_TV");
}

export function feetPos(c: Character): Vec2 {
	return c.pos;
}
