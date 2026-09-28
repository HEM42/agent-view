/**
 * Install/uninstall the Agent View subagent hook for Claude Code.
 *
 *   bun tools/hook-install.ts install|uninstall [--settings <path>] [--home <dir>]
 *
 * Only entries whose command starts with the installed script's quoted path
 * are ever added or removed; every other hook is left as it was.
 */

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

async function writeSettings(path: string, settings: any): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	if (existsSync(path)) await copyFile(path, `${path}.agent-view.bak`);
	const tmp = `${path}.agent-view.tmp`;
	await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`);
	await rename(tmp, path);
}

export async function install(opts: { home: string; settings: string; source: string }): Promise<void> {
	const p = paths(opts.home);
	const settings = await readSettings(opts.settings); // validate before touching anything
	await mkdir(dirname(p.hook), { recursive: true });
	await copyFile(opts.source, p.hook);
	await chmod(p.hook, 0o755);
	await writeSettings(opts.settings, addHooks(settings, p.hook));
}

export async function uninstall(opts: { home: string; settings: string }): Promise<void> {
	const p = paths(opts.home);
	if (existsSync(opts.settings)) {
		await writeSettings(opts.settings, removeHooks(await readSettings(opts.settings), p.hook));
	}
	await rm(dirname(p.hook), { recursive: true, force: true });
	await rm(p.data, { recursive: true, force: true });
}

if (import.meta.main) {
	const [cmd, ...rest] = process.argv.slice(2);
	const flag = (name: string) => {
		const i = rest.indexOf(name);
		return i >= 0 ? rest[i + 1] : undefined;
	};
	const home = flag("--home") ?? homedir();
	const settings = flag("--settings") ?? paths(home).settings;
	try {
		if (cmd === "install") {
			await install({ home, settings, source: join(import.meta.dir, "..", "hook", "agent-view-hook.sh") });
			console.log(`installed ${paths(home).hook}\nhooks added to ${settings} (backup: ${settings}.agent-view.bak)`);
		} else if (cmd === "uninstall") {
			await uninstall({ home, settings });
			console.log(`removed the Agent View hook from ${settings}`);
		} else {
			console.error("usage: bun tools/hook-install.ts install|uninstall [--settings <path>] [--home <dir>]");
			process.exit(2);
		}
	} catch (e: any) {
		console.error(e?.message ?? String(e));
		process.exit(1);
	}
}
