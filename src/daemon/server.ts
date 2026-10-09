import type { ServerWebSocket } from "bun";
import type { RoomState, Snapshot } from "../shared/types";
import { parseClientMessage, worldMessage, type Reply } from "./protocol";

/** What the server needs from the poller: the latest snapshot, each new one, and focus. */
export interface SnapshotFeed {
	last(): Snapshot;
	subscribe(fn: (s: Snapshot) => void): void;
	focus(id: string): Promise<{ ok: boolean; error?: string }>;
}

export interface ServerOptions {
	port: number;
	feed: SnapshotFeed;
	version: string;
	/** resend the latest world to a client after this much silence (default 1000) */
	heartbeatMs?: number;
	/** the shared room (duel, scores); defaults to the empty room */
	world?: () => RoomState;
	log?: (msg: string) => void;
}

export interface DaemonServer {
	readonly port: number;
	clients(): number;
	stop(): void;
}

interface Conn {
	id: number;
	client: string | null; // "app 0.1.0", from hello
	lastSentAt: number;
	warned: boolean; // bad messages are logged once per client
}

/** Caps what one client can send; anything larger closes the socket. */
export const MAX_PAYLOAD = 64 * 1024;

/**
 * Loopback names only: a web page that rebinds its own domain to 127.0.0.1
 * still sends its domain as Host, so DNS rebinding is refused here.
 */
export function hostAllowed(host: string | null, port: number): boolean {
	return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/**
 * True when listen failed because the port is taken. Bun may report it with
 * the errno code or only in the message, so both are checked.
 */
export function isAddrInUse(e: unknown): boolean {
	const err = e as { code?: unknown; message?: unknown } | null;
	return err?.code === "EADDRINUSE" || /in use/i.test(String(err?.message ?? ""));
}

const HEARTBEAT_MS = 1000;

type Command = (args: Record<string, unknown>, feed: SnapshotFeed) => Promise<{ ok: boolean; error?: string }>;

/** A Map, not an object literal: "toString" or "__proto__" must not resolve to a command. */
const COMMANDS = new Map<string, Command>([
	[
		"focus",
		async (args, feed) => {
			const agent = args["agent"];
			if (typeof agent !== "string" || !agent) return { ok: false, error: "bad arguments" };
			return feed.focus(agent);
		},
	],
]);

/** Loopback-only HTTP and WebSocket server that hands out the office's state. */
export function startServer(opts: ServerOptions): DaemonServer {
	const startedAt = Date.now();
	const sockets = new Set<ServerWebSocket<Conn>>();
	let nextId = 1;

	const world = opts.world ?? ((): RoomState => ({ duel: null, scores: [] }));
	const current = (): string => JSON.stringify(worldMessage(opts.feed.last(), world()));
	const log = opts.log ?? ((m: string) => console.log(m));
	const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;

	const send = (ws: ServerWebSocket<Conn>, text: string): void => {
		ws.send(text);
		ws.data.lastSentAt = Date.now();
	};
	const reply = (ws: ServerWebSocket<Conn>, r: Reply): void => {
		ws.send(JSON.stringify(r));
	};
	const name = (c: Conn): string => `#${c.id}${c.client ? ` ${c.client}` : ""}`;
	const warnOnce = (ws: ServerWebSocket<Conn>, why: string): void => {
		if (ws.data.warned) return;
		ws.data.warned = true;
		log(`client ${name(ws.data)} sent a bad message: ${why}`);
	};

	const server = Bun.serve<Conn>({
		hostname: "127.0.0.1",
		port: opts.port,
		fetch(req, srv) {
			if (!hostAllowed(req.headers.get("host"), srv.port)) return new Response("forbidden", { status: 403 });
			const { pathname } = new URL(req.url);
			if (pathname === "/v1/ws") {
				// browsers always send Origin; our clients (Bun, Swift URLSession) never do
				if (req.headers.has("origin")) return new Response("forbidden", { status: 403 });
				const data: Conn = { id: nextId++, client: null, lastSentAt: 0, warned: false };
				return srv.upgrade(req, { data }) ? undefined : new Response("upgrade required", { status: 426 });
			}
			if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
			if (pathname === "/v1/world") {
				return new Response(current(), { headers: { "content-type": "application/json" } });
			}
			if (pathname === "/v1/health") {
				return Response.json({ ok: true, version: opts.version, pid: process.pid, startedAt, clients: sockets.size });
			}
			return new Response("not found", { status: 404 });
		},
		websocket: {
			maxPayloadLength: MAX_PAYLOAD,
			open(ws) {
				sockets.add(ws);
				send(ws, current());
			},
			async message(ws, raw) {
				if (typeof raw !== "string") {
					warnOnce(ws, "binary frame");
					return;
				}
				const msg = parseClientMessage(raw);
				switch (msg.kind) {
					case "hello":
						ws.data.client = `${msg.client} ${msg.version}`;
						log(`client ${name(ws.data)} connected`);
						return;
					case "invalid":
						warnOnce(ws, msg.error);
						if (msg.id !== undefined) reply(ws, { t: "reply", id: msg.id, ok: false, error: msg.error });
						return;
					case "request": {
						const cmd = COMMANDS.get(msg.t);
						const res = cmd
							? await cmd(msg.args, opts.feed).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }))
							: { ok: false, error: "unknown command" };
						if (sockets.has(ws)) reply(ws, { t: "reply", id: msg.id, ...res });
						return;
					}
				}
			},
			close(ws) {
				sockets.delete(ws);
				log(`client ${name(ws.data)} left`);
			},
		},
	});

	opts.feed.subscribe(() => {
		const text = current();
		for (const ws of sockets) send(ws, text);
	});

	// the poller sleeps 2-5 s while herdr is down: clients still need a pulse every second
	const heartbeat = setInterval(
		() => {
			const now = Date.now();
			let text: string | null = null;
			for (const ws of sockets) {
				if (now - ws.data.lastSentAt < heartbeatMs) continue;
				text ??= current();
				send(ws, text);
			}
		},
		Math.max(25, Math.floor(heartbeatMs / 4)),
	);

	return {
		get port() {
			return server.port;
		},
		clients: () => sockets.size,
		stop() {
			clearInterval(heartbeat);
			server.stop(true);
		},
	};
}
