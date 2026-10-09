import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { startServer, type DaemonServer } from "../daemon/server";
import { manualFeed, snap, waitFor } from "../daemon/testing";
import type { Snapshot } from "../shared/types";
import { DaemonClient, type ClientTimings } from "./daemon-client";

const FAST: Partial<ClientTimings> = {
	deadMs: 300,
	backoffMinMs: 30,
	backoffMaxMs: 120,
	requestTimeoutMs: 300,
	offlineEveryMs: 100,
	tickMs: 20,
};

const cleanups: (() => void)[] = [];
afterEach(() => {
	setSystemTime(); // back to the real clock
	for (const fn of cleanups.splice(0)) fn();
});

function serve(feed = manualFeed().feed, port = 0, extra: { heartbeatMs?: number; log?: (m: string) => void } = {}): DaemonServer {
	const s = startServer({ port, feed, version: "t", log: () => {}, heartbeatMs: 50, ...extra });
	cleanups.push(() => s.stop());
	return s;
}

function connect(port: number) {
	const got: Snapshot[] = [];
	const c = new DaemonClient({
		url: `ws://127.0.0.1:${port}/v1/ws`,
		client: "app",
		version: "test",
		onSnapshot: (s) => got.push(s),
		timings: FAST,
	});
	cleanups.push(() => c.stop());
	c.start();
	return { c, got };
}

/** A port nothing listens on: bind one, then free it. */
function freePort(): number {
	const s = startServer({ port: 0, feed: manualFeed().feed, version: "t", log: () => {} });
	const p = s.port;
	s.stop();
	return p;
}

const online = (got: Snapshot[]) => got.filter((s) => s.herdrOnline);
const offline = (got: Snapshot[], reason: string) => got.filter((s) => !s.herdrOnline && s.offlineReason === reason);

describe("DaemonClient", () => {
	test("relays world snapshots and says hello", async () => {
		const log: string[] = [];
		const s = serve(manualFeed(snap({ ts: 11 })).feed, 0, { log: (m) => log.push(m) });
		const { c, got } = connect(s.port);
		await waitFor(() => online(got).length >= 1);
		expect(got[0]).toEqual({ ...snap({ ts: 11 }), room: { duel: null, scores: [] } });
		expect(c.lastSnapshot()).toEqual({ ...snap({ ts: 11 }), room: { duel: null, scores: [] } });
		await waitFor(() => log.some((l) => l.includes("app test") && l.includes("connected")));
	});

	test("a world with scores gives the snapshot a room; one without gives none", async () => {
		const row = { key: "claude·n", agent: "claude", project: "n", wins: 2, losses: 1 };
		let world: unknown = { duel: null, scores: [row] };
		const srv = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no", { status: 400 })),
			websocket: {
				open: (ws) => {
					ws.send(JSON.stringify({ t: "world", api: 1, snapshot: snap({ ts: 3 }), world }));
				},
				message() {},
			},
		});
		cleanups.push(() => srv.stop(true));
		const a = connect(srv.port);
		await waitFor(() => online(a.got).length >= 1);
		expect(a.got[0]!.room).toEqual({ duel: null, scores: [row] });
		expect(a.c.lastSnapshot().room).toEqual({ duel: null, scores: [row] });
		world = {};
		const b = connect(srv.port);
		await waitFor(() => online(b.got).length >= 1);
		expect("room" in b.got[0]!).toBe(false);
	});

	test("before the first world, lastSnapshot is the no-daemon snapshot with ts 0", () => {
		const { c } = connect(freePort());
		expect(c.lastSnapshot()).toEqual({ herdrOnline: false, offlineReason: "no-daemon", agents: [], ts: 0 });
	});

	test("no daemon: offline after deadMs, not before, then repeated", async () => {
		const t0 = Date.now();
		const { got } = connect(freePort());
		await waitFor(() => offline(got, "no-daemon").length >= 1);
		expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
		await waitFor(() => offline(got, "no-daemon").length >= 3);
	});

	test("daemon restart: offline, then back online on the same port", async () => {
		const f = manualFeed();
		const s1 = serve(f.feed);
		const port = s1.port;
		const { got } = connect(port);
		await waitFor(() => online(got).length >= 1);
		s1.stop();
		await waitFor(() => offline(got, "no-daemon").length >= 1);
		const before = online(got).length;
		serve(f.feed, port);
		await waitFor(() => online(got).length > before, 3000);
	});

	test("a silent daemon (half-open socket) is dropped and reconnected", async () => {
		const log: string[] = [];
		const s = serve(manualFeed().feed, 0, { heartbeatMs: 60_000, log: (m) => log.push(m) });
		const { got } = connect(s.port);
		await waitFor(() => online(got).length >= 1);
		// no emits, no heartbeat: only a reconnect brings a second world
		await waitFor(() => online(got).length >= 2, 3000);
		// the world is sent on connect, before the hello that gets logged
		await waitFor(() => log.filter((l) => l.includes("connected")).length >= 2);
	});

	test("a clock jump from sleeping does not drop a healthy socket", async () => {
		const log: string[] = [];
		// no heartbeat: nothing refreshes lastWorldAt between the jump and the next tick
		const s = serve(manualFeed().feed, 0, { heartbeatMs: 60_000, log: (m) => log.push(m) });
		const { got } = connect(s.port);
		await waitFor(() => online(got).length >= 1);
		setSystemTime(new Date(Date.now() + 60_000)); // the Mac slept for a minute
		await Bun.sleep(150); // several ticks, still inside deadMs of real time
		expect(offline(got, "no-daemon").length).toBe(0);
		expect(log.filter((l) => l.includes("connected")).length).toBe(1);
	});

	test("focus round trip", async () => {
		const f = manualFeed();
		const s = serve(f.feed);
		const { c, got } = connect(s.port);
		await waitFor(() => online(got).length >= 1);
		expect(await c.request("focus", { agent: "term_1" })).toMatchObject({ ok: true });
		expect(f.focused).toEqual(["term_1"]);
	});

	test("a request while disconnected fails at once", async () => {
		const { c } = connect(freePort());
		const t0 = Date.now();
		expect(await c.request("focus", { agent: "x" })).toMatchObject({ ok: false, error: "no daemon" });
		expect(Date.now() - t0).toBeLessThan(50);
	});

	test("a request with no reply times out", async () => {
		const f = manualFeed();
		f.focusResult = "hang";
		const s = serve(f.feed, 0, { heartbeatMs: 50 });
		const { c, got } = connect(s.port);
		await waitFor(() => online(got).length >= 1);
		expect(await c.request("focus", { agent: "x" })).toMatchObject({ ok: false, error: "timeout" });
	});

	test("a pending request fails when the socket closes", async () => {
		const f = manualFeed();
		f.focusResult = "hang";
		const s = serve(f.feed);
		const { c, got } = connect(s.port);
		await waitFor(() => online(got).length >= 1);
		const pending = c.request("focus", { agent: "x" });
		s.stop();
		expect(await pending).toMatchObject({ ok: false, error: "no daemon" });
	});

	test("an incompatible api version shows protocol-error", async () => {
		const srv = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no", { status: 400 })),
			websocket: {
				open: (ws) => {
					ws.send(JSON.stringify({ t: "world", api: 2, snapshot: snap(), world: {} }));
				},
				message() {},
			},
		});
		cleanups.push(() => srv.stop(true));
		const { got } = connect(srv.port);
		await waitFor(() => offline(got, "protocol-error").length >= 1);
		expect(online(got).length).toBe(0);
	});
});
