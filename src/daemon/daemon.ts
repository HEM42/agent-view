import { HerdrPoller, type AgentSource } from "../bun/herdr";
import type { Snapshot } from "../shared/types";
import { startServer } from "./server";

export interface DaemonOptions {
	port: number;
	source: AgentSource;
	version: string;
	log?: (msg: string) => void;
}

export interface Daemon {
	readonly port: number;
	stop(): void;
}

/** launchd's log file has no timestamps of its own. */
export function stamp(msg: string): void {
	console.log(`${new Date().toISOString()} ${msg}`);
}

/**
 * The office's single source of truth: the herdr poller behind the
 * WebSocket server. Throws (see isAddrInUse) when the port is taken; the
 * poller only starts once the server is listening.
 */
export function startDaemon(opts: DaemonOptions): Daemon {
	const log = opts.log ?? stamp;
	const listeners: ((s: Snapshot) => void)[] = [];
	let herdrState = "";
	const poller = new HerdrPoller(opts.source, (s) => {
		// log only when the outcome changes, not once per tick
		const state = s.herdrOnline ? "herdr online" : `herdr offline (${s.offlineReason ?? "server-down"})`;
		if (state !== herdrState) {
			herdrState = state;
			log(state);
		}
		for (const fn of listeners) fn(s);
	});
	const server = startServer({
		port: opts.port,
		version: opts.version,
		log,
		feed: {
			last: () => poller.lastSnapshot(),
			subscribe: (fn) => {
				listeners.push(fn);
			},
			focus: (id) => poller.focus(id),
		},
	});
	void poller.start();
	return {
		get port() {
			return server.port;
		},
		stop() {
			poller.stop();
			server.stop();
		},
	};
}
