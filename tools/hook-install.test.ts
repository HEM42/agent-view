import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
});
