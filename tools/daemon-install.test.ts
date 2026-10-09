import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDaemon, LABEL, LAUNCH_PATH, parseArgs, paths, plistFor } from "./daemon-install";

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

describe("parseArgs", () => {
	test("commands and flags", () => {
		expect(parseArgs(["install"])).toEqual({ cmd: "install" });
		expect(parseArgs(["uninstall", "--home", "/tmp/h"])).toEqual({ cmd: "uninstall", home: "/tmp/h" });
		expect(parseArgs(["install", "--port", "50000"])).toEqual({ cmd: "install", port: 50000 });
	});

	test("rejects unknown commands, valueless flags and bad ports", () => {
		expect(() => parseArgs([])).toThrow();
		expect(() => parseArgs(["reinstall"])).toThrow();
		expect(() => parseArgs(["install", "--home"])).toThrow();
		expect(() => parseArgs(["install", "--home", "--port", "1"])).toThrow();
		expect(() => parseArgs(["install", "--port", "nope"])).toThrow();
		expect(() => parseArgs(["install", "--bogus", "1"])).toThrow();
	});
});

describe("buildDaemon", () => {
	test("the bundled daemon starts from the copied bun under a launchd-sparse env", async () => {
		const dir = await mkdtemp(join(tmpdir(), "av-daemon-"));
		const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
		const port = probe.port;
		probe.stop(true);
		let proc: ReturnType<typeof Bun.spawn> | undefined;
		try {
			await buildDaemon(dir);
			expect((await readdir(dir)).sort()).toEqual(["bun", "daemon.js"]); // no temp files left
			proc = Bun.spawn([join(dir, "bun"), join(dir, "daemon.js")], {
				env: { AGENT_VIEW_PORT: String(port), HERDR_FAKE: "1" },
				stdout: "ignore",
				stderr: "ignore",
			});
			const deadline = Date.now() + 10_000;
			let ok = false;
			while (!ok && Date.now() < deadline) {
				try {
					const r = await fetch(`http://127.0.0.1:${port}/v1/health`);
					ok = ((await r.json()) as { ok?: boolean }).ok === true;
				} catch {
					await Bun.sleep(100);
				}
			}
			expect(ok).toBe(true);
		} finally {
			proc?.kill();
			await proc?.exited;
			await rm(dir, { recursive: true, force: true });
		}
	}, 30_000);
});
