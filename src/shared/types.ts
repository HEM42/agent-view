import type { RPCSchema } from "electrobun/bun";

export type AgentStatus = "idle" | "working" | "blocked" | "unknown";

/** Exactly what the renderer needs. Nothing else crosses the bridge. */
export interface AgentView {
	id: string; // herdr terminal_id — stable identity key
	agent: string; // "claude" | "pi" | ...
	status: AgentStatus; // already debounced + normalized on the Bun side
	project: string; // basename(cwd), e.g. "nordlink"
	focused: boolean; // pane currently focused in herdr
}

export type OfflineReason = "not-installed" | "server-down" | "protocol-error";

export interface Snapshot {
	herdrOnline: boolean;
	offlineReason?: OfflineReason; // present iff !herdrOnline
	agents: AgentView[]; // [] when offline; sorted by id (stable order)
	ts: number; // emit time; renderer treats >5s silence as link lost
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
