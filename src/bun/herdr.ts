import { existsSync } from "node:fs";
import type {
	AgentStatus,
	AgentView,
	OfflineReason,
	Snapshot,
} from "../shared/types";

export class HerdrError extends Error {
	constructor(
		public reason: OfflineReason,
		message: string,
	) {
		super(message);
	}
}

/** Post-validation, pre-debounce agent entry (Bun-side only). */
export interface RawAgent {
	terminal_id: string;
	agent: string;
	status: AgentStatus;
	cwd: string;
	focused: boolean;
}

/** The seam that lets HERDR_FAKE swap in a scripted source. */
export interface AgentSource {
	list(): Promise<RawAgent[]>;
	focus(id: string): Promise<void>;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
	"idle",
	"working",
	"blocked",
	"unknown",
]);

export function normalizeStatus(s: unknown): AgentStatus {
	if (s === "done") return "idle"; // wait-API status, treat as lounging
	return typeof s === "string" && VALID_STATUSES.has(s)
		? (s as AgentStatus)
		: "unknown"; // version drift never takes the room offline
}

/**
 * Parse `herdr agent list` stdout. herdr emits JSON even on failure
 * ({"error":{...}} with exit 1), so the error key must be checked explicitly.
 */
export function parseAgentList(text: string): RawAgent[] {
	let json: any;
	try {
		json = JSON.parse(text);
	} catch {
		throw new HerdrError("protocol-error", "herdr output was not JSON");
	}
	if (json && typeof json === "object" && json.error) {
		throw new HerdrError(
			"server-down",
			String(json.error.message ?? json.error.code ?? "herdr error"),
		);
	}
	const list = json?.result?.agents;
	if (!Array.isArray(list)) {
		throw new HerdrError("protocol-error", "missing result.agents");
	}
	// Skip entries without a usable identity rather than failing the tick.
	return list.flatMap((a: any) =>
		typeof a?.terminal_id !== "string"
			? []
			: [
					{
						terminal_id: a.terminal_id,
						agent: typeof a.agent === "string" && a.agent ? a.agent : "agent",
						status: normalizeStatus(a.agent_status),
						cwd: typeof a.cwd === "string" ? a.cwd : "",
						focused: a.focused === true,
					},
				],
	);
}

export function basenameOf(cwd: string): string {
	const b = cwd.replace(/\/+$/, "").split("/").pop();
	return b || cwd || "?";
}

const EXEC_TIMEOUT_MS = 3000;

/**
 * Apps launched from Finder/Launchpad get macOS's minimal PATH, which lacks
 * /opt/homebrew/bin — so a bare "herdr" spawn fails even though herdr is
 * installed. Resolve the binary via PATH first, then the usual install
 * locations. Cached; reset on ENOENT so installing herdr later self-heals.
 */
const HERDR_CANDIDATES = [
	"/opt/homebrew/bin/herdr",
	"/usr/local/bin/herdr",
	`${process.env["HOME"] ?? ""}/.local/bin/herdr`,
	`${process.env["HOME"] ?? ""}/.bun/bin/herdr`,
];

let herdrBin: string | null = null;

export function resolveHerdrBin(): string | null {
	if (herdrBin) return herdrBin;
	herdrBin = Bun.which("herdr");
	if (!herdrBin) {
		for (const candidate of HERDR_CANDIDATES) {
			if (existsSync(candidate)) {
				herdrBin = candidate;
				break;
			}
		}
	}
	return herdrBin;
}

async function execHerdr(
	argv: string[],
): Promise<{ code: number; stdout: string }> {
	const bin = resolveHerdrBin();
	if (!bin) {
		throw new HerdrError("not-installed", "herdr binary not found");
	}
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([bin, ...argv], { stdout: "pipe", stderr: "ignore" });
	} catch (e: any) {
		if (e?.code === "ENOENT") {
			herdrBin = null; // binary vanished: re-resolve on the next poll
			throw new HerdrError("not-installed", "herdr binary not found");
		}
		throw new HerdrError("server-down", String(e?.message ?? e));
	}
	// Manual timeout: a hung CLI must never stall the poll loop.
	const killer = setTimeout(() => proc.kill("SIGKILL"), EXEC_TIMEOUT_MS);
	try {
		const [stdout, code] = await Promise.all([
			new Response(proc.stdout as ReadableStream).text(),
			proc.exited,
		]);
		return { code, stdout };
	} finally {
		clearTimeout(killer);
	}
}

export class HerdrCliSource implements AgentSource {
	async list(): Promise<RawAgent[]> {
		const { code, stdout } = await execHerdr(["agent", "list"]);
		if (code !== 0) {
			// Surface the real message from the JSON error envelope if present.
			try {
				parseAgentList(stdout);
			} catch (e) {
				if (e instanceof HerdrError && e.reason === "server-down") throw e;
			}
			throw new HerdrError("server-down", `herdr exited with code ${code}`);
		}
		return parseAgentList(stdout);
	}

	async focus(id: string): Promise<void> {
		const { code } = await execHerdr(["agent", "focus", id]);
		if (code !== 0) {
			throw new HerdrError("server-down", `focus failed (exit ${code})`);
		}
	}
}

export const STABLE_TICKS = 2; // status must survive 2 consecutive polls
const OFFLINE_AFTER = 3; // consecutive failures before declaring offline

interface DebounceEntry {
	confirmed: AgentStatus;
	pending?: { status: AgentStatus; ticks: number };
}

export class HerdrPoller {
	private debounce = new Map<string, DebounceEntry>();
	private failures = 0;
	private lastReason: OfflineReason = "server-down";
	private online = false;
	private last: Snapshot = {
		herdrOnline: false,
		offlineReason: "server-down",
		agents: [],
		ts: 0,
	};
	private stopped = false;
	private knownIds = new Set<string>();

	constructor(
		private source: AgentSource,
		private emit: (s: Snapshot) => void,
	) {}

	lastSnapshot(): Snapshot {
		return this.last;
	}

	stop(): void {
		this.stopped = true;
	}

	async start(): Promise<void> {
		while (!this.stopped) {
			const t0 = Date.now();
			await this.tick();
			const interval = this.online
				? 1000
				: this.lastReason === "not-installed"
					? 5000 // back off; self-heals if the user installs herdr
					: 2000; // server down: retry gently, it may come back
			await Bun.sleep(Math.max(50, interval - (Date.now() - t0)));
		}
	}

	private async tick(): Promise<void> {
		try {
			const raw = await this.source.list();
			this.failures = 0;
			this.online = true; // recovery is immediate (one good poll)
			this.push(this.reconcile(raw));
		} catch (e) {
			const err =
				e instanceof HerdrError
					? e
					: new HerdrError("protocol-error", String(e));
			this.lastReason = err.reason;
			this.failures++;
			if (err.reason === "not-installed" || this.failures >= OFFLINE_AFTER) {
				this.online = false;
				this.debounce.clear(); // fresh walk-in for everyone on reconnect
				this.knownIds.clear();
				this.push([]);
			} else if (this.online) {
				this.push(this.last.agents); // grace window: re-emit last good data
			} else {
				this.push([]);
			}
		}
	}

	private reconcile(raw: RawAgent[]): AgentView[] {
		const seen = new Set<string>();
		const out: AgentView[] = [];
		for (const a of raw) {
			if (seen.has(a.terminal_id)) continue;
			seen.add(a.terminal_id);
			out.push({
				id: a.terminal_id,
				agent: a.agent,
				status: this.debounceStatus(a.terminal_id, a.status),
				project: basenameOf(a.cwd),
				focused: a.focused,
			});
		}
		for (const id of this.debounce.keys()) {
			if (!seen.has(id)) this.debounce.delete(id); // removed agents drop now
		}
		this.knownIds = seen;
		return out.sort((x, y) => (x.id < y.id ? -1 : 1));
	}

	/**
	 * A new status must be seen on STABLE_TICKS consecutive polls before it is
	 * believed — except "blocked", which confirms immediately: the raised hand
	 * is the whole point of the app, latency there is worse than flapping.
	 */
	debounceStatus(id: string, raw: AgentStatus): AgentStatus {
		let e = this.debounce.get(id);
		if (!e) {
			e = { confirmed: raw };
			this.debounce.set(id, e); // new agent: first status is instant
			return raw;
		}
		if (raw === e.confirmed) {
			e.pending = undefined;
			return e.confirmed;
		}
		if (raw === "blocked") {
			e.confirmed = "blocked";
			e.pending = undefined;
			return "blocked";
		}
		if (e.pending?.status === raw && ++e.pending.ticks >= STABLE_TICKS) {
			e.confirmed = raw;
			e.pending = undefined;
			return raw;
		}
		if (e.pending?.status !== raw) e.pending = { status: raw, ticks: 1 };
		return e.confirmed;
	}

	async focus(id: string): Promise<{ ok: boolean; error?: string }> {
		if (!this.knownIds.has(id)) return { ok: false, error: "unknown agent id" };
		try {
			await this.source.focus(id);
			return { ok: true };
		} catch (e: any) {
			return { ok: false, error: e?.message ?? "focus failed" };
		}
	}

	private push(agents: AgentView[]): void {
		this.last = {
			herdrOnline: this.online,
			...(this.online ? {} : { offlineReason: this.lastReason }),
			agents,
			ts: Date.now(),
		};
		this.emit(this.last);
	}
}
