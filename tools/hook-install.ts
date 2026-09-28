/**
 * Install/uninstall the Agent View subagent hook for Claude Code.
 *
 *   bun tools/hook-install.ts install|uninstall [--settings <path>] [--home <dir>]
 *
 * Only entries whose command starts with the installed script's quoted path
 * are ever added or removed; every other hook is left as it was.
 */

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const EVENTS = ["SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "PreToolUse"] as const;

function shQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

export function paths(home: string): { hook: string; data: string; settings: string } {
	const appDir = join(home, "Library", "Application Support", "Agent View");
	return {
		hook: join(appDir, "hook", "agent-view-hook.sh"),
		data: join(appDir, "subagents"),
		settings: join(home, ".claude", "settings.json"),
	};
}

export function commandFor(hookPath: string, event: string): string {
	return `${shQuote(hookPath)} ${event}`;
}

export function addHooks(settings: any, hookPath: string): any {
	const out = structuredClone(settings ?? {});
	if (!out.hooks || typeof out.hooks !== "object") out.hooks = {};
	for (const ev of EVENTS) {
		const groups: any[] = Array.isArray(out.hooks[ev]) ? out.hooks[ev] : [];
		const cmd = commandFor(hookPath, ev);
		const present = groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h: any) => h?.command === cmd));
		if (!present) groups.push({ matcher: "*", hooks: [{ type: "command", command: cmd }] });
		out.hooks[ev] = groups;
	}
	return out;
}

export function removeHooks(settings: any, hookPath: string): any {
	const out = structuredClone(settings ?? {});
	if (!out.hooks || typeof out.hooks !== "object") return out;
	const prefix = shQuote(hookPath);
	const ours = (h: any) => typeof h?.command === "string" && h.command.startsWith(prefix);
	let touched = false;
	for (const ev of Object.keys(out.hooks)) {
		const groups = out.hooks[ev];
		if (!Array.isArray(groups)) continue;
		const kept: any[] = [];
		for (const g of groups) {
			if (!Array.isArray(g?.hooks)) {
				kept.push(g);
				continue;
			}
			const hooks = g.hooks.filter((h: any) => !ours(h));
			if (hooks.length === g.hooks.length) kept.push(g);
			else {
				touched = true;
				if (hooks.length > 0) kept.push({ ...g, hooks });
			}
		}
		if (kept.length === 0 && groups.length > 0) delete out.hooks[ev];
		else out.hooks[ev] = kept;
	}
	if (touched && Object.keys(out.hooks).length === 0) delete out.hooks;
	return out;
}

async function readSettings(path: string): Promise<any> {
	if (!existsSync(path)) return {};
	const text = await readFile(path, "utf8");
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${path} is not valid JSON; fix it first (nothing was changed)`);
	}
}

/**
 * Writes through a symlinked settings.json (dotfile managers) and keeps the file's mode.
 * No change, no write; the backup is only made once, so it keeps the pre-install state.
 */
async function writeSettings(path: string, before: any, settings: any): Promise<SettingsResult> {
	await mkdir(dirname(path), { recursive: true });
	const real = await realpath(path).catch(() => path);
	const backup = `${real}.agent-view.bak`;
	const existingBackup = () => (existsSync(backup) ? backup : null);
	if (JSON.stringify(settings) === JSON.stringify(before)) return { written: false, backup: existingBackup() };
	const mode = await stat(real)
		.then((st) => st.mode & 0o7777)
		.catch(() => null); // null: no file yet
	if (mode !== null && !existsSync(backup)) await copyFile(real, backup);
	const tmp = `${real}.agent-view.tmp`;
	await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`);
	if (mode !== null) await chmod(tmp, mode);
	await rename(tmp, real);
	return { written: true, backup: existingBackup() };
}

/** written: settings.json was rewritten; backup: the (resolved) backup file, if one exists. */
export interface SettingsResult {
	written: boolean;
	backup: string | null;
}

export async function install(opts: { home: string; settings: string; source: string }): Promise<SettingsResult> {
	const p = paths(opts.home);
	const settings = await readSettings(opts.settings); // validate before touching anything
	await mkdir(dirname(p.hook), { recursive: true });
	await copyFile(opts.source, p.hook);
	await chmod(p.hook, 0o755);
	return writeSettings(opts.settings, settings, addHooks(settings, p.hook));
}

export async function uninstall(opts: { home: string; settings: string }): Promise<SettingsResult> {
	const p = paths(opts.home);
	let result: SettingsResult = { written: false, backup: null };
	if (existsSync(opts.settings)) {
		const settings = await readSettings(opts.settings);
		result = await writeSettings(opts.settings, settings, removeHooks(settings, p.hook));
	}
	await rm(dirname(p.hook), { recursive: true, force: true });
	await rm(p.data, { recursive: true, force: true });
	return result;
}

const USAGE = "usage: bun tools/hook-install.ts install|uninstall [--settings <path>] [--home <dir>]";

/** null: a flag without its value — never fall back to the real settings then. */
export function parseArgs(argv: string[]): { cmd: string | undefined; home: string; settings: string } | null {
	const [cmd, ...rest] = argv;
	const flag = (name: string) => {
		const i = rest.indexOf(name);
		if (i < 0) return undefined;
		const v = rest[i + 1];
		return v && !v.startsWith("--") ? v : null;
	};
	const home = flag("--home");
	const settings = flag("--settings");
	if (home === null || settings === null) return null;
	const h = home ?? homedir();
	return { cmd, home: h, settings: settings ?? paths(h).settings };
}

if (import.meta.main) {
	const args = parseArgs(process.argv.slice(2));
	if (!args) {
		console.error(USAGE);
		process.exit(2);
	}
	const { cmd, home, settings } = args;
	try {
		if (cmd === "install") {
			const r = await install({ home, settings, source: join(import.meta.dir, "..", "hook", "agent-view-hook.sh") });
			const change = r.written
				? `hooks added to ${settings}${r.backup ? ` (backup: ${r.backup})` : ""}`
				: `hooks already present in ${settings}`;
			console.log(`installed ${paths(home).hook}\n${change}`);
		} else if (cmd === "uninstall") {
			const r = await uninstall({ home, settings });
			console.log(r.written ? `removed the Agent View hook from ${settings}` : `no Agent View hooks in ${settings}`);
		} else {
			console.error(USAGE);
			process.exit(2);
		}
	} catch (e: any) {
		console.error(e?.message ?? String(e));
		process.exit(1);
	}
}
