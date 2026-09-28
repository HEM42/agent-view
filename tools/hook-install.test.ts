import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVENTS, addHooks, commandFor, install, paths, removeHooks, uninstall } from "./hook-install";

const HOOK = "/Users/john/Library/Application Support/Agent View/hook/agent-view-hook.sh";
const SOURCE = join(import.meta.dir, "..", "hook", "agent-view-hook.sh");

const OTHER = {
	model: "opus",
	hooks: {
		SubagentStart: [{ hooks: [{ type: "command", command: "python3 /x/island.py" }] }],
		Stop: [{ matcher: "", hooks: [{ type: "command", command: "say done" }] }],
	},
};

describe("addHooks / removeHooks", () => {
	test("adds one entry per event, leaves other hooks alone", () => {
		const out = addHooks(OTHER, HOOK);
		for (const ev of EVENTS) {
			const cmds = out.hooks[ev].flatMap((g: any) => g.hooks.map((h: any) => h.command));
			expect(cmds).toContain(commandFor(HOOK, ev));
		}
		expect(out.hooks.SubagentStart[0]).toEqual(OTHER.hooks.SubagentStart[0]);
		expect(out.hooks.Stop).toEqual(OTHER.hooks.Stop);
		expect(out.model).toBe("opus");
		expect(OTHER.hooks.SubagentStart).toHaveLength(1); // input not mutated
	});

	test("adding twice is a no-op", () => {
		expect(addHooks(addHooks(OTHER, HOOK), HOOK)).toEqual(addHooks(OTHER, HOOK));
	});

	test("remove restores the original, including an absent hooks key", () => {
		expect(removeHooks(addHooks(OTHER, HOOK), HOOK)).toEqual(OTHER);
		expect(removeHooks(addHooks({}, HOOK), HOOK)).toEqual({});
	});

	test("commands quote the path (it contains spaces)", () => {
		expect(commandFor(HOOK, "SubagentStart")).toBe(`'${HOOK}' SubagentStart`);
	});

	test("commands properly escape apostrophes in the path", () => {
		const pathWithQuote = "/Users/john/o'brien/hook.sh";
		const cmd = commandFor(pathWithQuote, "SessionStart");
		expect(cmd).toBe(`'/Users/john/o'\\''brien/hook.sh' SessionStart`);
	});
});

describe("install / uninstall", () => {
	let home: string;
	let settings: string;
	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), "agentview-install-"));
		settings = join(home, ".claude", "settings.json");
		await mkdir(join(home, ".claude"), { recursive: true });
	});
	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	test("install copies the hook, backs up and edits settings; uninstall undoes it", async () => {
		await writeFile(settings, JSON.stringify(OTHER));
		await install({ home, settings, source: SOURCE });
		const p = paths(home);
		expect(existsSync(p.hook)).toBe(true);
		expect(JSON.parse(await readFile(`${settings}.agent-view.bak`, "utf8"))).toEqual(OTHER);
		const edited = JSON.parse(await readFile(settings, "utf8"));
		expect(edited).toEqual(addHooks(OTHER, p.hook));

		await install({ home, settings, source: SOURCE }); // idempotent
		expect(JSON.parse(await readFile(settings, "utf8"))).toEqual(edited);

		await mkdir(join(p.data, "wV_p2"), { recursive: true });
		await uninstall({ home, settings });
		expect(JSON.parse(await readFile(settings, "utf8"))).toEqual(OTHER);
		expect(existsSync(p.hook)).toBe(false);
		expect(existsSync(p.data)).toBe(false);
	});

	test("a symlinked settings.json stays a link; the target gets the hooks and keeps its mode", async () => {
		const target = join(home, "dotfiles", "claude-settings.json");
		await mkdir(join(home, "dotfiles"), { recursive: true });
		await writeFile(target, JSON.stringify(OTHER));
		await chmod(target, 0o600);
		await symlink(target, settings);
		const p = paths(home);

		await install({ home, settings, source: SOURCE });
		expect((await lstat(settings)).isSymbolicLink()).toBe(true);
		expect(JSON.parse(await readFile(target, "utf8"))).toEqual(addHooks(OTHER, p.hook));
		expect((await stat(target)).mode & 0o777).toBe(0o600);

		await uninstall({ home, settings });
		expect((await lstat(settings)).isSymbolicLink()).toBe(true);
		expect(JSON.parse(await readFile(target, "utf8"))).toEqual(OTHER);
		expect((await stat(target)).mode & 0o777).toBe(0o600);
	});

	test("a regular settings.json keeps its mode", async () => {
		await writeFile(settings, JSON.stringify(OTHER));
		await chmod(settings, 0o600);
		await install({ home, settings, source: SOURCE });
		expect((await stat(settings)).mode & 0o777).toBe(0o600);
		await uninstall({ home, settings });
		expect((await stat(settings)).mode & 0o777).toBe(0o600);
	});

	test("no settings file yet: install creates one", async () => {
		await install({ home, settings, source: SOURCE });
		expect(JSON.parse(await readFile(settings, "utf8")).hooks.SubagentStart).toHaveLength(1);
	});

	test("invalid settings JSON aborts without changing anything", async () => {
		await writeFile(settings, "{ not json");
		await expect(install({ home, settings, source: SOURCE })).rejects.toThrow("not valid JSON");
		expect(await readFile(settings, "utf8")).toBe("{ not json");
		expect(existsSync(paths(home).hook)).toBe(false);
		expect((await readdir(join(home, ".claude"))).sort()).toEqual(["settings.json"]);
	});

	test("the installed command runs from sh -c despite the space in its path", async () => {
		await install({ home, settings, source: SOURCE });
		const cmd = commandFor(paths(home).hook, "SessionStart");
		const proc = Bun.spawn(["sh", "-c", cmd], {
			stdin: new Blob(['{"session_id":"s1","hook_event_name":"SessionStart"}']),
			env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, HERDR_PANE_ID: "wV:p2" },
		});
		expect(await proc.exited).toBe(0);
		expect(existsSync(join(paths(home).data, "wV_p2", "session.json"))).toBe(true);
	});

	test("the installed command runs from sh -c with apostrophe in the path", async () => {
		const homeWithQuote = join(home, "o'brien");
		const settingsWithQuote = join(homeWithQuote, ".claude", "settings.json");
		await mkdir(join(homeWithQuote, ".claude"), { recursive: true });
		await install({ home: homeWithQuote, settings: settingsWithQuote, source: SOURCE });
		const cmd = commandFor(paths(homeWithQuote).hook, "SessionStart");
		const proc = Bun.spawn(["sh", "-c", cmd], {
			stdin: new Blob(['{"session_id":"s1","hook_event_name":"SessionStart"}']),
			env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: homeWithQuote, HERDR_PANE_ID: "wV:p2" },
		});
		expect(await proc.exited).toBe(0);
		expect(existsSync(join(paths(homeWithQuote).data, "wV_p2", "session.json"))).toBe(true);
	});
});

describe("apostrophe in path", () => {
	test("removeHooks restores original when path has apostrophe", () => {
		const apostrophePath = "/Users/john/Library/Application Support/Agent View/hook/o'brien-hook.sh";
		expect(removeHooks(addHooks(OTHER, apostrophePath), apostrophePath)).toEqual(OTHER);
	});
});
