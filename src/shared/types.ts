import type { RPCSchema } from "electrobun/bun";
import type { DuelInfo } from "./duel-timeline";
import type { ScoreRow } from "../daemon/scores";

export type { ScoreRow };

export type AgentStatus = "idle" | "working" | "blocked" | "unknown";

/** A running Claude Code subagent, from the hook (see hook/agent-view-hook.sh). */
export interface Subagent {
	id: string; // Claude agent_id — stable identity key
	type: string; // agent_type, e.g. "Explore", "general-purpose"
	startedAt: number; // epoch ms
	description?: string; // from the transcript meta file
	model?: string; // from the transcript meta file, only when overridden
}

/** Exactly what the renderer needs. Nothing else crosses the bridge. */
export interface AgentView {
	id: string; // herdr terminal_id — stable identity key
	agent: string; // "claude" | "pi" | ...
	status: AgentStatus; // already debounced + normalized on the Bun side
	project: string; // basename(cwd), e.g. "nordlink"
	focused: boolean; // pane currently focused in herdr
	subagents: Subagent[]; // oldest first; [] for non-Claude agents
}

export type OfflineReason = "not-installed" | "server-down" | "protocol-error" | "no-daemon" | "daemon-starting" | "daemon-down";

export interface Snapshot {
	herdrOnline: boolean;
	offlineReason?: OfflineReason; // present iff !herdrOnline
	agents: AgentView[]; // [] when offline; sorted by id (stable order)
	ts: number; // emit time; renderer treats >5s silence as link lost
	room?: RoomState; // the daemon's shared duel and scores; absent without a daemon
}

/** Each side's block declares what THAT side handles. */
export type AgentViewRPC = {
	bun: RPCSchema<{
		requests: {
			focusAgent: {
				params: { id: string };
				response: { ok: boolean; error?: string };
			};
			getSnapshot: {
				params: {};
				response: Snapshot;
			};
			/** dev aid: dump the rendered canvas; bun writes it only when
			 * AGENTVIEW_SHOT is set in the environment */
			saveShot: {
				params: { dataUrl: string };
				response: { ok: boolean };
			};
		};
		messages: {
			setAlwaysOnTop: { value: boolean };
			quitApp: {};
		};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			snapshot: Snapshot;
		};
	}>;
};

/** The shared room the daemon serves beside the agents: the running duel and the scoreboard. */
export interface RoomState {
	duel: DuelInfo | null;
	scores: ScoreRow[];
}
