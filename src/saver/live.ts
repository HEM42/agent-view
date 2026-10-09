import { parseServerMessage } from "../daemon/protocol";
import type { Snapshot } from "../shared/types";

/** A pushed world older than this is gone: the daemon sends one at least every second. */
export const STALE_MS = 3000; // keep STALE_MS + ONLINE_INTERVAL_MS inside LINK_LOST_MS (guarded in live.test.ts)
/** After a (re)start, wait this long for the first world before the demo plays. */
export const RESUME_GRACE_MS = 1500;

export type Mode = "live" | "demo" | "wait";

/**
 * The daemon's worlds as the saver's Swift DaemonLink pushes them in
 * (window.saver.world). The daemon's poller already debounces statuses and
 * rides out herdr blips, so the page only judges freshness.
 */
export class SaverFeed {
	private last: Snapshot | null = null;
	private lastAt = 0;
	private resumedAt = 0;
	private lastBeatAt = 0;

	/** A raw frame from the bridge; anything but a world in our api is ignored. */
	accept(text: string, now: number): void {
		const msg = parseServerMessage(text);
		if (msg.kind !== "world") return;
		this.last = msg.snapshot;
		this.lastAt = now;
	}

	/** On (re)start: a resumed saver never trusts a world from before the pause. */
	reset(now: number): void {
		this.last = null;
		this.lastAt = 0;
		this.resumedAt = now;
		this.lastBeatAt = 0;
	}

	/**
	 * Called on every demo-poller emit (about once a second). A gap far longer
	 * than that means the page was suspended (sleep): restart the freshness
	 * clock so the room isn't swapped for the demo before the next world lands.
	 */
	beat(now: number): void {
		if (this.last && this.lastBeatAt > 0 && now - this.lastBeatAt > STALE_MS) this.lastAt = now;
		this.lastBeatAt = now;
	}

	mode(now: number): Mode {
		if (this.last?.herdrOnline && now - this.lastAt <= STALE_MS) return "live";
		if (now - this.resumedAt < RESUME_GRACE_MS) return "wait";
		return "demo";
	}

	/** The snapshot to show, or null when the room isn't live. */
	live(now: number): Snapshot | null {
		return this.mode(now) === "live" ? this.last : null;
	}
}
