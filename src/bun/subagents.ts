import { readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { bySubagentAge, type RawAgent } from "../shared/herdr-core";
import type { Subagent } from "../shared/types";

/** Written by hook/agent-view-hook.sh: one directory per herdr pane, one file per running subagent. */
export const SUBAGENTS_DIR = join(homedir(), "Library", "Application Support", "Agent View", "subagents");

/** No start or heartbeat for this long = the session died without SessionEnd (Ctrl-C, crash). */
export const STALE_AFTER_MS = 30 * 60_000;
/** A missing meta file is retried this long before the tooltip goes without it. */
export const META_RETRY_MS = 5000;
/** Successful herdr lists a pane may be missing from before its directory is deleted. */
export const PRUNE_AFTER_MISSES = 10;

/** Byte-wise, like the hook's `LC_ALL=C tr -c 'A-Za-z0-9._-' '_'`. */
export function sanitizePaneId(id: string): string {
	let out = "";
	for (const b of new TextEncoder().encode(id)) {
		const c = String.fromCharCode(b);
		out += /[A-Za-z0-9._-]/.test(c) ? c : "_";
	}
	return out;
}

export interface SubagentMeta {
	description?: string;
	model?: string;
	background: boolean;
}

/** <dir>/<session>.jsonl → <dir>/<session>/subagents/agent-<id>.meta.json */
export function metaPathFor(transcriptPath: string, agentId: string): string | null {
	if (!transcriptPath.endsWith(".jsonl")) return null;
	return `${transcriptPath.slice(0, -".jsonl".length)}/subagents/agent-${agentId}.meta.json`;
}

export function parseMeta(text: string): SubagentMeta | null {
	let j: any;
	try {
		j = JSON.parse(text);
	} catch {
		return null;
	}
	if (!j || typeof j !== "object") return null;
	return {
		...(typeof j.description === "string" && j.description ? { description: j.description } : {}),
		...(typeof j.model === "string" && j.model ? { model: j.model } : {}),
		background: j.requestShape === "background",
	};
}

export interface StartFile {
	agentId: string;
	sessionId: string | null;
	type: string;
	transcriptPath: string | null;
	mtimeMs: number;
}

export interface PaneFiles {
	sessions: { id: string; mtimeMs: number }[]; // from session-<id>.json, one per Claude session in the pane
	starts: StartFile[];
	alive: Map<string, number>; // agent_id -> .alive mtime
	lastStop: { sessionId: string | null; taskIds: Set<string> | null; mtimeMs: number } | null;
	meta: Map<string, SubagentMeta>;
}

/** Which starts are still running. Pure: the store does the file IO. */
export function foldPane(files: PaneFiles, now: number): { live: StartFile[]; expired: string[] } {
	const live: StartFile[] = [];
	const expired: string[] = [];
	const stop = files.lastStop;
	let newest: PaneFiles["sessions"][number] | null = null;
	for (const x of files.sessions) if (newest === null || x.mtimeMs > newest.mtimeMs) newest = x;
	for (const s of files.starts) {
		const lastSeen = Math.max(s.mtimeMs, files.alive.get(s.agentId) ?? 0);
		// a newer session took over the pane and this one has shown no life since (a nested claude's parent keeps
		// heartbeating); a start without a session file (hook installed mid-session) only goes stale
		const superseded =
			newest !== null &&
			s.sessionId !== null &&
			s.sessionId !== newest.id &&
			files.sessions.some((x) => x.id === s.sessionId) &&
			lastSeen < newest.mtimeMs;
		const stale = now - lastSeen > STALE_AFTER_MS;
		// a later SubagentStop lists the session's running background tasks: absent = its own stop was missed
		const missedStop =
			stop !== null &&
			stop.taskIds !== null &&
			stop.mtimeMs > s.mtimeMs &&
			stop.sessionId === s.sessionId &&
			files.meta.get(s.agentId)?.background === true &&
			!stop.taskIds.has(s.agentId);
		if (superseded || stale || missedStop) expired.push(s.agentId);
		else live.push(s);
	}
	return { live, expired };
}

/** Claude agents get their pane's live subagents; everyone else gets none. */
export function joinSubagents(agents: RawAgent[], byPane: Map<string, Subagent[]>): RawAgent[] {
	return agents.map((a) => ({
		...a,
		subagents: a.agent === "claude" && a.pane_id ? (byPane.get(sanitizePaneId(a.pane_id)) ?? []) : [],
	}));
}

function parseJson(text: string): any {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function parseStart(agentId: string, text: string, mtimeMs: number): StartFile | null {
	const j = parseJson(text);
	if (!j || typeof j !== "object") return null;
	return {
		agentId,
		sessionId: typeof j.session_id === "string" ? j.session_id : null,
		type: typeof j.agent_type === "string" && j.agent_type ? j.agent_type : "agent",
		transcriptPath: typeof j.transcript_path === "string" ? j.transcript_path : null,
		mtimeMs,
	};
}

function parseLastStop(text: string, mtimeMs: number): PaneFiles["lastStop"] {
	const j = parseJson(text);
	if (!j || typeof j !== "object") return null;
	const tasks = j.background_tasks;
	return {
		sessionId: typeof j.session_id === "string" ? j.session_id : null,
		taskIds: Array.isArray(tasks) ? new Set(tasks.flatMap((t: any) => (typeof t?.id === "string" ? [t.id] : []))) : null,
		mtimeMs,
	};
}

const readText = (path: string) => readFile(path, "utf8").catch(() => "");

async function paneDirs(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	return entries.filter((d) => d.isDirectory()).map((d) => d.name);
}

export class SubagentStore {
	private meta = new Map<string, SubagentMeta | null>(); // null = gave up
	private metaSince = new Map<string, number>();
	private misses = new Map<string, number>();
	private lastError = "";

	constructor(private root = SUBAGENTS_DIR) {}

	/** Live subagents per sanitized pane id. Never throws: subagents are decoration. */
	async read(now = Date.now()): Promise<Map<string, Subagent[]>> {
		const out = new Map<string, Subagent[]>();
		let panes: string[];
		try {
			panes = await paneDirs(this.root);
		} catch (e: any) {
			if (e?.code !== "ENOENT") this.warn(e); // no hook installed: silently nothing
			return out;
		}
		const seen = new Set<string>();
		for (const pane of panes) {
			try {
				const subs = await this.readPane(join(this.root, pane), now);
				for (const s of subs) seen.add(s.id);
				if (subs.length > 0) out.set(pane, subs);
			} catch (e) {
				this.warn(e);
			}
		}
		for (const id of this.meta.keys()) if (!seen.has(id)) this.meta.delete(id);
		for (const id of this.metaSince.keys()) if (!seen.has(id)) this.metaSince.delete(id);
		return out;
	}

	/** Delete pane directories herdr stopped listing, after a grace for agent-detection flicker. */
	async prune(panesInHerdr: Iterable<string>): Promise<void> {
		const keep = new Set([...panesInHerdr].map(sanitizePaneId));
		let panes: string[];
		try {
			panes = await paneDirs(this.root);
		} catch {
			return;
		}
		for (const pane of panes) {
			if (keep.has(pane)) {
				this.misses.delete(pane);
				continue;
			}
			const n = (this.misses.get(pane) ?? 0) + 1;
			if (n < PRUNE_AFTER_MISSES) {
				this.misses.set(pane, n);
				continue;
			}
			this.misses.delete(pane);
			await rm(join(this.root, pane), { recursive: true, force: true }).catch(() => {});
		}
	}

	private async readPane(dir: string, now: number): Promise<Subagent[]> {
		const files: PaneFiles = { sessions: [], starts: [], alive: new Map(), lastStop: null, meta: new Map() };
		const staleSessions: { name: string; id: string | null }[] = [];
		for (const name of await readdir(dir)) {
			const path = join(dir, name);
			const st = await stat(path).catch(() => null);
			if (!st) continue; // the hook removed it mid-read
			if (name.startsWith("session-") && name.endsWith(".json")) {
				const j = parseJson(await readText(path));
				const id = typeof j?.session_id === "string" ? j.session_id : null;
				if (id !== null) files.sessions.push({ id, mtimeMs: st.mtimeMs });
				if (now - st.mtimeMs > STALE_AFTER_MS) staleSessions.push({ name, id });
			} else if (name === "last-stop.json") {
				files.lastStop = parseLastStop(await readText(path), st.mtimeMs);
			} else if (name.endsWith(".alive")) {
				files.alive.set(name.slice(0, -".alive".length), st.mtimeMs);
			} else if (name.endsWith(".start.json")) {
				const start = parseStart(name.slice(0, -".start.json".length), await readText(path), st.mtimeMs);
				if (start) files.starts.push(start);
				else if (now - st.mtimeMs > STALE_AFTER_MS) await unlink(path).catch(() => {});
			}
		}
		for (const s of files.starts) {
			const m = await this.metaFor(s, now);
			if (m) files.meta.set(s.agentId, m);
		}
		const { live, expired } = foldPane(files, now);
		for (const id of expired) {
			await unlink(join(dir, `${id}.start.json`)).catch(() => {});
			await unlink(join(dir, `${id}.alive`)).catch(() => {});
		}
		for (const { name, id } of staleSessions) {
			if (id === null || !live.some((s) => s.sessionId === id)) await unlink(join(dir, name)).catch(() => {});
		}
		return live
			.map((s): Subagent => {
				const m = files.meta.get(s.agentId);
				return {
					id: s.agentId,
					type: s.type,
					startedAt: Math.round(s.mtimeMs),
					...(m?.description ? { description: m.description } : {}),
					...(m?.model ? { model: m.model } : {}),
				};
			})
			.sort(bySubagentAge);
	}

	private async metaFor(s: StartFile, now: number): Promise<SubagentMeta | null> {
		const cached = this.meta.get(s.agentId);
		if (cached !== undefined) return cached;
		const path = s.transcriptPath ? metaPathFor(s.transcriptPath, s.agentId) : null;
		const parsed = path ? parseMeta(await readText(path)) : null;
		if (parsed) {
			this.meta.set(s.agentId, parsed);
			return parsed;
		}
		const since = this.metaSince.get(s.agentId) ?? now;
		this.metaSince.set(s.agentId, since);
		if (now - since >= META_RETRY_MS) this.meta.set(s.agentId, null);
		return null;
	}

	private warn(e: unknown): void {
		const msg = String((e as any)?.code ?? (e as any)?.message ?? e);
		if (msg !== this.lastError) {
			this.lastError = msg;
			console.warn(`[subagents] ${this.root}: ${msg}`);
		}
	}
}
