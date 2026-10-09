/**
 * Install/uninstall the Agent View daemon as a launchd LaunchAgent.
 *
 *   bun tools/daemon-install.ts install|uninstall [--home <dir>] [--port <n>]
 *
 * install compiles src/daemon/main.ts into one self-contained binary under
 * Application Support, so the agent depends on neither this checkout nor a
 * bun on PATH. Re-running install upgrades in place. uninstall keeps state/
 * (duel scores, later) and the log.
 */

import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const LABEL = "com.cygnisec.agentview.daemon";
export const LAUNCH_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
const ENTRY = join(import.meta.dir, "..", "src", "daemon", "main.ts");

export interface DaemonPaths {
	binary: string;
	plist: string;
	log: string;
	state: string;
}

export function paths(home: string): DaemonPaths {
	const appDir = join(home, "Library", "Application Support", "Agent View");
	return {
		binary: join(appDir, "daemon", "agent-view-daemon"),
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
		<string>${xml(p.binary)}</string>
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

function run(argv: string[]): void {
	const r = Bun.spawnSync(argv, { stdout: "inherit", stderr: "inherit" });
	if (r.exitCode !== 0) throw new Error(`${argv[0]} ${argv[1] ?? ""} failed (exit ${r.exitCode})`);
}

function launchctl(args: string[]): number {
	return Bun.spawnSync(["launchctl", ...args], { stdout: "ignore", stderr: "pipe" }).exitCode;
}

const target = (): string => `gui/${process.getuid!()}`;

export async function install(home: string, opts: { port?: number } = {}): Promise<DaemonPaths> {
	const p = paths(home);
	for (const dir of [dirname(p.binary), dirname(p.plist), dirname(p.log)]) await mkdir(dir, { recursive: true });
	const tmp = `${p.binary}.${process.pid}.tmp`;
	try {
		run([process.execPath, "build", "--compile", ENTRY, "--outfile", tmp]);
		run(["codesign", "--force", "--sign", "-", tmp]);
		await rename(tmp, p.binary); // a running daemon keeps its old inode until bootout
	} finally {
		await rm(tmp, { force: true });
	}
	await writeFile(p.plist, plistFor(p, opts));
	launchctl(["bootout", `${target()}/${LABEL}`]); // not loaded yet is fine
	// bootstrap can race the bootout above ("Input/output error"): retry briefly
	for (let attempt = 1; ; attempt++) {
		if (launchctl(["bootstrap", target(), p.plist]) === 0) break;
		if (attempt === 5) throw new Error(`launchctl bootstrap ${target()} ${p.plist} failed`);
		await Bun.sleep(500);
	}
	return p;
}

export async function uninstall(home: string): Promise<string[]> {
	const p = paths(home);
	launchctl(["bootout", `${target()}/${LABEL}`]);
	const removed: string[] = [];
	for (const path of [p.plist, dirname(p.binary)]) {
		if (!existsSync(path)) continue;
		await rm(path, { recursive: true, force: true });
		removed.push(path);
	}
	return removed;
}

export function parseArgs(argv: string[]): { cmd: "install" | "uninstall"; home?: string; port?: number } {
	const [cmd, ...rest] = argv;
	if (cmd !== "install" && cmd !== "uninstall") throw new Error("usage: daemon-install.ts install|uninstall [--home <dir>] [--port <n>]");
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
			console.log(`installed ${LABEL}\n  binary: ${p.binary}\n  plist:  ${p.plist}\n  log:    ${p.log}`);
		} else {
			const removed = await uninstall(home);
			console.log(removed.length ? `removed:\n  ${removed.join("\n  ")}` : "no daemon installed");
		}
	} catch (e: any) {
		console.error(e?.message ?? e);
		process.exit(1);
	}
}
