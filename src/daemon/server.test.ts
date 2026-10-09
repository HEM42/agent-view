import { afterEach, describe, expect, test } from "bun:test";
import { hostAllowed, isAddrInUse, startServer, type DaemonServer } from "./server";
import { manualFeed, rawRequest, snap } from "./testing";

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
