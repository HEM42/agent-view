import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ScoreBook, today } from "./scores";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "scores-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const who = (agent: string, project: string) => ({ agent, project });
const quiet = () => {};
const NOW = new Date(2026, 9, 11, 14, 0, 0); // local time
const NEXT = new Date(2026, 9, 12, 0, 0, 5);

describe("ScoreBook", () => {
	test("record counts wins and losses per agent·project key", () => {
		const b = new ScoreBook(null, quiet);
		b.record(who("claude", "x"), who("pi", "y"));
		b.record(who("claude", "x"), who("pi", "y"));
		expect(b.rows()).toEqual([
			{ key: "claude·x", agent: "claude", project: "x", wins: 2, losses: 0 },
			{ key: "pi·y", agent: "pi", project: "y", wins: 0, losses: 2 },
		]);
	});

	test("sorts by wins desc, losses asc, key asc", () => {
		const b = new ScoreBook(null, quiet);
		b.record(who("b", "p"), who("z", "p"));
		b.record(who("a", "p"), who("z", "p"));
		b.record(who("c", "p"), who("a", "p"));
		b.record(who("c", "p"), who("z", "p"));
		// c 2-0, b 1-0, a 1-1, z 0-3
		expect(b.rows().map((r) => r.key)).toEqual(["c·p", "b·p", "a·p", "z·p"]);
		const t = new ScoreBook(null, quiet);
		t.record(who("m", "p"), who("q", "p"));
		t.record(who("n", "p"), who("q", "p"));
		t.record(who("o", "p"), who("r", "p"));
		t.record(who("o", "p"), who("q", "p"));
		t.record(who("p", "p"), who("o", "p"));
		// o 2-1, then m, n, p at 1-0 by key, then r 0-1 and q 0-3
		expect(t.rows().map((r) => r.key)).toEqual(["o·p", "m·p", "n·p", "p·p", "r·p", "q·p"]);
	});

	test("save and load round trip, creating the directory", async () => {
		const path = join(dir, "nested", "state", "scores.json");
		const b = new ScoreBook(path, quiet);
		b.record(who("claude", "x"), who("pi", "y"));
		await b.save();
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, day: today(NOW), champion: null, rows: b.rows() });
		expect(await readdir(join(dir, "nested", "state"))).toEqual(["scores.json"]); // no temp left behind
		const c = new ScoreBook(path, quiet);
		await c.load();
		expect(c.rows()).toEqual(b.rows());
		c.record(who("claude", "x"), who("pi", "y"));
		expect(c.rows()[0]!.wins).toBe(2);
	});

	test("a missing file starts empty", async () => {
		const b = new ScoreBook(join(dir, "none.json"), quiet);
		await b.load();
		expect(b.rows()).toEqual([]);
	});

	test("a corrupt file is renamed to .bad, logged, and starts empty", async () => {
		const path = join(dir, "scores.json");
		await writeFile(path, "{not json");
		const logs: string[] = [];
		const b = new ScoreBook(path, (m) => logs.push(m));
		await b.load();
		expect(b.rows()).toEqual([]);
		expect(existsSync(path)).toBe(false);
		expect(await readFile(path + ".bad", "utf8")).toBe("{not json");
		expect(logs).toHaveLength(1);
	});

	test("a file with the wrong shape counts as corrupt", async () => {
		const path = join(dir, "scores.json");
		await writeFile(path, JSON.stringify({ version: 2, rows: [] }));
		const b = new ScoreBook(path, quiet);
		await b.load();
		expect(b.rows()).toEqual([]);
		expect(existsSync(path + ".bad")).toBe(true);
	});

	test("a read error other than a missing file leaves the file alone and starts empty", async () => {
		const path = join(dir, "scores.json");
		await mkdir(path); // a directory: readFile fails with EISDIR, not a parse problem
		const logs: string[] = [];
		const b = new ScoreBook(path, (m) => logs.push(m));
		await b.load();
		expect(b.rows()).toEqual([]);
		expect(existsSync(path)).toBe(true);
		expect(existsSync(path + ".bad")).toBe(false);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toContain("left in place");
	});

	test("the quarantine log says whether the file was moved", async () => {
		const path = join(dir, "scores.json");
		await writeFile(path, "{not json");
		await mkdir(path + ".bad"); // renaming a file onto a directory fails
		const logs: string[] = [];
		await new ScoreBook(path, (m) => logs.push(m)).load();
		expect(logs[0]).toContain("could not move");
		const ok: string[] = [];
		await writeFile(join(dir, "b.json"), "{not json");
		await new ScoreBook(join(dir, "b.json"), (m) => ok.push(m)).load();
		expect(ok[0]).toContain("moved to");
	});

	test("a null path never writes", async () => {
		const b = new ScoreBook(null, quiet);
		b.record(who("a", "p"), who("b", "p"));
		await b.save();
		await b.load();
		expect(b.rows()).toHaveLength(2);
		expect(await readdir(dir)).toEqual([]);
	});
});

describe("today", () => {
	test("is the local date, not the UTC one", () => {
		expect(today(new Date(2026, 9, 11, 0, 0, 1))).toBe("2026-10-11");
		expect(today(new Date(2026, 9, 11, 23, 59, 59))).toBe("2026-10-11");
		expect(today(new Date(2026, 9, 12, 0, 0, 0).getTime())).toBe("2026-10-12");
		expect(today(new Date(2026, 0, 5, 12))).toBe("2026-01-05"); // zero padded
	});
});

describe("ScoreBook daily rollover", () => {
	const hist = (p: string) => join(dirname(p), "history");

	test("the same day changes nothing", async () => {
		const b = new ScoreBook(null, quiet, NOW);
		b.record(who("a", "p"), who("b", "p"));
		expect(await b.rollover(new Date(2026, 9, 11, 23, 59))).toBe(false);
		expect(b.rows()).toHaveLength(2);
		expect(b.champion()).toBeNull();
	});

	test("a new day archives the rows, crowns the top row and starts empty", async () => {
		const path = join(dir, "state", "scores.json");
		const b = new ScoreBook(path, quiet, NOW);
		b.record(who("claude", "x"), who("pi", "y"));
		b.record(who("claude", "x"), who("pi", "y"));
		const before = b.rows();
		expect(await b.rollover(NEXT)).toBe(true);
		expect(b.rows()).toEqual([]);
		expect(b.champion()).toEqual({ agent: "claude", project: "x", wins: 2, losses: 0, day: "2026-10-11" });
		expect(JSON.parse(await readFile(join(hist(path), "2026-10-11.json"), "utf8"))).toEqual({
			version: 1,
			day: "2026-10-11",
			rows: before,
		});
		expect(await readdir(hist(path))).toEqual(["2026-10-11.json"]); // no temp left behind
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
			version: 1,
			day: "2026-10-12",
			champion: b.champion(),
			rows: [],
		});
		expect(await b.rollover(NEXT)).toBe(false); // once per day
	});

	test("results after the rollover count for the new day", async () => {
		const b = new ScoreBook(null, quiet, NOW);
		b.record(who("a", "p"), who("b", "p"));
		await b.rollover(NEXT);
		b.record(who("b", "p"), who("a", "p"));
		expect(b.rows().map((r) => `${r.key} ${r.wins}-${r.losses}`)).toEqual(["b·p 1-0", "a·p 0-1"]);
	});

	test("state flips synchronously, before the writes finish", async () => {
		const b = new ScoreBook(join(dir, "scores.json"), quiet, NOW);
		b.record(who("a", "p"), who("b", "p"));
		const p = b.rollover(NEXT);
		b.record(who("b", "p"), who("a", "p")); // lands in the new day
		expect(b.champion()?.agent).toBe("a");
		await p;
		expect(b.rows().map((r) => r.wins)).toEqual([1, 0]);
	});

	test("an empty day writes no history and keeps the previous champion", async () => {
		const path = join(dir, "scores.json");
		const b = new ScoreBook(path, quiet, NOW);
		b.record(who("a", "p"), who("b", "p"));
		await b.rollover(NEXT);
		const champ = b.champion();
		await b.rollover(new Date(2026, 9, 13, 1));
		expect(b.champion()).toEqual(champ);
		expect(await readdir(hist(path))).toEqual(["2026-10-11.json"]);
		expect(JSON.parse(await readFile(path, "utf8")).day).toBe("2026-10-13");
	});

	test("a day with only zero-win rows does not dethrone", async () => {
		const path = join(dir, "scores.json");
		await writeFile(
			path,
			JSON.stringify({
				version: 1,
				day: "2026-10-11",
				champion: { agent: "old", project: "q", wins: 3, losses: 0, day: "2026-10-10" },
				rows: [{ key: "z·p", agent: "z", project: "p", wins: 0, losses: 2 }],
			}),
		);
		const b = new ScoreBook(path, quiet, NOW);
		await b.load();
		await b.rollover(NEXT);
		expect(b.champion()?.agent).toBe("old");
		expect(await readFile(join(hist(path), "2026-10-11.json"), "utf8")).toContain("z·p");
	});

	test("ties use the usual order", async () => {
		const b = new ScoreBook(null, quiet, NOW);
		b.record(who("b", "p"), who("z", "p"));
		b.record(who("a", "p"), who("z", "p"));
		await b.rollover(NEXT);
		expect(b.champion()?.agent).toBe("a");
	});

	test("a null path resets and crowns in memory without writing", async () => {
		const b = new ScoreBook(null, quiet, NOW);
		b.record(who("a", "p"), who("b", "p"));
		expect(await b.rollover(NEXT)).toBe(true);
		expect(b.rows()).toEqual([]);
		expect(b.champion()?.agent).toBe("a");
		expect(await readdir(dir)).toEqual([]);
	});

	test("the champion and day survive a reload", async () => {
		const path = join(dir, "scores.json");
		const b = new ScoreBook(path, quiet, NOW);
		b.record(who("a", "p"), who("b", "p"));
		await b.rollover(NEXT);
		const c = new ScoreBook(path, quiet, NEXT);
		await c.load();
		expect(c.champion()).toEqual(b.champion());
		expect(await c.rollover(NEXT)).toBe(false);
	});

	test("an old file without day or champion is treated as today's", async () => {
		const path = join(dir, "scores.json");
		await writeFile(
			path,
			JSON.stringify({ version: 1, rows: [{ key: "a·p", agent: "a", project: "p", wins: 1, losses: 0 }] }),
		);
		const b = new ScoreBook(path, quiet, NEXT);
		await b.load();
		expect(b.champion()).toBeNull();
		expect(await b.rollover(NEXT)).toBe(false);
		expect(b.rows()).toHaveLength(1);
	});

	test("a malformed champion loads as none; a malformed day is corrupt", async () => {
		const path = join(dir, "scores.json");
		await writeFile(path, JSON.stringify({ version: 1, day: "2026-10-11", champion: { agent: 1 }, rows: [] }));
		const b = new ScoreBook(path, quiet, NOW);
		await b.load();
		expect(b.champion()).toBeNull();
		await writeFile(path, JSON.stringify({ version: 1, day: "yesterday", rows: [] }));
		await b.load();
		expect(existsSync(path + ".bad")).toBe(true);
	});

	test("a failing history write is logged and the day still rolls over", async () => {
		const path = join(dir, "scores.json");
		await writeFile(join(dir, "history"), "a file in the way");
		const logs: string[] = [];
		const b = new ScoreBook(path, (m) => logs.push(m), NOW);
		b.record(who("a", "p"), who("b", "p"));
		expect(await b.rollover(NEXT)).toBe(true);
		expect(b.rows()).toEqual([]);
		expect(logs.some((l) => l.includes("history"))).toBe(true);
	});

	test("a failed archive leaves the old day on disk so the next start retries", async () => {
		const path = join(dir, "scores.json");
		const logs: string[] = [];
		const b = new ScoreBook(path, (m) => logs.push(m), NOW);
		b.record(who("a", "p"), who("b", "p"));
		await b.save();
		const onDisk = await readFile(path, "utf8");
		await writeFile(join(dir, "history"), "a file in the way");
		expect(await b.rollover(NEXT)).toBe(true);
		expect(b.rows()).toEqual([]);
		expect(b.champion()?.agent).toBe("a");
		expect(await readFile(path, "utf8")).toBe(onDisk);
		expect(JSON.parse(onDisk).day).toBe("2026-10-11");
		expect(logs.some((l) => l.includes("history") && l.includes("2026-10-11"))).toBe(true);
	});

	test("a stored day in the future (clock moved back) does not roll over or archive", async () => {
		const path = join(dir, "scores.json");
		await writeFile(
			path,
			JSON.stringify({
				version: 1,
				day: "2026-10-20",
				champion: null,
				rows: [{ key: "a·p", agent: "a", project: "p", wins: 1, losses: 0 }],
			}),
		);
		const b = new ScoreBook(path, quiet, NOW);
		await b.load();
		expect(await b.rollover(NEXT)).toBe(false);
		expect(b.rows()).toHaveLength(1);
		expect(b.champion()).toBeNull();
		expect(existsSync(join(dir, "history"))).toBe(false);
	});
});
