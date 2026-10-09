import { describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleDaemon, parseArgs } from "./daemon-install";

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

describe("bundleDaemon", () => {
	test("the bundled daemon starts from a copied bun under a launchd-sparse env", async () => {
		const dir = await mkdtemp(join(tmpdir(), "av-daemon-"));
		const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
		const port = probe.port;
		probe.stop(true);
		let proc: ReturnType<typeof Bun.spawn> | undefined;
		try {
			await bundleDaemon(join(dir, "daemon.js"));
			await copyFile(process.execPath, join(dir, "bun"));
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
