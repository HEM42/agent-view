import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { daemonUpToDate, ensureDaemon, LABEL, LAUNCH_PATH, paths, plistFor } from "./daemon-setup";

describe("paths", () => {
	test("lives under the given home", () => {
		expect(paths("/Users/x")).toEqual({
			dir: "/Users/x/Library/Application Support/Agent View/daemon",
			bun: "/Users/x/Library/Application Support/Agent View/daemon/bun",
			script: "/Users/x/Library/Application Support/Agent View/daemon/daemon.js",
			plist: `/Users/x/Library/LaunchAgents/${LABEL}.plist`,
			log: "/Users/x/Library/Logs/Agent View/daemon.log",
			state: "/Users/x/Library/Application Support/Agent View/state",
		});
	});
});

async function lint(xml: string): Promise<number> {
	const dir = await mkdtemp(join(tmpdir(), "av-plist-"));
	const file = join(dir, "t.plist");
	await writeFile(file, xml);
	return Bun.spawnSync(["plutil", "-lint", file], { stdout: "ignore", stderr: "ignore" }).exitCode;
}

describe("plistFor", () => {
	test("a valid launchd plist with keep-alive, logs and PATH", async () => {
		const xml = plistFor(paths("/Users/x"));
		expect(await lint(xml)).toBe(0);
		expect(xml).toContain(`<string>${LABEL}</string>`);
		expect(xml).toContain(
			"<array>\n\t\t<string>/Users/x/Library/Application Support/Agent View/daemon/bun</string>\n\t\t<string>/Users/x/Library/Application Support/Agent View/daemon/daemon.js</string>\n\t</array>",
		);
		expect(xml).toContain("<key>RunAtLoad</key>\n\t<true/>");
		expect(xml).toContain("<key>KeepAlive</key>\n\t<true/>");
		expect(xml).toContain(`<string>${LAUNCH_PATH}</string>`);
		expect(xml).not.toContain("AGENT_VIEW_PORT");
	});

	test("port only when given", async () => {
		const xml = plistFor(paths("/Users/x"), { port: 50000 });
		expect(await lint(xml)).toBe(0);
		expect(xml).toContain("<key>AGENT_VIEW_PORT</key>\n\t\t<string>50000</string>");
	});

	test("home paths are XML-escaped", async () => {
		const xml = plistFor(paths("/Users/a&b <c>"));
		expect(await lint(xml)).toBe(0);
		expect(xml).toContain("/Users/a&amp;b &lt;c&gt;/");
	});
});


/** A temp home with an installed daemon (plist, daemon.js, bun) plus the app's own copies to compare against. */
async function fixture(opts: { installed?: boolean } = {}) {
	const home = await mkdtemp(join(tmpdir(), "av-home-"));
	const src = await mkdtemp(join(tmpdir(), "av-src-"));
	const script = join(src, "daemon.js");
	const bun = join(src, "bun");
	await writeFile(script, "console.log('v1')");
	await writeFile(bun, "bun-binary");
	if (opts.installed !== false) {
		const p = paths(home);
		await mkdir(p.dir, { recursive: true });
		await mkdir(dirname(p.plist), { recursive: true });
		await writeFile(p.script, "console.log('v1')");
		await writeFile(p.bun, "bun-binary");
		await writeFile(p.plist, plistFor(p));
	}
	return { home, script, bun, p: paths(home) };
}

describe("daemonUpToDate", () => {
	test("true when plist, script bytes and bun size all match", async () => {
		const f = await fixture();
		expect(await daemonUpToDate(f.home, f.script, f.bun)).toBe(true);
	});

	test("false when nothing is installed", async () => {
		const f = await fixture({ installed: false });
		expect(await daemonUpToDate(f.home, f.script, f.bun)).toBe(false);
	});

	test("false without the plist", async () => {
		const f = await fixture();
		await rm(f.p.plist);
		expect(await daemonUpToDate(f.home, f.script, f.bun)).toBe(false);
	});

	test("false when the script differs", async () => {
		const f = await fixture();
		await writeFile(f.script, "console.log('v2')");
		expect(await daemonUpToDate(f.home, f.script, f.bun)).toBe(false);
	});

	test("false when the bun size differs", async () => {
		const f = await fixture();
		await writeFile(f.bun, "a-different-size-bun");
		expect(await daemonUpToDate(f.home, f.script, f.bun)).toBe(false);
	});
});

describe("ensureDaemon", () => {
	const run = async (f: Awaited<ReturnType<typeof fixture>>, over: Partial<Parameters<typeof ensureDaemon>[0]> = {}) => {
		const calls: unknown[][] = [];
		const logs: string[] = [];
		const result = await ensureDaemon({
			home: f.home,
			script: f.script,
			bun: f.bun,
			port: 50000,
			healthy: async () => true,
			install: async (...args) => {
				calls.push(args);
				return f.p;
			},
			log: (m) => logs.push(m),
			...over,
		});
		return { result, calls, logs };
	};

	test("up to date and healthy: running, no install", async () => {
		const f = await fixture();
		const { result, calls } = await run(f);
		expect(result).toBe("running");
		expect(calls).toEqual([]);
	});

	test("stale script: installs with the app's copies and port", async () => {
		const f = await fixture();
		await writeFile(f.script, "console.log('v2')");
		const { result, calls } = await run(f);
		expect(result).toBe("installed");
		expect(calls).toEqual([[f.home, { bun: f.bun, script: f.script }, { port: 50000 }]]);
	});

	test("up to date but unhealthy: installs", async () => {
		const f = await fixture();
		const { result, calls } = await run(f, { healthy: async () => false });
		expect(result).toBe("installed");
		expect(calls.length).toBe(1);
	});

	test("nothing installed: installs", async () => {
		const f = await fixture({ installed: false });
		expect((await run(f)).result).toBe("installed");
	});

	test("a throwing install: failed, and the error is logged", async () => {
		const f = await fixture({ installed: false });
		const { result, logs } = await run(f, {
			install: async () => {
				throw new Error("launchctl exploded");
			},
		});
		expect(result).toBe("failed");
		expect(logs.join("\n")).toContain("launchctl exploded");
	});
});
