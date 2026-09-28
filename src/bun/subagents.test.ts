import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RawAgent } from "../shared/herdr-core";
import {
	META_RETRY_MS,
	PRUNE_AFTER_MISSES,
	STALE_AFTER_MS,
	SubagentStore,
	foldPane,
	joinSubagents,
	metaPathFor,
	parseMeta,
	sanitizePaneId,
	type PaneFiles,
	type StartFile,
} from "./subagents";

const SID = "19a1572d-3c89-41ef-8eea-7171bd698c71";
const CHILD = "0c1d2e3f-4a5b-6c7d-8e9f-a0b1c2d3e4f5";
const NOW = 1_800_000_000_000;

const start = (agentId: string, mtimeMs: number, sessionId: string | null = SID): StartFile => ({
	agentId,
	sessionId,
	type: "Explore",
	transcriptPath: `/t/${SID}.jsonl`,
	mtimeMs,
});

const pane = (over: Partial<PaneFiles>): PaneFiles => ({
	sessions: [{ id: SID, mtimeMs: NOW - 60_000 }],
	starts: [],
	alive: new Map(),
	lastStop: null,
	meta: new Map(),
	...over,
});

describe("sanitizePaneId", () => {
	test("keeps [A-Za-z0-9._-], maps every other byte to _", () => {
		expect(sanitizePaneId("wV:p2")).toBe("wV_p2");
		expect(sanitizePaneId("a b/é")).toBe("a_b___"); // é is two UTF-8 bytes, like `tr` sees it
		expect(sanitizePaneId("ok.name-1_x")).toBe("ok.name-1_x");
	});
});

describe("metaPathFor / parseMeta", () => {
	test("meta file sits in the session's subagents folder", () => {
		expect(metaPathFor(`/p/${SID}.jsonl`, "abc")).toBe(`/p/${SID}/subagents/agent-abc.meta.json`);
		expect(metaPathFor("/p/weird.txt", "abc")).toBeNull();
	});

	test("reads description, model and background shape", () => {
		expect(
			parseMeta('{"agentType":"Explore","description":"probe the folder","model":"haiku","requestShape":"background"}'),
		).toEqual({ description: "probe the folder", model: "haiku", background: true });
		expect(parseMeta('{"agentType":"Explore"}')).toEqual({ background: false });
		expect(parseMeta("nope")).toBeNull();
	});
});

describe("foldPane", () => {
	test("a fresh start is live", () => {
		const r = foldPane(pane({ starts: [start("a1", NOW - 1000)] }), NOW);
		expect(r.live.map((s) => s.agentId)).toEqual(["a1"]);
		expect(r.expired).toEqual([]);
	});

	test("a single session never expires its own starts", () => {
		const r = foldPane(pane({ starts: [start("a1", NOW - 50_000)] }), NOW);
		expect(r.live).toHaveLength(1);
	});

	test("a newer session expires an older session's start with no life since", () => {
		const sessions = [
			{ id: SID, mtimeMs: NOW - 60_000 },
			{ id: CHILD, mtimeMs: NOW - 5000 },
		];
		const starts = [start("a1", NOW - 30_000)];
		expect(foldPane(pane({ sessions, starts }), NOW).expired).toEqual(["a1"]);
		const quiet = new Map([["a1", NOW - 10_000]]);
		expect(foldPane(pane({ sessions, starts, alive: quiet }), NOW).expired).toEqual(["a1"]);
		const newest = [start("c1", NOW - 1000, CHILD)];
		expect(foldPane(pane({ sessions, starts: newest }), NOW).live).toHaveLength(1);
	});

	test("an older session's start that heartbeats after the newer session started stays (nested claude)", () => {
		const sessions = [
			{ id: SID, mtimeMs: NOW - 60_000 },
			{ id: CHILD, mtimeMs: NOW - 5000 },
		];
		const alive = new Map([["a1", NOW - 1000]]);
		expect(foldPane(pane({ sessions, starts: [start("a1", NOW - 30_000)], alive }), NOW).live).toHaveLength(1);
	});

	test("no session file for the start's session (hook installed mid-session): only the stale window applies", () => {
		expect(foldPane(pane({ sessions: [], starts: [start("a1", NOW - 30_000)] }), NOW).live).toHaveLength(1);
		const sessions = [{ id: CHILD, mtimeMs: NOW - 5000 }];
		expect(foldPane(pane({ sessions, starts: [start("a1", NOW - 30_000)] }), NOW).live).toHaveLength(1);
		const old = NOW - STALE_AFTER_MS - 1;
		expect(foldPane(pane({ sessions: [], starts: [start("a1", old)] }), NOW).expired).toEqual(["a1"]);
	});

	test("stale without heartbeat expires; a recent heartbeat keeps it", () => {
		const old = NOW - STALE_AFTER_MS - 1;
		expect(foldPane(pane({ starts: [start("a1", old)] }), NOW).expired).toEqual(["a1"]);
		const alive = new Map([["a1", NOW - 1000]]);
		expect(foldPane(pane({ starts: [start("a1", old)], alive }), NOW).live).toHaveLength(1);
	});

	test("a later SubagentStop that no longer lists a background subagent expires it", () => {
		const meta = new Map([["a1", { background: true }]]);
		const lastStop = { sessionId: SID, taskIds: new Set(["other"]), mtimeMs: NOW };
		expect(foldPane(pane({ starts: [start("a1", NOW - 5000)], meta, lastStop }), NOW).expired).toEqual(["a1"]);
	});

	test("the stop correction never touches foreground, newer, other-session or unlisted-shape starts", () => {
		const lastStop = { sessionId: SID, taskIds: new Set<string>(), mtimeMs: NOW - 1000 };
		const bg = new Map([
			["fg", { background: false }],
			["newer", { background: true }],
		]);
		const r = foldPane(
			pane({ starts: [start("fg", NOW - 5000), start("newer", NOW - 500), start("nometa", NOW - 5000)], meta: bg, lastStop }),
			NOW,
		);
		expect(r.live.map((s) => s.agentId).sort()).toEqual(["fg", "newer", "nometa"]);
		const noList = { sessionId: SID, taskIds: null, mtimeMs: NOW };
		const m = new Map([["a1", { background: true }]]);
		expect(foldPane(pane({ starts: [start("a1", NOW - 5000)], meta: m, lastStop: noList }), NOW).live).toHaveLength(1);
	});
});

describe("joinSubagents", () => {
	const raw = (agent: string, pane_id: string): RawAgent => ({
		terminal_id: `t-${pane_id}`,
		pane_id,
		agent,
		status: "working",
		cwd: "/x",
		focused: false,
		subagents: [],
	});

	test("claude agents get their pane's subagents, others get none", () => {
		const subs = [{ id: "a1", type: "Explore", startedAt: 1 }];
		const byPane = new Map([
			["wV_p2", subs],
			["wV_p3", subs],
		]);
		const out = joinSubagents([raw("claude", "wV:p2"), raw("pi", "wV:p3"), raw("claude", "")], byPane);
		expect(out.map((a) => a.subagents)).toEqual([subs, [], []]);
	});
});

async function tempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "agentview-subagents-"));
}

async function put(path: string, text: string, mtimeMs: number): Promise<void> {
	await writeFile(path, text);
	await utimes(path, mtimeMs / 1000, mtimeMs / 1000);
}

describe("SubagentStore.read", () => {
	test("missing root: empty map", async () => {
		const store = new SubagentStore(join(tmpdir(), "agentview-does-not-exist"));
		expect((await store.read()).size).toBe(0);
	});

	test("reads live subagents with meta; skips garbage; deletes expired files", async () => {
		const root = await tempRoot();
		try {
			const dir = join(root, "wV_p2");
			const tdir = join(root, "transcripts");
			await mkdir(join(tdir, SID, "subagents"), { recursive: true });
			await mkdir(dir, { recursive: true });
			const tp = join(tdir, `${SID}.jsonl`);
			await put(
				join(tdir, SID, "subagents", "agent-a1.meta.json"),
				'{"description":"probe the folder","requestShape":"background"}',
				NOW,
			);
			const now = Math.floor(Date.now() / 1000) * 1000; // whole seconds: mtimes round-trip exactly
			await put(join(dir, "session-gone.json"), JSON.stringify({ session_id: "gone" }), now - 10_000);
			await put(join(dir, `session-${SID}.json`), JSON.stringify({ session_id: SID }), now - 5000);
			await put(
				join(dir, "a1.start.json"),
				JSON.stringify({ session_id: SID, agent_id: "a1", agent_type: "Explore", transcript_path: tp }),
				now - 2000,
			);
			await put(
				join(dir, "old.start.json"),
				JSON.stringify({ session_id: "gone", agent_id: "old", agent_type: "Plan", transcript_path: tp }),
				now - 9000,
			);
			await put(join(dir, "junk.start.json"), "not json", now);

			const map = await new SubagentStore(root).read(now);
			expect(map.get("wV_p2")).toEqual([
				{ id: "a1", type: "Explore", startedAt: Math.round(now - 2000), description: "probe the folder" },
			]);
			const left = await readdir(dir);
			expect(left).not.toContain("old.start.json"); // superseded by a newer session: deleted
			expect(left).toContain("junk.start.json"); // garbage but fresh: left alone
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("stale session files without live starts are deleted", async () => {
		const root = await tempRoot();
		try {
			const dir = join(root, "p");
			await mkdir(dir, { recursive: true });
			const now = Math.floor(Date.now() / 1000) * 1000;
			const old = now - STALE_AFTER_MS - 1000;
			await put(join(dir, "session-ended.json"), JSON.stringify({ session_id: "ended" }), old);
			await put(join(dir, "session-junk.json"), "not json", old);
			await put(join(dir, "session-fresh.json"), JSON.stringify({ session_id: "fresh" }), now - 2000);
			await put(join(dir, `session-${SID}.json`), JSON.stringify({ session_id: SID }), old);
			await put(join(dir, "a1.start.json"), JSON.stringify({ session_id: SID, agent_id: "a1" }), old);
			await put(join(dir, "a1.alive"), "", now - 1000);

			expect((await new SubagentStore(root).read(now)).get("p")!.map((s) => s.id)).toEqual(["a1"]);
			const left = await readdir(dir);
			expect(left).not.toContain("session-ended.json"); // stale, nothing live in it
			expect(left).not.toContain("session-junk.json");
			expect(left).toContain("session-fresh.json");
			expect(left).toContain(`session-${SID}.json`); // stale but a1 still heartbeats
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a missing meta file is retried, then given up after META_RETRY_MS", async () => {
		const root = await tempRoot();
		try {
			const dir = join(root, "p");
			await mkdir(dir, { recursive: true });
			const now = Date.now();
			const tp = join(root, "t", `${SID}.jsonl`);
			await put(
				join(dir, "a1.start.json"),
				JSON.stringify({ session_id: SID, agent_id: "a1", agent_type: "Explore", transcript_path: tp }),
				now,
			);
			const store = new SubagentStore(root);
			expect((await store.read(now)).get("p")![0]!.description).toBeUndefined();
			await mkdir(join(root, "t", SID, "subagents"), { recursive: true });
			await writeFile(join(root, "t", SID, "subagents", "agent-a1.meta.json"), '{"description":"late"}');
			expect((await store.read(now + 1000)).get("p")![0]!.description).toBe("late"); // retried in the window
			const store2 = new SubagentStore(root);
			await rm(join(root, "t"), { recursive: true, force: true });
			await store2.read(now);
			await store2.read(now + META_RETRY_MS); // gives up here
			await mkdir(join(root, "t", SID, "subagents"), { recursive: true });
			await writeFile(join(root, "t", SID, "subagents", "agent-a1.meta.json"), '{"description":"too late"}');
			expect((await store2.read(now + META_RETRY_MS + 1000)).get("p")![0]!.description).toBeUndefined();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("SubagentStore.prune", () => {
	test("a pane directory survives until PRUNE_AFTER_MISSES consecutive misses", async () => {
		const root = await tempRoot();
		try {
			await mkdir(join(root, "wV_p2"), { recursive: true });
			const store = new SubagentStore(root);
			for (let i = 0; i < PRUNE_AFTER_MISSES - 1; i++) await store.prune([]);
			expect(await readdir(root)).toContain("wV_p2");
			await store.prune(["wV:p2"]); // seen again (raw herdr id): the count resets
			for (let i = 0; i < PRUNE_AFTER_MISSES - 1; i++) await store.prune([]);
			expect(await readdir(root)).toContain("wV_p2");
			await store.prune([]);
			expect(await readdir(root)).not.toContain("wV_p2");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("missing root is fine", async () => {
		await new SubagentStore(join(tmpdir(), "agentview-does-not-exist")).prune([]);
	});
});
