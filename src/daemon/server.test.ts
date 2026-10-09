import { afterEach, describe, expect, test } from "bun:test";
import { hostAllowed, isAddrInUse, startServer, type DaemonServer } from "./server";
import { manualFeed, rawRequest, snap, TestSocket, waitFor } from "./testing";

const servers: DaemonServer[] = [];
afterEach(() => {
	for (const s of servers.splice(0)) s.stop();
});

function serve(feed = manualFeed().feed, extra: { heartbeatMs?: number; log?: (m: string) => void } = {}) {
	const s = startServer({ port: 0, feed, version: "9.9.9", log: () => {}, ...extra });
	servers.push(s);
	return s;
}

const UPGRADE = [
	"Upgrade: websocket",
	"Connection: Upgrade",
	"Sec-WebSocket-Version: 13",
	"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
];

describe("hostAllowed", () => {
	test("loopback names with the right port only", () => {
		expect(hostAllowed("127.0.0.1:47371", 47371)).toBe(true);
		expect(hostAllowed("localhost:47371", 47371)).toBe(true);
		expect(hostAllowed("127.0.0.1:1", 47371)).toBe(false);
		expect(hostAllowed("evil.example:47371", 47371)).toBe(false);
		expect(hostAllowed("127.0.0.1", 47371)).toBe(false);
		expect(hostAllowed(null, 47371)).toBe(false);
	});
});

describe("HTTP", () => {
	test("GET /v1/world returns the world message", async () => {
		const f = manualFeed(snap({ ts: 42 }));
		const s = serve(f.feed);
		const res = await fetch(`http://127.0.0.1:${s.port}/v1/world`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ t: "world", api: 1, snapshot: snap({ ts: 42 }), world: {} });
	});

	test("GET /v1/health", async () => {
		const s = serve();
		const body: any = await (await fetch(`http://127.0.0.1:${s.port}/v1/health`)).json();
		expect(body).toMatchObject({ ok: true, version: "9.9.9", pid: process.pid, clients: 0 });
		expect(typeof body.startedAt).toBe("number");
	});

	test("unknown path is 404, non-GET is 405", async () => {
		const s = serve();
		expect((await fetch(`http://127.0.0.1:${s.port}/nope`)).status).toBe(404);
		expect((await fetch(`http://127.0.0.1:${s.port}/v1/world`, { method: "POST" })).status).toBe(405);
	});

	test("a foreign Host header is refused (DNS rebinding)", async () => {
		const s = serve();
		const status = await rawRequest(s.port, ["GET /v1/world HTTP/1.1", "Host: evil.example", "Connection: close"]);
		expect(status).toStartWith("HTTP/1.1 403");
	});

	test("localhost Host is accepted", async () => {
		const s = serve();
		const status = await rawRequest(s.port, ["GET /v1/health HTTP/1.1", `Host: localhost:${s.port}`, "Connection: close"]);
		expect(status).toStartWith("HTTP/1.1 200");
	});
});

describe("WebSocket upgrade security", () => {
	test("an upgrade without Origin is accepted", async () => {
		const s = serve();
		const status = await rawRequest(s.port, ["GET /v1/ws HTTP/1.1", `Host: 127.0.0.1:${s.port}`, ...UPGRADE]);
		expect(status).toStartWith("HTTP/1.1 101");
	});

	test("an upgrade with any Origin is refused (browsers)", async () => {
		const s = serve();
		for (const origin of ["https://evil.example", "null", "file://"]) {
			const status = await rawRequest(s.port, [
				"GET /v1/ws HTTP/1.1",
				`Host: 127.0.0.1:${s.port}`,
				...UPGRADE,
				`Origin: ${origin}`,
			]);
			expect(status).toStartWith("HTTP/1.1 403");
		}
	});
});

describe("startup", () => {
	test("a taken port throws an error isAddrInUse recognises", () => {
		const s = serve();
		let err: unknown = null;
		try {
			startServer({ port: s.port, feed: manualFeed().feed, version: "x", log: () => {} });
		} catch (e) {
			err = e;
		}
		expect(err).not.toBeNull();
		expect(isAddrInUse(err)).toBe(true);
		expect(isAddrInUse(new Error("something else"))).toBe(false);
	});
});

const sockets: TestSocket[] = [];
afterEach(() => {
	for (const s of sockets.splice(0)) s.close();
});

async function client(port: number): Promise<TestSocket> {
	const s = new TestSocket(`ws://127.0.0.1:${port}/v1/ws`);
	sockets.push(s);
	await s.opened();
	return s;
}

const worlds = (s: TestSocket) => s.messages.filter((m) => m.t === "world");
const replies = (s: TestSocket) => s.messages.filter((m) => m.t === "reply");

describe("WebSocket", () => {
	test("a client gets the current world on connect", async () => {
		const f = manualFeed(snap({ ts: 7 }));
		const s = serve(f.feed);
		const c = await client(s.port);
		await waitFor(() => worlds(c).length >= 1);
		expect(worlds(c)[0]).toEqual({ t: "world", api: 1, snapshot: snap({ ts: 7 }), world: {} });
	});

	test("every emit is broadcast to every client", async () => {
		const f = manualFeed();
		const s = serve(f.feed, { heartbeatMs: 60_000 });
		const a = await client(s.port);
		const b = await client(s.port);
		await waitFor(() => s.clients() === 2);
		f.emit(snap({ ts: 99 }));
		await waitFor(() => worlds(a).some((m) => m.snapshot.ts === 99) && worlds(b).some((m) => m.snapshot.ts === 99));
		const health: any = await (await fetch(`http://127.0.0.1:${s.port}/v1/health`)).json();
		expect(health.clients).toBe(2);
	});

	test("the heartbeat resends the world while the feed is quiet", async () => {
		const s = serve(manualFeed().feed, { heartbeatMs: 100 });
		const c = await client(s.port);
		await waitFor(() => worlds(c).length >= 4, 1500);
	});

	test("hello is logged with the client's name and version", async () => {
		const log: string[] = [];
		const s = serve(manualFeed().feed, { log: (m) => log.push(m) });
		const c = await client(s.port);
		c.send({ t: "hello", client: "app", version: "0.1.0" });
		await waitFor(() => log.some((l) => l.includes("app 0.1.0") && l.includes("connected")));
		c.close();
		await waitFor(() => log.some((l) => l.includes("app 0.1.0") && l.includes("left")));
	});

	test("focus reaches the feed and the reply carries the request id", async () => {
		const f = manualFeed();
		const s = serve(f.feed);
		const c = await client(s.port);
		c.send({ t: "focus", id: "r1", agent: "term_1" });
		await waitFor(() => replies(c).length === 1);
		expect(replies(c)[0]).toEqual({ t: "reply", id: "r1", ok: true });
		expect(f.focused).toEqual(["term_1"]);
	});

	test("focus failure is passed through", async () => {
		const f = manualFeed();
		f.focusResult = { ok: false, error: "unknown agent id" };
		const s = serve(f.feed);
		const c = await client(s.port);
		c.send({ t: "focus", id: "r2", agent: "nope" });
		await waitFor(() => replies(c).length === 1);
		expect(replies(c)[0]).toEqual({ t: "reply", id: "r2", ok: false, error: "unknown agent id" });
	});

	test("focus without an agent is a bad request", async () => {
		const s = serve();
		const c = await client(s.port);
		c.send({ t: "focus", id: "r3" });
		await waitFor(() => replies(c).length === 1);
		expect(replies(c)[0]).toEqual({ t: "reply", id: "r3", ok: false, error: "bad arguments" });
	});

	test("unknown commands, including Object.prototype names, are answered", async () => {
		const s = serve();
		const c = await client(s.port);
		c.send({ t: "launch", id: "u1" });
		c.send({ t: "toString", id: "u2" });
		c.send({ t: "__proto__", id: "u3" });
		await waitFor(() => replies(c).length === 3);
		for (const r of replies(c)) expect(r).toMatchObject({ ok: false, error: "unknown command" });
	});

	test("malformed messages never kill the connection; answerable ones get a reply", async () => {
		const log: string[] = [];
		const s = serve(manualFeed().feed, { log: (m) => log.push(m) });
		const c = await client(s.port);
		c.send("{not json");
		c.send({ t: "focus" }); // no id: dropped
		c.send({ id: "m1" }); // no t: answered
		c.sendBinary(new Uint8Array([1, 2, 3]));
		c.send({ t: "focus", id: "m2", agent: "a" });
		await waitFor(() => replies(c).length === 2);
		expect(replies(c)[0]).toEqual({ t: "reply", id: "m1", ok: false, error: "missing t" });
		expect(replies(c)[1]).toMatchObject({ id: "m2", ok: true });
		expect(c.closed).toBe(false);
		expect(log.filter((l) => l.includes("bad message")).length).toBe(1); // once per client
	});

	test("an oversized message closes only that client", async () => {
		const f = manualFeed();
		const s = serve(f.feed, { heartbeatMs: 60_000 });
		const big = await client(s.port);
		const other = await client(s.port);
		big.send("x".repeat(70_000));
		await waitFor(() => big.closed);
		f.emit(snap({ ts: 123 }));
		await waitFor(() => worlds(other).some((m) => m.snapshot.ts === 123));
		expect((await fetch(`http://127.0.0.1:${s.port}/v1/health`)).status).toBe(200);
	});
});
