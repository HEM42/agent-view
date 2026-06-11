import type { AgentStatus } from "../../shared/types";
import type { Slot, SlotManager } from "../scene/slots";
import { DOOR, type Vec2 } from "../scene/layout";
import { buildPath } from "./locomotion";

export type CharState =
	| "ENTERING"
	| "WALKING"
	| "WORKING"
	| "RAISING_HAND"
	| "WATCHING_TV"
	| "AT_BAR"
	| "SLEEPING"
	| "IDLE_STANDING"
	| "CONFUSED"
	| "LEAVING";

/** What the character is mid-walk towards. */
export interface Goal {
	state: CharState;
	slot: Slot | null;
}

export interface FsmChar {
	id: string;
	pos: Vec2;
	facing: 1 | -1;
	path: Vec2[];
	state: CharState;
	pending: Goal | null;
	slot: Slot | null;
	desiredStatus: AgentStatus;
	idleSince: number; // ms timestamp when confirmed status became idle
	gone: boolean;
}

export const IDLE_LONG_MS = 5 * 60_000; // couch first, bed after this

/**
 * Leaving a seat must route back through the slot's standPos (stand up off
 * the couch, climb down the ladder) — otherwise the path planner walks
 * straight through the furniture.
 */
function exitWaypoints(c: FsmChar): Vec2[] {
	const s = c.slot;
	if (!s) return [];
	if (c.state === "SLEEPING") {
		return [
			{ x: s.standPos.x, y: c.pos.y },
			{ ...s.standPos },
		];
	}
	if (
		c.state === "WATCHING_TV" ||
		c.state === "AT_BAR" ||
		c.state === "WORKING"
	) {
		return [{ ...s.standPos }];
	}
	return [];
}

function walkTo(c: FsmChar, target: Vec2, lane: number, goal: Goal): void {
	const exit = exitWaypoints(c);
	const start = exit.length > 0 ? exit[exit.length - 1]! : c.pos;
	c.path = [...exit, ...buildPath(start, target, lane)];
	if (goal.slot?.kind === "bed") {
		// climb the ladder: vertical leg up the ladder column, then slide in
		c.path.push(
			{ x: goal.slot.standPos.x, y: goal.slot.usePos.y },
			{ ...goal.slot.usePos },
		);
	}
	c.pending = goal;
	if (c.path.length === 0) {
		arrive(c);
	} else {
		c.state = "WALKING";
	}
}

export function arrive(c: FsmChar): void {
	const goal = c.pending;
	c.pending = null;
	if (!goal) {
		c.state = "IDLE_STANDING";
		return;
	}
	c.state = goal.state;
	c.slot = goal.slot;
	if (goal.slot && goal.state !== "RAISING_HAND") {
		c.pos = { ...goal.slot.usePos };
		c.facing = goal.slot.useFacing;
	}
}

/**
 * Drive the character toward the behavior its (debounced) status demands.
 * Called on every status change and on arrival re-evaluation. The slot
 * manager is the single source of seat truth.
 */
export function applyStatus(
	c: FsmChar,
	status: AgentStatus,
	slots: SlotManager,
	now: number,
): void {
	if (c.gone) {
		leave(c, slots);
		return;
	}

	switch (status) {
		case "working": {
			if (c.state === "WORKING") return;
			if (c.state === "RAISING_HAND" && c.slot?.kind === "desk") {
				// hand down, sit back: zero walk
				c.state = "WORKING";
				c.pos = { ...c.slot.usePos };
				c.facing = c.slot.useFacing;
				return;
			}
			const desk = slots.claimDesk(c.id);
			if (!desk) {
				// transiently full; stand near the desks and retry on next tick
				c.state = "IDLE_STANDING";
				return;
			}
			walkTo(c, desk.usePos, desk.lane, { state: "WORKING", slot: desk });
			return;
		}
		case "blocked": {
			if (c.state === "RAISING_HAND") return;
			if (c.state === "WORKING" && c.slot?.kind === "desk") {
				// stand up beside the desk, keep the seat claimed
				const desk = c.slot;
				c.state = "RAISING_HAND";
				c.pos = { ...desk.standPos };
				c.facing = desk.useFacing;
				return;
			}
			const desk = slots.claimDesk(c.id);
			if (!desk) {
				c.state = "CONFUSED";
				return;
			}
			walkTo(c, desk.standPos, desk.lane, {
				state: "RAISING_HAND",
				slot: desk,
			});
			return;
		}
		case "idle": {
			if (
				c.state === "WATCHING_TV" ||
				c.state === "AT_BAR" ||
				c.state === "SLEEPING" ||
				c.state === "IDLE_STANDING"
			) {
				return; // long-idle promotion handled in updateLongIdle
			}
			slots.releaseSeat(c.id); // stand up; desk ownership stays
			const spot =
				now - c.idleSince >= IDLE_LONG_MS
					? (slots.claimNearest("bed", c.id, c.pos) ??
						slots.claimIdleSpot(c.id, c.pos))
					: slots.claimIdleSpot(c.id, c.pos);
			walkTo(c, spot.standPos, spot.lane, {
				state: stateForIdleSlot(spot),
				slot: spot,
			});
			return;
		}
		case "unknown": {
			if (c.state === "CONFUSED") return;
			slots.releaseSeat(c.id);
			c.slot = null;
			c.path = [];
			c.pending = null;
			c.state = "CONFUSED"; // stays where it is, scratching its head
			return;
		}
	}
}

export function stateForIdleSlot(slot: Slot): CharState {
	switch (slot.kind) {
		case "couch":
			return "WATCHING_TV";
		case "bar":
			return "AT_BAR";
		case "bed":
			return "SLEEPING";
		default:
			return "IDLE_STANDING";
	}
}

/** Promote a long-idler from couch/loiter to a bed when one is free. */
export function updateLongIdle(
	c: FsmChar,
	slots: SlotManager,
	now: number,
): void {
	if (c.desiredStatus !== "idle" || c.gone) return;
	if (
		c.state !== "WATCHING_TV" &&
		c.state !== "AT_BAR" &&
		c.state !== "IDLE_STANDING"
	) {
		return;
	}
	if (now - c.idleSince < IDLE_LONG_MS) return;
	const bed = slots.claimNearest("bed", c.id, c.pos);
	if (!bed) return;
	walkTo(c, bed.standPos, bed.lane, { state: "SLEEPING", slot: bed });
}

export function leave(c: FsmChar, slots: SlotManager): void {
	if (c.state === "LEAVING") return;
	if (c.pending?.state === "LEAVING") return;
	slots.releaseAll(c.id);
	c.slot = null;
	walkTo(c, DOOR.spawn, DOOR.lane, { state: "LEAVING", slot: null });
}
