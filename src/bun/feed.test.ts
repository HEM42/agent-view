import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { FEED_PATH, publishFeed } from "./feed";

/** The home macOS's directory service has for the current user (what getpwuid reads). */
function directoryHome(): string {
	const user = Bun.spawnSync(["/usr/bin/id", "-un"]).stdout.toString().trim();
	const out = Bun.spawnSync(["/usr/bin/dscl", ".", "-read", `/Users/${user}`, "NFSHomeDirectory"]).stdout.toString();
	return out.replace(/^NFSHomeDirectory:\s*/, "").trim();
}

const dirs: string[] = [];
async function tempDir(): Promise<string> {
	const d = await mkdtemp(join(tmpdir(), "av-feed-"));
	dirs.push(d);
	return d;
}

afterEach(async () => {
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("publishFeed", () => {
	test("FEED_PATH is the path the screensaver bridge reads", () => {
		expect(FEED_PATH).toBe(`${directoryHome()}/Library/Application Support/Agent View/agents.json`);
	});

	test("FEED_PATH ignores an overridden $HOME, like the bridge's getpwuid lookup", async () => {
		const home = await tempDir();
		const proc = Bun.spawn([process.execPath, "-e", `console.log((await import(${JSON.stringify(`${import.meta.dir}/feed.ts`)})).FEED_PATH)`], {
			stdout: "pipe",
			env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home },
		});
		expect(await proc.exited).toBe(0);
		expect((await new Response(proc.stdout).text()).trim()).toBe(
			`${directoryHome()}/Library/Application Support/Agent View/agents.json`,
		);
		expect(homedir()).not.toBe(home); // sanity: the override really differed
	});

	test("creates missing directories and writes the output", async () => {
		const path = join(await tempDir(), "Agent View", "agents.json");
		await publishFeed('{"result":{"agents":[]}}', path);
		expect(await readFile(path, "utf8")).toBe('{"result":{"agents":[]}}');
	});

	test("publishFeed replaces the file atomically", async () => {
		const dir = await tempDir();
		const path = join(dir, "agents.json");
		await publishFeed("first", path);
		await publishFeed("second", path);
		expect(await readFile(path, "utf8")).toBe("second");
		expect(await readdir(dir)).toEqual(["agents.json"]); // no temp file left behind
	});

	test("a write failure never rejects", async () => {
		const blocker = join(await tempDir(), "not-a-dir");
		await writeFile(blocker, "x");
		await publishFeed("data", join(blocker, "agents.json")); // parent is a file
	});
});
