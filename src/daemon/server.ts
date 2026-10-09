import type { ServerWebSocket } from "bun";
import type { Snapshot } from "../shared/types";
import { worldMessage, type World } from "./protocol";

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

/** Loopback-only HTTP and WebSocket server that hands out the office's state. */
export function startServer(opts: ServerOptions): DaemonServer {
	const startedAt = Date.now();
	const sockets = new Set<ServerWebSocket<Conn>>();
	let nextId = 1;

	// pieces 2 and 3 fill this in
	const world = (): World => ({});
	const current = (): string => JSON.stringify(worldMessage(opts.feed.last(), world()));

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
			},
			message() {},
			close(ws) {
				sockets.delete(ws);
			},
		},
	});

	return {
		get port() {
			return server.port;
		},
		clients: () => sockets.size,
		stop() {
			server.stop(true);
		},
	};
}
