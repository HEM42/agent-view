/**
 * Install/uninstall the Agent View daemon as a launchd LaunchAgent.
 *
 *   bun tools/daemon-install.ts install|uninstall [--home <dir>] [--port <n>]
 *
 * install bundles the daemon and copies the running bun next to it under
 * Application Support, so the agent depends on neither this checkout nor a
 * bun on PATH. (A `bun build --compile` binary is not an option: its code
 * signature is invalid on current macOS and the kernel kills it.) Re-running
 * install upgrades in place. uninstall keeps state/ (duel scores, later) and
 * the log. The installer itself lives in src/bun/daemon-setup.ts.
 *
 * --home only redirects the files this writes. launchctl always targets the
 * current user's gui/<uid> session, so --home is not a sandbox: install and
 * uninstall load and unload the real LaunchAgent for whoever runs them.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installDaemon, LABEL, uninstallDaemon } from "../src/bun/daemon-setup";

const ENTRY = join(import.meta.dir, "..", "src", "daemon", "main.ts");

/** Bundle the daemon entry point into a single script at outfile. */
export async function bundleDaemon(outfile: string): Promise<void> {
	const r = await Bun.build({ entrypoints: [ENTRY], target: "bun", outdir: dirname(outfile), naming: outfile.slice(dirname(outfile).length + 1) });
	if (!r.success) throw new Error(`bundling the daemon failed: ${r.logs.join("\n")}`);
}

export function parseArgs(argv: string[]): { cmd: "install" | "uninstall"; home?: string; port?: number } {
	const [cmd, ...rest] = argv;
	if (cmd !== "install" && cmd !== "uninstall") throw new Error(
			"usage: daemon-install.ts install|uninstall [--home <dir>] [--port <n>] (--home only redirects files; launchctl always targets the current user's gui/<uid>)",
		);
	const out: { cmd: "install" | "uninstall"; home?: string; port?: number } = { cmd };
	for (let i = 0; i < rest.length; i += 2) {
		const flag = rest[i]!;
		const value = rest[i + 1];
		if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
		if (flag === "--home") out.home = value;
		else if (flag === "--port") {
			const n = /^\d+$/.test(value) ? Number(value) : NaN;
			if (!(n >= 1 && n <= 65535)) throw new Error(`bad port: ${value}`);
			out.port = n;
		} else throw new Error(`unknown flag: ${flag}`);
	}
	return out;
}

if (import.meta.main) {
	try {
		const args = parseArgs(process.argv.slice(2));
		const home = args.home ?? homedir();
		if (args.cmd === "install") {
			const tmp = await mkdtemp(join(tmpdir(), "av-daemon-"));
			try {
				const script = join(tmp, "daemon.js");
				await bundleDaemon(script);
				const p = await installDaemon(home, { bun: process.execPath, script }, args.port !== undefined ? { port: args.port } : {});
				console.log(`installed ${LABEL}\n  daemon: ${p.script}\n  plist:  ${p.plist}\n  log:    ${p.log}`);
			} finally {
				await rm(tmp, { recursive: true, force: true });
			}
		} else {
			const removed = await uninstallDaemon(home);
			console.log(removed.length ? `removed:\n  ${removed.join("\n  ")}` : "no daemon installed");
		}
	} catch (e: any) {
		console.error(e?.message ?? e);
		process.exit(1);
	}
}
