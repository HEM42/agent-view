import {
	BAR,
	BED,
	COUCH,
	DESKS,
	LANES,
	LOITER_SPOTS,
	type Vec2,
} from "./layout";

export type SlotKind = "desk" | "couch" | "bar" | "bed" | "loiter";

export interface Slot {
	id: string;
	kind: SlotKind;
	standPos: Vec2; // on-lane approach point (path target)
	usePos: Vec2; // character anchor while using the slot
	useFacing: 1 | -1;
	lane: number;
	occupiedBy: string | null;
}

/**
 * Single claim path for every seat in the room — two characters can never
 * share a slot. Desks are additionally *owned*: assigned at first sight of a
 * terminal_id and kept until despawn, so a character always returns to the
 * same desk.
 */
export class SlotManager {
	private slots: Slot[] = [];
	private deskOwners = new Map<string, string>(); // charId -> desk slot id

	constructor() {
		for (const d of DESKS) {
			this.slots.push({
				id: d.id,
				kind: "desk",
				standPos: d.standPos,
				usePos: d.seatPos,
				useFacing: 1,
				lane: d.lane,
				occupiedBy: null,
			});
		}
		COUCH.seats.forEach((seat, i) => {
			this.slots.push({
				id: `couch-${i}`,
				kind: "couch",
				standPos: { x: seat.x, y: LANES[COUCH.lane]! },
				usePos: seat,
				useFacing: -1, // toward the TV
				lane: COUCH.lane,
				occupiedBy: null,
			});
		});
		BAR.seats.forEach((seat, i) => {
			this.slots.push({
				id: `bar-${i}`,
				kind: "bar",
				standPos: { x: seat.x, y: LANES[BAR.lane]! },
				usePos: seat,
				useFacing: i < 2 ? 1 : -1, // face the middle of the counter
				lane: BAR.lane,
				occupiedBy: null,
			});
		});
		BED.levels.forEach((level, i) => {
			this.slots.push({
				id: `bed-${i}`,
				kind: "bed",
				standPos: { x: BED.ladderX, y: LANES[BED.lane]! },
				usePos: level,
				useFacing: -1, // authored head-left
				lane: BED.lane,
				occupiedBy: null,
			});
		});
		LOITER_SPOTS.forEach((spot, i) => {
			this.slots.push({
				id: `loiter-${i}`,
				kind: "loiter",
				standPos: spot,
				usePos: spot,
				useFacing: i % 2 ? -1 : 1,
				lane: spot.y <= LANES[0]! + 8 ? 0 : 2,
				occupiedBy: null,
			});
		});
	}

	all(): readonly Slot[] {
		return this.slots;
	}

	byId(id: string): Slot | undefined {
		return this.slots.find((s) => s.id === id);
	}

	held(charId: string): Slot | null {
		return this.slots.find((s) => s.occupiedBy === charId) ?? null;
	}

	/** Highest desk index in use — drives how many desks are drawn. */
	desksInUse(): number {
		let max = 0;
		this.deskOwners.forEach((slotId) => {
			const idx = DESKS.findIndex((d) => d.id === slotId);
			if (idx + 1 > max) max = idx + 1;
		});
		return max;
	}

	/**
	 * Desk for charId: the owned one if any, otherwise the first free desk
	 * (fill order A→B→C) which becomes owned. Returns null only when all 15
	 * desks are owned by living characters.
	 */
	claimDesk(charId: string): Slot | null {
		const ownedId = this.deskOwners.get(charId);
		if (ownedId) {
			const slot = this.byId(ownedId)!;
			this.releaseSeat(charId);
			slot.occupiedBy = charId;
			return slot;
		}
		for (const d of DESKS) {
			const slot = this.byId(d.id)!;
			if (!this.deskOwnedBySomeoneElse(slot.id, charId) && !slot.occupiedBy) {
				this.deskOwners.set(charId, slot.id);
				this.releaseSeat(charId);
				slot.occupiedBy = charId;
				return slot;
			}
		}
		return null;
	}

	ownedDesk(charId: string): string | null {
		return this.deskOwners.get(charId) ?? null;
	}

	/**
	 * Own a desk without sitting down: an agent that has only ever idled still
	 * needs one for its subagent drones. Null only when all 15 are owned.
	 */
	ownDesk(charId: string): string | null {
		const owned = this.deskOwners.get(charId);
		if (owned) return owned;
		for (const d of DESKS) {
			const slot = this.byId(d.id)!;
			if (!this.deskOwnedBySomeoneElse(slot.id, charId) && !slot.occupiedBy) {
				this.deskOwners.set(charId, slot.id);
				return slot.id;
			}
		}
		return null;
	}

	private deskOwnedBySomeoneElse(slotId: string, charId: string): boolean {
		for (const [owner, id] of this.deskOwners) {
			if (id === slotId && owner !== charId) return true;
		}
		return false;
	}

	/** Idle seat preference: couch → ramen bar → loiter. Beds are reached
	 * via the long-idle rule, not the default chain. Never fails. */
	claimIdleSpot(charId: string, near: Vec2): Slot {
		return (
			this.claimNearest("couch", charId, near) ??
			this.claimNearest("bar", charId, near) ??
			this.claimNearest("loiter", charId, near) ??
			this.claimNearest("bed", charId, near)! // 11 idle spots before this
		);
	}

	claimNearest(kind: SlotKind, charId: string, near: Vec2): Slot | null {
		let best: Slot | null = null;
		let bestD = Infinity;
		for (const s of this.slots) {
			if (s.kind !== kind || s.occupiedBy) continue;
			if (kind === "desk" && this.deskOwnedBySomeoneElse(s.id, charId)) continue;
			const d = Math.abs(s.standPos.x - near.x) + Math.abs(s.standPos.y - near.y);
			if (d < bestD || (d === bestD && best && s.id < best.id)) {
				bestD = d;
				best = s;
			}
		}
		if (best) {
			this.releaseSeat(charId);
			best.occupiedBy = charId;
		}
		return best;
	}

	/** Stand up (frees the seat) but keep desk ownership. */
	releaseSeat(charId: string): void {
		for (const s of this.slots) {
			if (s.occupiedBy === charId) s.occupiedBy = null;
		}
	}

	/** Full despawn: seat + desk ownership. */
	releaseAll(charId: string): void {
		this.releaseSeat(charId);
		this.deskOwners.delete(charId);
	}
}
