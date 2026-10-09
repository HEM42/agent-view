import { HerdrPoller, type AgentSource } from "../bun/herdr";
import type { Snapshot } from "../shared/types";
import { DuelReferee, type DuelRefereeOptions } from "./duels";
import { ScoreBook } from "./scores";
import { startServer } from "./server";

export interface DaemonOptions {
	port: number;
	source: AgentSource;
	version: string;
	/** where the duel scores live; null (the default) keeps them in memory */
	scoresPath?: string | null;
	/** duel pacing; tests shrink it */
	referee?: DuelRefereeOptions;
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
	const referee = new DuelReferee(opts.referee);
	const book = new ScoreBook(opts.scoresPath ?? null, log);
	let loaded = false;
	let stopped = false;
	let saving: Promise<void> = Promise.resolve();
	const listeners: ((s: Snapshot) => void)[] = [];
	let herdrState = "";
	const tick = (s: Snapshot = poller.lastSnapshot()): void => {
		if (!loaded || stopped) return;
		referee.update(s.agents, Date.now());
		const results = referee.drainResults();
		if (results.length === 0) return;
		for (const r of results) {
			book.record(
				{ agent: r.winner.agent, project: r.winner.project },
				{ agent: r.loser.agent, project: r.loser.project },
			);
			log(`duel: ${r.winner.agent}·${r.winner.project} beat ${r.loser.agent}·${r.loser.project}`);
		}
		saving = saving.then(() => book.save()).catch((e) => log(`could not save scores: ${String(e)}`));
	};
	const poller = new HerdrPoller(opts.source, (s) => {
		// log only when the outcome changes, not once per tick
		const state = s.herdrOnline ? "herdr online" : `herdr offline (${s.offlineReason ?? "server-down"})`;
		if (state !== herdrState) {
			herdrState = state;
			log(state);
		}
		tick(s);
		for (const fn of listeners) fn(s);
	});
	const server = startServer({
		port: opts.port,
		version: opts.version,
		log,
		world: () => ({ duel: referee.current(), scores: book.rows() }),
		feed: {
			last: () => poller.lastSnapshot(),
			subscribe: (fn) => {
				listeners.push(fn);
			},
			focus: (id) => poller.focus(id),
		},
	});
	void book
		.load()
		.catch((e) => log(`could not load scores: ${String(e)}`))
		.finally(() => {
			loaded = true;
		});
	void poller.start();
	const timer = setInterval(tick, 250);
	return {
		get port() {
			return server.port;
		},
		stop() {
			stopped = true;
			clearInterval(timer);
			poller.stop();
			server.stop();
		},
	};
}
