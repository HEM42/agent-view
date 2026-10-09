import { describe, expect, test } from "bun:test";
import { Scoreboard, type Fighter } from "./scoreboard";

const f = (agent: string, project: string, accent = "#2DE2E6"): Fighter => ({
	agent,
	project,
	agentColor: "#E8825A",
	accent,
});

const rows = (b: Scoreboard, n = 5) => b.top(n).map((s) => `${s.key} ${s.wins}-${s.losses}`);

describe("Scoreboard", () => {
	test("empty until the first duel", () => {
		expect(new Scoreboard().top(5)).toEqual([]);
	});

	test("a win and a loss land on agent·project", () => {
		const b = new Scoreboard();
		b.record(f("claude", "nexel"), f("pi", "nordlink"));
		expect(rows(b)).toEqual(["claude·nexel 1-0", "pi·nordlink 0-1"]);
	});

	test("ranked by wins, then fewer losses, then name", () => {
		const b = new Scoreboard();
		const nexel = f("claude", "nexel");
		const mymem = f("claude", "mymem");
		const nord = f("pi", "nordlink");
		b.record(nexel, nord);
		b.record(nexel, mymem);
		b.record(mymem, nord);
		b.record(nord, mymem);
		// nexel 2-0; mymem 1-2; nordlink 1-2 → tie broken by name
		expect(rows(b)).toEqual(["claude·nexel 2-0", "claude·mymem 1-2", "pi·nordlink 1-2"]);
	});

	test("fewer losses wins a tie on wins", () => {
		const b = new Scoreboard();
		const a = f("claude", "a");
		const z = f("claude", "z");
		const x = f("pi", "x");
		b.record(a, x);
		b.record(z, x);
		b.record(x, a);
		expect(rows(b).slice(0, 2)).toEqual(["claude·z 1-0", "claude·a 1-1"]);
	});

	test("only the top n are shown", () => {
		const b = new Scoreboard();
		for (let i = 0; i < 7; i++) b.record(f("claude", `p${i}`), f("pi", "punchbag"));
		expect(b.top(5)).toHaveLength(5);
	});

	test("two agents in the same project share a record, and the latest colours stick", () => {
		const b = new Scoreboard();
		b.record(f("claude", "nexel", "#111111"), f("pi", "x"));
		b.record(f("claude", "nexel", "#222222"), f("pi", "x"));
		const top = b.top(1)[0]!;
		expect([top.key, top.wins, top.accent]).toEqual(["claude·nexel", 2, "#222222"]);
	});

	test("version changes with every result, so the sign knows to redraw", () => {
		const b = new Scoreboard();
		const v0 = b.version;
		b.record(f("claude", "a"), f("pi", "b"));
		expect(b.version).not.toBe(v0);
	});
});
