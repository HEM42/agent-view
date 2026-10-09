/**
 * Install/uninstall the Agent View daemon as a launchd LaunchAgent. Shared by
 * the app (which ships its own daemon) and tools/daemon-install.ts.
 *
 * launchctl always targets the current user's gui/<uid> session; `home` only
 * redirects the files written.
 */

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_PORT } from "../daemon/protocol";
import type { Snapshot } from "../shared/types";

export const LABEL = "com.cygnisec.agentview.daemon";
export const LAUNCH_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

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
	if (opts.port !== undefined && opts.port !== DEFAULT_PORT) env.push(`\t\t<key>AGENT_VIEW_PORT</key>\n\t\t<string>${opts.port}</string>`);
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

async function tailLog(log: string): Promise<string> {
	try {
		return (await readFile(log, "utf8")).trimEnd().split("\n").slice(-10).join("\n");
	} catch {
		return "(no log)";
	}
}

export async function healthy(port: number): Promise<boolean> {
	try {
		const r = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(1000) });
		return r.ok && ((await r.json()) as { ok?: boolean }).ok === true;
	} catch {
		return false;
	}
}

/** Copy the bundled daemon script and a validly signed bun into place, (re)write the plist, (re)load the agent and wait for it to answer. */
export async function installDaemon(
	home: string,
	from: { bun: string; script: string },
	opts: { port?: number } = {},
): Promise<DaemonPaths> {
	const p = paths(home);
	for (const dir of [p.dir, dirname(p.plist), dirname(p.log)]) await mkdir(dir, { recursive: true });
	await replaceAtomically(p.script, (tmp) => copyFile(from.script, tmp));
	await replaceAtomically(p.bun, async (tmp) => {
		await copyFile(from.bun, tmp);
		await chmod(tmp, 0o755);
	});
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

export async function uninstallDaemon(home: string): Promise<string[]> {
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

/** True when the plist exists, the installed daemon.js has the same bytes as `script` and the installed bun is the same size as `bun`. */
export async function daemonUpToDate(home: string, script: string, bun: string): Promise<boolean> {
	const p = paths(home);
	try {
		if (!existsSync(p.plist)) return false;
		const [have, want] = await Promise.all([readFile(p.script), readFile(script)]);
		if (!have.equals(want)) return false;
		const [haveBun, wantBun] = await Promise.all([stat(p.bun), stat(bun)]);
		return haveBun.size === wantBun.size;
	} catch {
		return false; // a missing file means not installed
	}
}

/** Install or upgrade the daemon only when the installed copy differs or is not answering. */
export async function ensureDaemon(opts: {
	home: string;
	script: string;
	bun: string;
	port?: number;
	healthy: () => Promise<boolean>;
	install?: typeof installDaemon;
	log?: (m: string) => void;
}): Promise<"running" | "installed" | "failed"> {
	const install = opts.install ?? installDaemon;
	try {
		if ((await daemonUpToDate(opts.home, opts.script, opts.bun)) && (await opts.healthy())) return "running";
		await install(opts.home, { bun: opts.bun, script: opts.script }, { port: opts.port });
		return "installed";
	} catch (e: any) {
		opts.log?.(`daemon setup failed: ${e?.message ?? e}`);
		return "failed";
	}
}

/** True when the packaged app (stable/canary, not fake mode) owns the daemon's lifecycle. */
export function managedMode(channel: string, fakeMode: string | undefined): boolean {
	return (channel === "stable" || channel === "canary") && !fakeMode;
}

/** Replace the source-checkout "no-daemon" hint with one that fits an app-managed daemon. */
export function relabelOffline(snap: Snapshot, state: "unmanaged" | "starting" | "ready" | "failed"): Snapshot {
	if (state === "unmanaged" || snap.offlineReason !== "no-daemon") return snap;
	return { ...snap, offlineReason: state === "starting" ? "daemon-starting" : "daemon-down" };
}
