import { HerdrError, interpretHerdrResult, OFFLINE_AFTER, type AgentSource, type RawAgent } from "../shared/herdr-core";
import { LINK_LOST_MS } from "../mainview/world";

/**
 * What the Swift HerdrBridge replies with (saver/HerdrBridge.swift): the
 * feed the Agent View daemon publishes, as if herdr had just exited 0.
 */
export type BridgeReply =
	| { code: number; stdout: string }
	| { error: "missing" | "stale" | "unreadable"; message?: string };

export interface Bridge {
	list(): Promise<BridgeReply>;
}

/** Must fire before the renderer's link-lost banner (World.linkLost). */
export const BRIDGE_TIMEOUT_MS = LINK_LOST_MS - 1000;

/** The native bridge, or null in the preview thumbnail / a plain browser. */
export function webkitBridge(): Bridge | null {
	const handler = (globalThis as any).webkit?.messageHandlers?.herdr;
	if (!handler) return null;
	return { list: () => handler.postMessage({ cmd: "list" }) as Promise<BridgeReply> };
}

export class NativeHerdrSource implements AgentSource {
	constructor(
		private bridge: Bridge,
		private timeoutMs = BRIDGE_TIMEOUT_MS,
	) {}

	async list(): Promise<RawAgent[]> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new HerdrError("server-down", "bridge timeout")), this.timeoutMs);
		});
		let reply: BridgeReply;
		try {
			reply = await Promise.race([this.bridge.list(), timeout]);
		} catch (e) {
			if (e instanceof HerdrError) throw e;
			throw new HerdrError("server-down", String(e));
		} finally {
			clearTimeout(timer);
		}
		if ("error" in reply) {
			// no feed at all = the daemon never ran: skip the grace window, go to demo
			throw new HerdrError(reply.error === "missing" ? "not-installed" : "server-down", reply.message ?? reply.error);
		}
		return interpretHerdrResult(reply.code, reply.stdout);
	}

	async focus(): Promise<void> {
		throw new HerdrError("server-down", "focus is not available in the screensaver");
	}
}

/**
 * Consecutive live failures before the room switches to the demo. Must not
 * exceed OFFLINE_AFTER: the demo has to take over no later than the poller
 * itself would declare offline, or the OFFLINE banner comes back.
 */
export const DEMO_AFTER = OFFLINE_AFTER;

/**
 * Live herdr data when it flows, the scripted demo otherwise — so the
 * screensaver never shows the OFFLINE banner. Once live data has been seen,
 * short blips are rethrown and the poller's grace window re-shows the last
 * live room; anything longer, or herdr missing entirely, flips to the demo
 * while live is still probed every tick.
 */
export class LiveOrDemoSource implements AgentSource {
	private failures = 0;
	private hadLive = false;
	private demo: boolean;

	constructor(
		private live: AgentSource | null,
		private fallback: AgentSource,
	) {
		this.demo = live === null;
	}

	get isDemo(): boolean {
		return this.demo;
	}

	/** Screensaver: called on pause so a resume never trusts a stale "live" streak. */
	reset(): void {
		this.hadLive = false;
		this.failures = 0;
	}

	async list(): Promise<RawAgent[]> {
		if (this.live) {
			try {
				const agents = await this.live.list();
				this.failures = 0;
				this.hadLive = true;
				this.demo = false;
				return agents;
			} catch (e) {
				this.failures++;
				const missing = e instanceof HerdrError && e.reason === "not-installed";
				if (!this.demo && this.hadLive && !missing && this.failures < DEMO_AFTER) {
					throw e;
				}
				this.demo = true;
			}
		}
		return this.fallback.list();
	}

	// Intentionally a no-op: the screensaver has nothing to focus.
	async focus(): Promise<void> {}
}
