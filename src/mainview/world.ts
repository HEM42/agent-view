import type { AgentView, Snapshot } from "../shared/types";
import {
	animFor,
	createCharacter,
	hitBox,
	refreshView,
	stateMatchesStatus,
	type Character,
} from "./characters/character";
import {
	applyStatus,
	arrive,
	leave,
	updateLongIdle,
} from "./characters/fsm";
import { step } from "./characters/locomotion";
import { SlotManager } from "./scene/slots";
import type { Vec2 } from "./scene/layout";

const SPAWN_STAGGER_MS = 450;
const RETRY_MS = 1500;
const LINK_LOST_MS = 5000;

export class World {
	chars = new Map<string, Character>();
	slots = new SlotManager();
	herdrOnline = true;
	offlineReason: string | null = null;
	/** bumped whenever someone passes the door; scene plays the slide anim */
	doorPulseAt = 0;

	private spawnQueue: AgentView[] = [];
	private lastSpawnAt = 0;
	private lastMessageAt = 0;
	private latest = new Map<string, AgentView>();

	reconcile(snap: Snapshot, now: number): void {
		this.lastMessageAt = now;
		this.herdrOnline = snap.herdrOnline;
		this.offlineReason = snap.herdrOnline
			? null
			: (snap.offlineReason ?? "server-down");

		const seen = new Set<string>();
		for (const view of snap.agents) {
			seen.add(view.id);
			this.latest.set(view.id, view);
			const c = this.chars.get(view.id);
			if (c) {
				c.gone = false;
				refreshView(c, view);
				if (c.desiredStatus !== view.status) {
					c.desiredStatus = view.status;
					c.statusSince = now;
					if (view.status === "idle") c.idleSince = now;
					c.retryAt = 0; // react this frame
				}
			} else if (!this.spawnQueue.some((q) => q.id === view.id)) {
				this.spawnQueue.push(view);
			}
		}

		for (const [id, c] of this.chars) {
			if (!seen.has(id) && !c.gone) {
				c.gone = true;
				leave(c, this.slots);
				this.doorPulse(now);
			}
		}
		this.spawnQueue = this.spawnQueue.filter((q) => seen.has(q.id));
		for (const id of this.latest.keys()) {
			if (!seen.has(id)) this.latest.delete(id);
		}
	}

	linkLost(now: number): boolean {
		return this.lastMessageAt > 0 && now - this.lastMessageAt > LINK_LOST_MS;
	}

	update(dtMs: number, now: number): void {
		// staggered walk-ins: agents file in through the door one by one
		if (this.spawnQueue.length > 0 && now - this.lastSpawnAt >= SPAWN_STAGGER_MS) {
			const view = this.spawnQueue.shift()!;
			const c = createCharacter(view, now);
			if (view.status === "idle") c.idleSince = now;
			this.chars.set(view.id, c);
			this.doorPulse(now);
			this.lastSpawnAt = now;
		}

		for (const c of this.chars.values()) {
			this.updateChar(c, dtMs, now);
		}
	}

	private updateChar(c: Character, dtMs: number, now: number): void {
		// retarget mid-walk when the status changed under our feet
		if (
			!c.gone &&
			c.path.length > 0 &&
			c.pending &&
			c.pending.state !== "LEAVING" &&
			c.retryAt === 0 &&
			!stateMatchesStatus(c.pending.state, c.desiredStatus)
		) {
			c.retryAt = now + RETRY_MS;
			applyStatus(c, c.desiredStatus, this.slots, now);
		}

		if (c.path.length > 0) {
			const done = step(c, dtMs);
			if (done) {
				if (c.pending?.state === "LEAVING") {
					this.doorPulse(now);
					this.slots.releaseAll(c.id);
					this.chars.delete(c.id);
					return;
				}
				arrive(c);
			}
		} else if (c.state === "LEAVING") {
			// already at the door when told to leave
			this.doorPulse(now);
			this.slots.releaseAll(c.id);
			this.chars.delete(c.id);
			return;
		} else if (c.gone) {
			leave(c, this.slots);
		} else if (
			!stateMatchesStatus(c.state, c.desiredStatus) &&
			now >= c.retryAt
		) {
			// single self-healing rule: drive the scene toward the data
			c.retryAt = now + RETRY_MS;
			applyStatus(c, c.desiredStatus, this.slots, now);
		} else {
			updateLongIdle(c, this.slots, now);
		}

		c.anim.play(animFor(c));
		c.anim.update(dtMs);
	}

	private doorPulse(now: number): void {
		this.doorPulseAt = now;
	}

	/** y-sorted characters for the entity render pass */
	sorted(): Character[] {
		return [...this.chars.values()].sort(
			(a, b) => a.pos.y - b.pos.y || (a.id < b.id ? -1 : 1),
		);
	}

	/** topmost character at a virtual-pixel point (reverse draw order) */
	pick(p: Vec2): Character | null {
		const sorted = this.sorted();
		for (let i = sorted.length - 1; i >= 0; i--) {
			const c = sorted[i]!;
			const box = hitBox(c);
			if (
				p.x >= box.x &&
				p.x <= box.x + box.w &&
				p.y >= box.y &&
				p.y <= box.y + box.h
			) {
				return c;
			}
		}
		return null;
	}

	/** anyone blocked for over a minute? (the cat goes to judge them) */
	longestBlocked(now: number): Character | null {
		let best: Character | null = null;
		for (const c of this.chars.values()) {
			if (c.desiredStatus !== "blocked") continue;
			if (now - c.statusSince < 60_000) continue;
			if (!best || c.statusSince < best.statusSince) best = c;
		}
		return best;
	}

	workingCount(): number {
		let n = 0;
		for (const c of this.chars.values()) {
			if (c.desiredStatus === "working") n++;
		}
		return n;
	}

	tvOn(): boolean {
		for (const c of this.chars.values()) {
			if (c.state === "WATCHING_TV") return true;
		}
		return false;
	}
}
