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
 * the log.
 *
 * --home only redirects the files this writes. launchctl always targets the
 * current user's gui/<uid> session, so --home is not a sandbox: install and
 * uninstall load and unload the real LaunchAgent for whoever runs them.
 */

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_PORT } from "../src/daemon/protocol";

export const LABEL = "com.cygnisec.agentview.daemon";
export const LAUNCH_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
const ENTRY = join(import.meta.dir, "..", "src", "daemon", "main.ts");

export interface DaemonPaths {
	dir: string;
	bun: string;
	script: string;
	plist: string;
	log: string;
	state: string;
}

export function paths(home: string): DaemonPaths {
	const appDir = join(home, "Library", "Application Support", "Agent View");
	const dir = join(appDir, "daemon");
	return {
		dir,
		bun: join(dir, "bun"),
		script: join(dir, "daemon.js"),
		plist: join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
		log: join(home, "Library", "Logs", "Agent View", "daemon.log"),
		state: join(appDir, "state"),
	};
}

const xml = (s: string): string =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function plistFor(p: DaemonPaths, opts: { port?: number } = {}): string {
	const env = [`\t\t<key>PATH</key>\n\t\t<string>${LAUNCH_PATH}</string>`];
	if (opts.port !== undefined) env.push(`\t\t<key>AGENT_VIEW_PORT</key>\n\t\t<string>${opts.port}</string>`);
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${xml(p.bun)}</string>
		<string>${xml(p.script)}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${xml(p.log)}</string>
	<key>StandardErrorPath</key>
	<string>${xml(p.log)}</string>
	<key>EnvironmentVariables</key>
	<dict>
${env.join("\n")}
	</dict>
</dict>
</plist>
`;
}

/** Run launchctl, returning its exit code and stderr. */
function launchctl(args: string[]): { code: number; err: string } {
	const r = Bun.spawnSync(["launchctl", ...args], { stdout: "ignore", stderr: "pipe" });
	return { code: r.exitCode, err: r.stderr.toString().trim() };
}

const target = (): string => `gui/${process.getuid!()}`;

/** Write via a temp file in the same directory and rename, so a running daemon keeps its old inode until bootout. */
async function replaceAtomically(dest: string, make: (tmp: string) => Promise<void>): Promise<void> {
	const tmp = `${dest}.${process.pid}.tmp`;
	try {
		await make(tmp);
		await rename(tmp, dest);
	} finally {
		await rm(tmp, { force: true });
	}
}

/**
 * Put daemon.js (the bundled daemon) and bun (a copy of the running, validly
 * signed bun) into dir. No codesign step: copying keeps bun's own signature.
 */
export async function buildDaemon(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
	await replaceAtomically(join(dir, "daemon.js"), async (tmp) => {
		const r = await Bun.build({ entrypoints: [ENTRY], target: "bun", outdir: dirname(tmp), naming: tmp.slice(dirname(tmp).length + 1) });
		if (!r.success) throw new Error(`bundling the daemon failed: ${r.logs.join("\n")}`);
	});
	await replaceAtomically(join(dir, "bun"), async (tmp) => {
		await copyFile(process.execPath, tmp);
		await chmod(tmp, 0o755);
	});
}

async function tailLog(log: string): Promise<string> {
	try {
		return (await readFile(log, "utf8")).trimEnd().split("\n").slice(-10).join("\n");
	} catch {
		return "(no log)";
	}
}

async function healthy(port: number): Promise<boolean> {
	try {
		const r = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(1000) });
		return r.ok && ((await r.json()) as { ok?: boolean }).ok === true;
	} catch {
		return false;
	}
}

export async function install(home: string, opts: { port?: number } = {}): Promise<DaemonPaths> {
	const p = paths(home);
	for (const dir of [p.dir, dirname(p.plist), dirname(p.log)]) await mkdir(dir, { recursive: true });
	await buildDaemon(p.dir);
	await writeFile(p.plist, plistFor(p, opts));
	launchctl(["bootout", `${target()}/${LABEL}`]); // not loaded yet is fine
	// bootstrap can race the bootout above ("Input/output error"): retry briefly
	for (let attempt = 1; ; attempt++) {
		const r = launchctl(["bootstrap", target(), p.plist]);
		if (r.code === 0) break;
		if (attempt === 5) throw new Error(`launchctl bootstrap ${target()} ${p.plist} failed: ${r.err}`);
		await Bun.sleep(500);
	}
	const port = opts.port ?? DEFAULT_PORT;
	const deadline = Date.now() + 5000;
	while (!(await healthy(port))) {
		if (Date.now() > deadline) {
			throw new Error(`daemon did not answer on 127.0.0.1:${port} within 5 s; log tail:\n${await tailLog(p.log)}`);
		}
		await Bun.sleep(250);
	}
	return p;
}

export async function uninstall(home: string): Promise<string[]> {
	const p = paths(home);
	launchctl(["bootout", `${target()}/${LABEL}`]);
	const removed: string[] = [];
	for (const path of [p.plist, p.dir]) {
		if (!existsSync(path)) continue;
		await rm(path, { recursive: true, force: true });
		removed.push(path);
	}
	return removed;
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
			const p = await install(home, args.port !== undefined ? { port: args.port } : {});
			console.log(`installed ${LABEL}\n  daemon: ${p.script}\n  plist:  ${p.plist}\n  log:    ${p.log}`);
		} else {
			const removed = await uninstall(home);
			console.log(removed.length ? `removed:\n  ${removed.join("\n  ")}` : "no daemon installed");
		}
	} catch (e: any) {
		console.error(e?.message ?? e);
		process.exit(1);
	}
}
