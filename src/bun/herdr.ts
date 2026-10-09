import { existsSync } from "node:fs";
import type { Subagent } from "../shared/types";
import { HerdrError, interpretHerdrResult, type AgentSource, type RawAgent } from "../shared/herdr-core";
import { joinSubagents } from "./subagents";

export * from "../shared/herdr-core";

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

export interface SubagentSource {
	read(): Promise<Map<string, Subagent[]>>;
	prune(panes: Iterable<string>): Promise<void>;
}

export class HerdrCliSource implements AgentSource {
	/** subagents, when given, joins each agent's running subagents (from the hook's pane directories) into the list. */
	constructor(private subagents?: SubagentSource) {}

	async list(): Promise<RawAgent[]> {
		const { code, stdout } = await execHerdr(["agent", "list"]);
		const agents = interpretHerdrResult(code, stdout);
		if (!this.subagents) return agents;
		// subagent data is a side channel: a broken store degrades to "no subagents", never a herdr failure
		const joined = joinSubagents(agents, await this.subagents.read().catch(() => new Map()));
		// only a successful list may retire pane directories; fire-and-forget, so its rejection must be handled here
		void this.subagents.prune(agents.flatMap((a) => (a.pane_id ? [a.pane_id] : []))).catch(() => {});
		return joined;
	}

	async focus(id: string): Promise<void> {
		const { code } = await execHerdr(["agent", "focus", id]);
		if (code !== 0) {
			throw new HerdrError("server-down", `focus failed (exit ${code})`);
		}
	}
}
