import { parseServerMessage, roomOf, type Reply } from "../daemon/protocol";
import type { Snapshot } from "../shared/types";

export interface ClientTimings {
	deadMs: number; // no world for this long: the socket is dead, and the room goes offline
	backoffMinMs: number;
	backoffMaxMs: number;
	requestTimeoutMs: number;
	offlineEveryMs: number; // keep the renderer fed while offline, so it never shows link-lost
	tickMs: number;
}

export const DEFAULT_TIMINGS: ClientTimings = {
	deadMs: 3000,
	backoffMinMs: 500,
	backoffMaxMs: 5000,
	requestTimeoutMs: 3000,
	offlineEveryMs: 1000,
	tickMs: 250,
};

export interface ClientOptions {
	url: string;
	client: string;
	version: string;
	onSnapshot: (s: Snapshot) => void;
	timings?: Partial<ClientTimings>;
}

type Fault = "no-daemon" | "protocol-error";

export function offlineSnapshot(reason: Fault, ts: number): Snapshot {
	return { herdrOnline: false, offlineReason: reason, agents: [], ts };
}

interface Pending {
	resolve: (r: Reply) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * The app's line to the daemon. The daemon pushes full world messages
 * (at least once a second), so a client never asks for state: it only
 * watches for silence, reconnects with backoff, and relays snapshots.
 */
export class DaemonClient {
	private t: ClientTimings;
	private ws: WebSocket | null = null;
	private open = false;
	private stopped = true;
	private lastWorldAt = 0;
	private openedAt = 0;
	private lastTickAt = 0;
	private lastOfflineAt = 0;
	private fault: Fault = "no-daemon";
	private backoff: number;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private ticker: ReturnType<typeof setInterval> | null = null;
	private seq = 0;
	private pending = new Map<string, Pending>();
	private last: Snapshot = offlineSnapshot("no-daemon", 0);

	constructor(private opts: ClientOptions) {
		this.t = { ...DEFAULT_TIMINGS, ...opts.timings };
		this.backoff = this.t.backoffMinMs;
	}

	lastSnapshot(): Snapshot {
		return this.last;
	}

	start(): void {
		if (!this.stopped) return;
		this.stopped = false;
		this.lastWorldAt = Date.now(); // the offline clock starts at launch
		this.lastTickAt = this.lastWorldAt;
		this.ticker = setInterval(() => this.tick(), this.t.tickMs);
		this.connect();
	}

	stop(): void {
		this.stopped = true;
		if (this.ticker) clearInterval(this.ticker);
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.ticker = null;
		this.reconnectTimer = null;
		this.drop();
	}

	request(t: string, args: Record<string, unknown> = {}): Promise<Reply> {
		const ws = this.ws;
		if (!ws || !this.open) return Promise.resolve({ t: "reply", id: "", ok: false, error: "no daemon" });
		const id = String(++this.seq);
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				resolve({ t: "reply", id, ok: false, error: "timeout" });
			}, this.t.requestTimeoutMs);
			this.pending.set(id, { resolve, timer });
			ws.send(JSON.stringify({ ...args, t, id }));
		});
	}

	private connect(): void {
		if (this.stopped) return;
		let ws: WebSocket;
		try {
			ws = new WebSocket(this.opts.url);
		} catch {
			this.scheduleReconnect();
			return;
		}
		this.ws = ws;
		ws.onopen = () => {
			if (this.ws !== ws) return;
			this.open = true;
			this.openedAt = Date.now();
			ws.send(JSON.stringify({ t: "hello", client: this.opts.client, version: this.opts.version }));
		};
		ws.onmessage = (ev) => {
			if (this.ws === ws) this.onMessage(String(ev.data));
		};
		ws.onclose = () => {
			if (this.ws !== ws) return; // already dropped by us
			this.fault = "no-daemon"; // a refused or lost connection, whatever came before
			this.drop();
			this.scheduleReconnect();
		};
	}

	private onMessage(text: string): void {
		const msg = parseServerMessage(text);
		switch (msg.kind) {
			case "world": {
				this.lastWorldAt = Date.now();
				this.backoff = this.t.backoffMinMs;
				this.fault = "no-daemon";
				const room = roomOf(msg.world);
				this.last = room ? { ...msg.snapshot, room } : msg.snapshot;
				this.opts.onSnapshot(this.last);
				return;
			}
			case "incompatible":
				this.fault = "protocol-error";
				this.drop();
				this.scheduleReconnect();
				return;
			case "reply": {
				const p = this.pending.get(msg.reply.id);
				if (!p) return;
				clearTimeout(p.timer);
				this.pending.delete(msg.reply.id);
				p.resolve(msg.reply);
				return;
			}
			case "invalid":
				return;
		}
	}

	private tick(): void {
		const now = Date.now();
		// A gap this long between ticks means the process was suspended (the Mac slept):
		// the wall clock jumped, but the daemon's heartbeat has not had a chance to run
		// yet. Judging a healthy loopback socket by that jump would drop it and empty the
		// office, so restart the silence clocks and give the daemon its full window.
		if (this.lastTickAt > 0 && now - this.lastTickAt > this.t.deadMs) {
			this.lastWorldAt = now;
			this.openedAt = now;
		}
		this.lastTickAt = now;
		// Open but silent: half-open after sleep, or a stuck daemon. Measured from the
		// later of the last world and this socket's open, so a fresh reconnect gets its
		// full window; a connect still in flight is left to its own close/error.
		if (this.open && now - Math.max(this.lastWorldAt, this.openedAt) > this.t.deadMs) {
			this.drop();
			this.scheduleReconnect();
		}
		if (now - this.lastWorldAt > this.t.deadMs && now - this.lastOfflineAt >= this.t.offlineEveryMs) {
			this.lastOfflineAt = now;
			this.last = offlineSnapshot(this.fault, now);
			this.opts.onSnapshot(this.last);
		}
	}

	/** Forget the socket now; its late onclose is ignored. Pending requests fail. */
	private drop(): void {
		const ws = this.ws;
		this.ws = null;
		this.open = false;
		try {
			ws?.close();
		} catch {
			// already closed
		}
		for (const [id, p] of this.pending) {
			clearTimeout(p.timer);
			p.resolve({ t: "reply", id, ok: false, error: "no daemon" });
		}
		this.pending.clear();
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer) return;
		const delay = this.backoff;
		this.backoff = Math.min(this.backoff * 2, this.t.backoffMaxMs);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
	}
}
