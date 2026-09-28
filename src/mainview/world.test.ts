import { describe, expect, test } from "bun:test";
import type { Snapshot } from "../shared/types";
import { World } from "./world";

const SNAP: Snapshot = { herdrOnline: true, offlineReason: null, agents: [], ts: 0 };

describe("World.forgetLink", () => {
	test("without forgetLink, a stale lastMessageAt reports link-lost", () => {
		const w = new World();
		w.reconcile(SNAP, 1000);
		expect(w.linkLost(1000 + 6000)).toBe(true);
	});

	test("forgetLink makes a resumed game behave like a cold start", () => {
		const w = new World();
		w.reconcile(SNAP, 1000);
		w.forgetLink();
		expect(w.linkLost(1000 + 6000)).toBe(false);
	});
});
