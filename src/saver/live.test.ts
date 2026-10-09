import { describe, expect, test } from "bun:test";
import type { Snapshot } from "../shared/types";
import { LINK_LOST_MS } from "../mainview/world";
import { ONLINE_INTERVAL_MS } from "../shared/herdr-core";
import { RESUME_GRACE_MS, STALE_MS, SaverFeed } from "./live";

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ herdrOnline: true, agents: [], ts: 1, ...over });
const world = (s: Snapshot, api = 1) => JSON.stringify({ t: "world", api, snapshot: s, world: {} });

function fresh(t0 = 1_000_000): SaverFeed {
	const f = new SaverFeed();
	f.reset(t0);
	return f;
}

describe("SaverFeed", () => {
	test("waits during the resume grace, then falls back to the demo", () => {
		const f = fresh(0);
		expect(f.mode(0)).toBe("wait");
		expect(f.mode(RESUME_GRACE_MS - 1)).toBe("wait");
		expect(f.mode(RESUME_GRACE_MS)).toBe("demo");
	});

	test("a fresh world with herdr online is live", () => {
		const f = fresh(0);
		f.accept(world(snap({ ts: 5 })), 100);
		expect(f.mode(100)).toBe("live");
		expect(f.live(100)).toEqual(snap({ ts: 5 }));
	});

	test("the daemon's room rides on the live snapshot; no scores means no room", () => {
		const room = { duel: null, scores: [{ key: "k", agent: "claude", project: "n", wins: 1, losses: 0 }] };
		const f = fresh(0);
		f.accept(JSON.stringify({ t: "world", api: 1, snapshot: snap({ ts: 5 }), world: room }), 100);
		expect(f.live(100)).toEqual(snap({ ts: 5, room }));
		f.accept(world(snap({ ts: 6 })), 200);
		expect("room" in f.live(200)!).toBe(false);
	});

	test("herdr offline in the daemon means demo (after the grace)", () => {
		const f = fresh(0);
		f.accept(world(snap({ herdrOnline: false, offlineReason: "server-down" })), 2000);
		expect(f.mode(2000)).toBe("demo");
		expect(f.live(2000)).toBeNull();
	});

	test("a world older than STALE_MS is gone; a new one brings live back", () => {
		const f = fresh(0);
		f.accept(world(snap()), 2000);
		expect(f.mode(2000 + STALE_MS)).toBe("live");
		expect(f.mode(2000 + STALE_MS + 1)).toBe("demo");
		f.accept(world(snap({ ts: 9 })), 9000);
		expect(f.live(9000)).toEqual(snap({ ts: 9 }));
	});

	test("other api versions and garbage are ignored", () => {
		const f = fresh(0);
		f.accept(world(snap(), 2), 2000);
		f.accept("{nope", 2000);
		f.accept(JSON.stringify({ t: "reply", id: "1", ok: true }), 2000);
		expect(f.mode(2000)).toBe("demo");
	});

	test("reset forgets the last world (a resumed saver never trusts the old one)", () => {
		const f = fresh(0);
		f.accept(world(snap()), 2000);
		f.reset(2500);
		expect(f.mode(2500)).toBe("wait");
		expect(f.live(2500)).toBeNull();
	});

	test("a long gap between beats (suspension) restarts the freshness clock", () => {
		const f = fresh(0);
		f.accept(world(snap()), 2000);
		f.beat(2500);
		// the page was suspended for a minute; the next demo tick comes before the next world
		f.beat(62_500);
		expect(f.mode(62_500)).toBe("live");
	});

	test("regular beats do not keep a stale world alive", () => {
		const f = fresh(0);
		f.accept(world(snap()), 2000);
		for (let t = 3000; t <= 2000 + STALE_MS + 1000; t += 1000) f.beat(t);
		expect(f.mode(2000 + STALE_MS + 1000)).toBe("demo");
	});
});

describe("saver timing", () => {
	test("the demo takes over before the renderer's link-lost banner (never OFFLINE)", () => {
		expect(STALE_MS + ONLINE_INTERVAL_MS).toBeLessThanOrEqual(LINK_LOST_MS - 1000);
	});
});
