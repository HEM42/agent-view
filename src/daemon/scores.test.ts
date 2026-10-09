import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScoreBook } from "./scores";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "scores-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const who = (agent: string, project: string) => ({ agent, project });
const quiet = () => {};

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
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, rows: b.rows() });
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

	test("a null path never writes", async () => {
		const b = new ScoreBook(null, quiet);
		b.record(who("a", "p"), who("b", "p"));
		await b.save();
		await b.load();
		expect(b.rows()).toHaveLength(2);
		expect(await readdir(dir)).toEqual([]);
	});
});
