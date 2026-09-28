import type { Subagent } from "../shared/types";
import { LEAVE_MS, MAX_DRONES, createDrone, type Drone } from "./characters/drone";

export interface DroneParent {
	id: string;
	deskId: string | null; // null: no desk to hover over (all owned)
	accent: string;
	subagents: Subagent[]; // oldest first
}

export interface Overflow {
	parentId: string;
	deskId: string;
	accent: string;
	hidden: Subagent[]; // beyond MAX_DRONES
}

/**
 * Subagent drones per parent. Pure bookkeeping (no canvas), so every rule is
 * unit-testable; World feeds it each tick and the scene draws it.
 */
export class DroneFleet {
	private byParent = new Map<string, Drone[]>();
	private overflow = new Map<string, Overflow>();

	/** `parents` = every character in the room; anyone missing loses their drones. */
	sync(parents: DroneParent[], now: number, wallNow: number): void {
		const seen = new Set<string>();
		for (const p of parents) {
			seen.add(p.id);
			const drones = this.byParent.get(p.id) ?? [];
			const visible = p.deskId ? p.subagents.slice(0, MAX_DRONES) : [];
			const want = new Set(visible.map((s) => s.id));
			for (const d of drones) {
				if (d.leavingAt !== null) continue;
				if (!want.has(d.id)) d.leavingAt = now;
				else d.accent = p.accent;
			}
			for (const s of visible) {
				if (!drones.some((d) => d.id === s.id && d.leavingAt === null)) {
					drones.push(createDrone(s, { id: p.id, deskId: p.deskId!, accent: p.accent }, now, wallNow));
				}
			}
			this.byParent.set(p.id, drones);
			if (p.deskId && p.subagents.length > MAX_DRONES) {
				this.overflow.set(p.id, { parentId: p.id, deskId: p.deskId, accent: p.accent, hidden: p.subagents.slice(MAX_DRONES) });
			} else {
				this.overflow.delete(p.id);
			}
		}
		for (const [id, drones] of this.byParent) {
			if (!seen.has(id)) {
				for (const d of drones) if (d.leavingAt === null) d.leavingAt = now;
				this.overflow.delete(id);
			}
			const kept = drones.filter((d) => d.leavingAt === null || now - d.leavingAt < LEAVE_MS);
			if (kept.length > 0) this.byParent.set(id, kept);
			else this.byParent.delete(id);
		}
	}

	drones(): Drone[] {
		return [...this.byParent.values()].flat();
	}

	overflows(): Overflow[] {
		return [...this.overflow.values()];
	}

	/** A desk with flying drones keeps its holo-screen lit even when its owner is away. */
	deskBusy(deskId: string): boolean {
		return this.drones().some((d) => d.deskId === deskId && d.leavingAt === null);
	}
}
