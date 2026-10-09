import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LABEL, LAUNCH_PATH, paths, plistFor } from "./daemon-setup";

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

